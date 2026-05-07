// Import flow — step 1 reviews entries from a shared JSON skill list with
// per-row URL validation and colored checkboxes (mirrors UpdateFlow's
// review pattern). Step 2 streams the per-skill installs. Step 3 summarises
// results. Already-installed entries default unchecked so the user opts-in
// to overwrites.

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../state/store";
import { ScreenShell } from "../components/ScreenShell";
import { withCancellable } from "../lib/cancellable";
import type { ImportEntryPrefill } from "../state/store";
import type { InstallResult } from "../../electron/services/types";

type Step = "review" | "progress" | "done";

type ValidationStatus = "idle" | "checking" | "ok" | "broken";

interface Row extends ImportEntryPrefill {
  selected: boolean;
  status: ValidationStatus;
  remoteCommit: string | null;
  validationError?: string;
}

type RunStatus = "pending" | "running" | "done" | "failed";

interface RunRow {
  name: string;
  status: RunStatus;
  message?: string;
  error?: string;
  result?: InstallResult;
}

function isCancelledError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /cancel/i.test(msg);
}

interface ImportFlowProps {
  entries: ImportEntryPrefill[];
  sourcePath: string | null;
  exportedAt: string | null;
}

export function ImportFlow({ entries, sourcePath, exportedAt }: ImportFlowProps) {
  const setScreen = useAppStore((s) => s.setScreen);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const setError = useAppStore((s) => s.setError);

  const [step, setStep] = useState<Step>("review");
  const [rows, setRows] = useState<Row[]>(() =>
    entries.map((e) => ({
      ...e,
      // Default-off for skills the user already has — they can still tick to
      // re-install / overwrite, but we don't surprise-overwrite by default.
      selected: !e.alreadyInstalled,
      status: "idle",
      remoteCommit: null,
    })),
  );
  const [runRows, setRunRows] = useState<RunRow[]>([]);
  const [activeLog, setActiveLog] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);

  // Validate every URL once on mount. Concurrency cap of 4 keeps a 50-skill
  // share from spawning 50 simultaneous git ls-remotes.
  useEffect(() => {
    let cancelled = false;
    const queue = entries.map((e, i) => ({ i, url: e.url }));
    setRows((prev) =>
      prev.map((r) => ({ ...r, status: "checking" as ValidationStatus })),
    );

    const worker = async () => {
      while (!cancelled) {
        const next = queue.shift();
        if (!next) return;
        try {
          const result = await window.api.validateSkillUrl(next.url);
          if (cancelled) return;
          setRows((prev) =>
            prev.map((r, idx) =>
              idx === next.i
                ? {
                    ...r,
                    status: result.ok ? "ok" : "broken",
                    remoteCommit: result.remoteCommit,
                    validationError: result.error,
                    // If the URL is broken, force-deselect so the user
                    // can't queue an install we know will fail.
                    selected: result.ok ? r.selected : false,
                  }
                : r,
            ),
          );
        } catch (err) {
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          setRows((prev) =>
            prev.map((r, idx) =>
              idx === next.i
                ? {
                    ...r,
                    status: "broken",
                    validationError: msg,
                    selected: false,
                  }
                : r,
            ),
          );
        }
      }
    };
    const workers = Array.from({ length: Math.min(4, queue.length) }, () =>
      worker(),
    );
    void Promise.all(workers);
    return () => {
      cancelled = true;
    };
    // entries reference is stable per screen mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(() => rows.filter((r) => r.selected), [rows]);
  const validatableCount = useMemo(
    () => rows.filter((r) => r.status === "ok").length,
    [rows],
  );

  const toggle = (name: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.name !== name) return r;
        // Don't allow ticking a known-broken URL — install would just fail.
        if (r.status === "broken") return r;
        return { ...r, selected: !r.selected };
      }),
    );
  };

  const setAll = (value: boolean) =>
    setRows((prev) =>
      prev.map((r) =>
        r.status === "broken" ? r : { ...r, selected: value },
      ),
    );

  const goBack = () => {
    if (step === "progress") {
      cancelRequestedRef.current = true;
      abortRef.current?.abort();
      return;
    }
    setScreen({ kind: "main" });
  };

  const runImport = async () => {
    setStep("progress");
    cancelRequestedRef.current = false;
    const targets = selected.map((r) => ({ name: r.name, url: r.url }));
    setRunRows(targets.map((t) => ({ name: t.name, status: "pending" })));

    for (const target of targets) {
      if (cancelRequestedRef.current) {
        setRunRows((prev) =>
          prev.map((r) =>
            r.status === "pending"
              ? { ...r, status: "failed", error: "Cancelled" }
              : r,
          ),
        );
        break;
      }
      setRunRows((prev) =>
        prev.map((r) =>
          r.name === target.name ? { ...r, status: "running" } : r,
        ),
      );
      abortRef.current = new AbortController();
      try {
        const result = await withCancellable(
          abortRef.current.signal,
          (streamId) =>
            window.api.installFromUrl(target.url, streamId, (line) =>
              setActiveLog(line),
            ),
        );
        setRunRows((prev) =>
          prev.map((r) =>
            r.name === target.name
              ? { ...r, status: "done", result, message: result.commit ?? "" }
              : r,
          ),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setRunRows((prev) =>
          prev.map((r) =>
            r.name === target.name
              ? {
                  ...r,
                  status: "failed",
                  error: isCancelledError(err) ? "Cancelled" : msg,
                }
              : r,
          ),
        );
        if (isCancelledError(err)) cancelRequestedRef.current = true;
      }
    }

    setActiveLog("");
    await refreshSkills();
    await refreshProjects();
    setStep("done");
  };

  const requestCancel = () => {
    cancelRequestedRef.current = true;
    abortRef.current?.abort();
  };

  const title =
    step === "review"
      ? "Import skills"
      : step === "progress"
        ? "Importing…"
        : "Import complete";

  return (
    <ScreenShell
      title={title}
      onBack={goBack}
      backDisabledReason={
        step === "progress" ? "click again to cancel the running import" : undefined
      }
    >
      <div
        style={{
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          flex: 1,
          minHeight: 0,
          overflow: "auto",
        }}
      >
        {step === "review" && (
          <ReviewStep
            rows={rows}
            sourcePath={sourcePath}
            exportedAt={exportedAt}
            validatableCount={validatableCount}
            onToggle={toggle}
            onSelectAll={setAll}
            onImport={runImport}
            onCancel={() => {
              setError(null);
              setScreen({ kind: "main" });
            }}
          />
        )}
        {step === "progress" && (
          <ProgressStep
            rows={runRows}
            activeLog={activeLog}
            onCancel={requestCancel}
            cancelRequested={cancelRequestedRef.current}
          />
        )}
        {step === "done" && (
          <DoneStep
            rows={runRows}
            onClose={() => {
              setError(null);
              setScreen({ kind: "main" });
            }}
          />
        )}
      </div>
    </ScreenShell>
  );
}

function ReviewStep({
  rows,
  sourcePath,
  exportedAt,
  validatableCount,
  onToggle,
  onSelectAll,
  onImport,
  onCancel,
}: {
  rows: Row[];
  sourcePath: string | null;
  exportedAt: string | null;
  validatableCount: number;
  onToggle: (name: string) => void;
  onSelectAll: (value: boolean) => void;
  onImport: () => void;
  onCancel: () => void;
}) {
  const allSelectable = rows.filter((r) => r.status !== "broken");
  const allSelected =
    allSelectable.length > 0 && allSelectable.every((r) => r.selected);
  const selectedCount = rows.filter((r) => r.selected).length;
  const stillChecking = rows.some((r) => r.status === "checking");

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>
          <span className="hl">
            {rows.length} skill{rows.length === 1 ? "" : "s"}
          </span>{" "}
          in this share
        </div>
        <span className="sk-tag mono">step 1 of 3</span>
        <div style={{ flex: 1 }} />
        <button
          className="sk-btn sm ghost"
          onClick={() => onSelectAll(!allSelected)}
          disabled={allSelectable.length === 0}
        >
          {allSelected ? "Deselect all" : "Select all"}
        </button>
      </div>
      <div className="hand" style={{ color: "var(--ink-soft)", fontSize: 14 }}>
        {stillChecking
          ? `validating ${rows.filter((r) => r.status === "checking").length} URL${rows.filter((r) => r.status === "checking").length === 1 ? "" : "s"} — broken links can't be imported`
          : `${validatableCount} reachable, ${rows.length - validatableCount} ${rows.length - validatableCount === 1 ? "broken" : "broken or unreachable"}`}
      </div>
      {(sourcePath || exportedAt) && (
        <div
          className="sk-box dashed"
          style={{ padding: 8, fontSize: 11, color: "var(--ink-soft)" }}
        >
          {sourcePath && (
            <div style={{ fontFamily: "var(--mono)" }}>
              {sourcePath.replace(/^\/Users\/[^/]+/, "~")}
            </div>
          )}
          {exportedAt && (
            <div>exported {new Date(exportedAt).toLocaleString()}</div>
          )}
        </div>
      )}
      <div
        className="sk-box"
        style={{ flex: 1, overflow: "auto", padding: 0, minHeight: 0 }}
      >
        {rows.map((row, i) => (
          <ImportRow
            key={row.name}
            row={row}
            isLast={i === rows.length - 1}
            onToggle={() => onToggle(row.name)}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="sk-btn ghost" onClick={onCancel}>
          Skip all
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="sk-btn primary"
          disabled={selectedCount === 0}
          onClick={onImport}
        >
          Import {selectedCount} →
        </button>
      </div>
    </>
  );
}

function ImportRow({
  row,
  isLast,
  onToggle,
}: {
  row: Row;
  isLast: boolean;
  onToggle: () => void;
}) {
  const broken = row.status === "broken";
  const checking = row.status === "checking";
  // Per-state border + fill so the colored checkbox tells the validation
  // story at a glance (terracotta/green = OK + selected, dashed grey =
  // checking, warn red = broken & locked off).
  const borderColor = broken
    ? "var(--warn)"
    : row.selected
      ? "var(--accent)"
      : "var(--line)";
  const fill = broken
    ? "transparent"
    : row.selected
      ? "var(--accent)"
      : "var(--paper)";
  const checkColor = broken ? "var(--warn)" : "#0a0a0a";
  const symbol = broken ? "✗" : row.selected ? "✓" : "";

  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 14px",
        borderBottom: isLast ? "none" : "1px dashed var(--line-soft)",
        gap: 10,
        cursor: broken ? "not-allowed" : "pointer",
        opacity: broken ? 0.7 : 1,
      }}
      title={
        broken
          ? row.validationError ?? "URL not reachable"
          : row.alreadyInstalled
            ? "already installed — selecting will overwrite"
            : ""
      }
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          border: `1.5px solid ${borderColor}`,
          background: fill,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: checkColor,
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {symbol}
      </span>
      <input
        type="checkbox"
        checked={row.selected}
        onChange={onToggle}
        disabled={broken}
        style={{ display: "none" }}
      />
      <div className="skill-icon" style={{ width: 24, height: 24, fontSize: 10 }}>
        {row.name.slice(0, 1).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          {row.name}
          {row.alreadyInstalled && (
            <span
              className="sk-tag"
              style={{ fontSize: 10, padding: "1px 6px" }}
            >
              installed
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--mono)",
            color: "var(--ink-faint)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {row.url}
        </div>
        {row.description && (
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-soft)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.description}
          </div>
        )}
      </div>
      <ValidationBadge
        status={row.status}
        remoteCommit={row.remoteCommit}
        error={row.validationError}
        checking={checking}
      />
    </label>
  );
}

function ValidationBadge({
  status,
  remoteCommit,
  error,
  checking,
}: {
  status: ValidationStatus;
  remoteCommit: string | null;
  error?: string;
  checking: boolean;
}) {
  if (checking) {
    return (
      <span
        style={{
          fontSize: 10,
          color: "var(--ink-faint)",
          fontFamily: "var(--mono)",
          textAlign: "right",
        }}
      >
        checking…
      </span>
    );
  }
  if (status === "broken") {
    return (
      <span
        style={{
          fontSize: 10,
          color: "var(--warn)",
          fontFamily: "var(--mono)",
          textAlign: "right",
          maxWidth: 140,
        }}
        title={error}
      >
        unreachable
      </span>
    );
  }
  if (status === "ok") {
    return (
      <span
        style={{
          fontSize: 10,
          color: "var(--good)",
          fontFamily: "var(--mono)",
          textAlign: "right",
        }}
      >
        ✓ {remoteCommit ?? "ok"}
      </span>
    );
  }
  return null;
}

function ProgressStep({
  rows,
  activeLog,
  onCancel,
  cancelRequested,
}: {
  rows: RunRow[];
  activeLog: string;
  onCancel: () => void;
  cancelRequested: boolean;
}) {
  const completed = rows.filter((r) => r.status !== "pending").length;
  const total = rows.length;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Importing</div>
        <span className="sk-tag mono">step 2 of 3</span>
        <div style={{ flex: 1 }} />
        <button
          className="sk-btn sm ghost"
          onClick={onCancel}
          disabled={cancelRequested}
        >
          {cancelRequested ? "Cancelling…" : "Cancel"}
        </button>
      </div>
      <div
        style={{
          height: 8,
          background: "var(--paper-2)",
          borderRadius: 4,
          border: "1px solid var(--line)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "var(--accent)",
            transition: "width 0.3s",
          }}
        />
      </div>
      <div className="hand" style={{ color: "var(--ink-faint)" }}>
        {completed} of {total} done
        {activeLog && ` · ${activeLog}`}
      </div>
      <div
        className="sk-box"
        style={{
          padding: "4px 14px",
          overflow: "auto",
          flex: 1,
          minHeight: 0,
        }}
      >
        {rows.map((row) => (
          <RunRowDisplay
            key={row.name}
            label={row.name}
            state={
              row.status === "done"
                ? "done"
                : row.status === "running"
                  ? "now"
                  : row.status === "failed"
                    ? "failed"
                    : "pending"
            }
            sub={
              row.status === "done"
                ? `@ ${row.message ?? ""}`
                : row.status === "failed"
                  ? row.error
                  : undefined
            }
          />
        ))}
      </div>
    </>
  );
}

function RunRowDisplay({
  label,
  state,
  sub,
}: {
  label: string;
  state: "done" | "now" | "pending" | "failed";
  sub?: string;
}) {
  const bg =
    state === "done"
      ? "var(--good)"
      : state === "now"
        ? "var(--accent)"
        : state === "failed"
          ? "var(--warn)"
          : "var(--paper)";
  const symbol =
    state === "done" ? "✓" : state === "now" ? "●" : state === "failed" ? "✗" : "";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 0",
        gap: 10,
        borderBottom: "1px dashed var(--line-soft)",
      }}
    >
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: "1.5px solid var(--line)",
          background: bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // Tokens invert per theme: --on-warn for failed (red bg),
          // --on-accent for accent/good fills.
          color: state === "failed" ? "var(--on-warn)" : "var(--on-accent)",
          fontSize: 11,
          flexShrink: 0,
        }}
      >
        {symbol}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: state === "now" ? 700 : 600,
            color: state === "pending" ? "var(--ink-faint)" : "var(--ink)",
          }}
        >
          {label}
        </div>
        {sub && (
          <div
            style={{
              fontSize: 11,
              color: state === "failed" ? "var(--warn)" : "var(--ink-faint)",
              fontFamily: "var(--mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function DoneStep({
  rows,
  onClose,
}: {
  rows: RunRow[];
  onClose: () => void;
}) {
  const succeeded = rows.filter((r) => r.status === "done");
  const failed = rows.filter((r) => r.status === "failed");

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>
          Done — {succeeded.length} imported
          {failed.length > 0 ? `, ${failed.length} failed` : ""}
        </div>
        <span className="sk-tag mono">step 3 of 3</span>
      </div>

      {succeeded.length > 0 && (
        <>
          <div className="rail-section" style={{ padding: 0 }}>
            Installed
          </div>
          <div className="sk-box" style={{ padding: 0 }}>
            {succeeded.map((row, i) => (
              <div
                key={row.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "8px 12px",
                  borderBottom:
                    i < succeeded.length - 1
                      ? "1px dashed var(--line-soft)"
                      : "none",
                  gap: 10,
                }}
              >
                <span style={{ color: "var(--good)", fontSize: 14 }}>✓</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {row.name}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--mono)",
                      color: "var(--ink-faint)",
                    }}
                  >
                    @ {row.result?.commit ?? "?"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {failed.length > 0 && (
        <>
          <div className="rail-section" style={{ padding: 0 }}>
            Failed
          </div>
          <div
            className="sk-box"
            style={{ padding: 0, borderColor: "var(--warn)" }}
          >
            {failed.map((row, i) => (
              <div
                key={row.name}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  padding: "8px 12px",
                  borderBottom:
                    i < failed.length - 1
                      ? "1px dashed var(--line-soft)"
                      : "none",
                  gap: 10,
                }}
              >
                <span style={{ color: "var(--warn)", fontSize: 14 }}>✗</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {row.name}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--mono)",
                      color: "var(--warn)",
                    }}
                  >
                    {row.error}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ flex: 1, minHeight: 0 }} />
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ flex: 1 }} />
        <button className="sk-btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}
