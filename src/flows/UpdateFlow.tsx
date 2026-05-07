// Update screen — 3 steps: review (pick which to update), progress
// (live status), summary. Renders inline as a takeover view in the
// right-pane (LeftRail stays anchored), with a Back breadcrumb instead
// of a popup-modal close. Ported from design-reference/variations/flows.jsx
// UpdateReview / UpdateProgress / UpdateDone.

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../state/store";
import { ScreenShell } from "../components/ScreenShell";
import { withCancellable } from "../lib/cancellable";
import type {
  Skill,
  UpdateResult,
} from "../../electron/services/types";

type Step = "review" | "progress" | "done";

function isCancelledError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /cancel/i.test(msg);
}

interface SelectionRow {
  skill: Skill;
  current: string | null;
  remote: string;
  selected: boolean;
}

interface UpdateFlowProps {
  prefillName?: string;
}

type RunStatus = "pending" | "running" | "done" | "failed";

interface RunRow {
  name: string;
  status: RunStatus;
  message?: string;
  result?: UpdateResult;
  error?: string;
}

export function UpdateFlow({ prefillName }: UpdateFlowProps = {}) {
  const setScreen = useAppStore((s) => s.setScreen);
  const skills = useAppStore((s) => s.skills);
  const updateInfo = useAppStore((s) => s.updateInfo);
  const settings = useAppStore((s) => s.settings);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const setError = useAppStore((s) => s.setError);
  const markUpdating = useAppStore((s) => s.markUpdating);
  const unmarkUpdating = useAppStore((s) => s.unmarkUpdating);

  const [step, setStep] = useState<Step>("review");
  const abortRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);
  const [selections, setSelections] = useState<SelectionRow[]>(() =>
    Object.entries(updateInfo)
      .filter(([_, info]) => info.hasUpdate)
      .map(([name, info]) => {
        const skill = skills.find((s) => s.name === name);
        return {
          skill: skill!,
          current: info.current,
          remote: info.remote,
          // Triggered from a card → only that skill selected by default;
          // user can still tick others. Triggered from the banner → all
          // selected. Either way the user has full visibility of pending
          // updates.
          selected: prefillName ? name === prefillName : true,
        };
      })
      .filter((row) => row.skill),
  );
  const [runRows, setRunRows] = useState<RunRow[]>([]);
  const [activeLog, setActiveLog] = useState<string>("");

  const selectedSkills = useMemo(
    () => selections.filter((s) => s.selected),
    [selections],
  );
  const cascadeProjects = useMemo(() => {
    const set = new Set<string>();
    for (const s of selectedSkills) {
      for (const p of s.skill.projects) set.add(p);
    }
    return set;
  }, [selectedSkills]);

  const toggle = (name: string) =>
    setSelections((prev) =>
      prev.map((row) =>
        row.skill.name === name ? { ...row, selected: !row.selected } : row,
      ),
    );

  const runUpdates = async () => {
    setStep("progress");
    cancelRequestedRef.current = false;
    const targets = selectedSkills.map((s) => s.skill.name);
    setRunRows(targets.map((name) => ({ name, status: "pending" })));

    for (const name of targets) {
      if (cancelRequestedRef.current) {
        // Mark all remaining as failed-cancelled so the user sees what
        // didn't happen.
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
        prev.map((r) => (r.name === name ? { ...r, status: "running" } : r)),
      );
      // Tag the underlying card with an "updating…" pip; cleared either
      // when this iteration finishes or via the finally block on cancel.
      markUpdating(name);
      abortRef.current = new AbortController();
      try {
        const result = await withCancellable(
          abortRef.current.signal,
          (streamId) =>
            window.api.updateSkill(name, streamId, (line) =>
              setActiveLog(line),
            ),
        );
        setRunRows((prev) =>
          prev.map((r) =>
            r.name === name
              ? { ...r, status: "done", result, message: result.commit ?? "" }
              : r,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setRunRows((prev) =>
          prev.map((r) =>
            r.name === name
              ? {
                  ...r,
                  status: "failed",
                  error: isCancelledError(err) ? "Cancelled" : message,
                }
              : r,
          ),
        );
        if (isCancelledError(err)) {
          cancelRequestedRef.current = true;
        }
      } finally {
        unmarkUpdating(name);
      }
    }

    setActiveLog("");
    await refreshSkills();
    await refreshProjects();
    await useAppStore.getState().runUpdateCheck();
    setStep("done");
  };

  const requestCancel = () => {
    cancelRequestedRef.current = true;
    abortRef.current?.abort();
  };

  const isRunning = step === "progress";
  const goBack = () => {
    if (isRunning) {
      requestCancel();
      return;
    }
    setScreen({ kind: "main" });
  };

  const title =
    step === "review"
      ? "Updates available"
      : step === "progress"
        ? "Updating…"
        : "Update complete";

  if (selections.length === 0 && step === "review") {
    return (
      <ScreenShell title="Updates" onBack={goBack}>
        <div style={{ padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            Nothing to update
          </div>
          <div
            style={{ marginTop: 8, fontSize: 13, color: "var(--ink-soft)" }}
          >
            All skills are at their latest commit. Run "Check updates" again
            to re-poll.
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 18 }}>
            <div style={{ flex: 1 }} />
            <button className="sk-btn primary" onClick={goBack}>
              Back to library
            </button>
          </div>
        </div>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      title={title}
      onBack={goBack}
      backDisabledReason={
        isRunning ? "click again to cancel the running update" : undefined
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
            selections={selections}
            cascadeProjects={cascadeProjects}
            onToggle={toggle}
            onSelectAll={(value) =>
              setSelections((prev) =>
                prev.map((r) => ({ ...r, selected: value })),
              )
            }
            cascadeEnabled={settings.cascade_updates}
            onUpdate={runUpdates}
            onCancel={goBack}
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
              goBack();
            }}
          />
        )}
      </div>
    </ScreenShell>
  );
}


function ReviewStep({
  selections,
  cascadeProjects,
  onToggle,
  onSelectAll,
  cascadeEnabled,
  onUpdate,
  onCancel,
}: {
  selections: SelectionRow[];
  cascadeProjects: Set<string>;
  onToggle: (name: string) => void;
  onSelectAll: (value: boolean) => void;
  cascadeEnabled: boolean;
  onUpdate: () => void;
  onCancel: () => void;
}) {
  const allSelected = selections.every((s) => s.selected);
  const selectedCount = selections.filter((s) => s.selected).length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>
          <span className="hl">
            {selections.length} update{selections.length === 1 ? "" : "s"}
          </span>{" "}
          ready
        </div>
        <span className="sk-tag mono">step 1 of 3</span>
        <div style={{ flex: 1 }} />
        <button
          className="sk-btn sm ghost"
          onClick={() => onSelectAll(!allSelected)}
        >
          {allSelected ? "Deselect all" : "Select all"}
        </button>
      </div>
      <div className="hand" style={{ color: "var(--ink-soft)", fontSize: 15 }}>
        depth-1 git pulls; {cascadeEnabled ? "will cascade to project copies" : "cascade is OFF in settings — projects won't be re-deployed"}
      </div>
      <div
        className="sk-box"
        style={{ flex: 1, overflow: "auto", padding: 0, minHeight: 0 }}
      >
        {selections.map((row, i) => (
          <label
            key={row.skill.name}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 14px",
              borderBottom:
                i < selections.length - 1
                  ? "1px dashed var(--line-soft)"
                  : "none",
              gap: 10,
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                border: `1.5px solid ${row.selected ? "var(--accent)" : "var(--line)"}`,
                background: row.selected ? "var(--accent)" : "var(--paper)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                // Always-dark check on the bright accent fill — passes
                // contrast on both terracotta (light) and green (dark).
                color: "#0a0a0a",
                fontSize: 11,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {row.selected && "✓"}
            </span>
            <input
              type="checkbox"
              checked={row.selected}
              onChange={() => onToggle(row.skill.name)}
              style={{ display: "none" }}
            />
            <div className="skill-icon" style={{ width: 24, height: 24, fontSize: 10 }}>
              {row.skill.displayName.slice(0, 1).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {row.skill.displayName}
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontFamily: "var(--mono)",
                  color: "var(--ink-faint)",
                }}
              >
                {row.current ?? "?"} →{" "}
                <span style={{ color: "var(--accent)" }}>{row.remote}</span>
              </div>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-soft)",
                fontFamily: "var(--mono)",
                textAlign: "right",
              }}
            >
              cascades to
              <br />
              {row.skill.projects.length} project
              {row.skill.projects.length === 1 ? "" : "s"}
            </div>
          </label>
        ))}
      </div>
      {cascadeProjects.size > 0 && (
        <div
          className="sk-box dashed"
          style={{ padding: 10, background: "#f7f6ee" }}
        >
          <div className="rail-section" style={{ padding: 0, marginBottom: 4 }}>
            Will affect {cascadeProjects.size} deployment
            {cascadeProjects.size === 1 ? "" : "s"} across
          </div>
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              fontSize: 12,
            }}
          >
            {Array.from(cascadeProjects).map((p) => (
              <span key={p} className="sk-tag">
                {p.replace(/^\/Users\/[^/]+/, "~")}
              </span>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <button className="sk-btn ghost" onClick={onCancel}>
          Skip all
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="sk-btn primary"
          disabled={selectedCount === 0}
          onClick={onUpdate}
        >
          Update {selectedCount} →
        </button>
      </div>
    </>
  );
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
        <div style={{ fontSize: 18, fontWeight: 700 }}>Updating</div>
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
          <Step
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
                ? `@ ${row.message ?? ""} · ${row.result?.cascadedTo.length ?? 0} cascaded${row.result?.failedProjects.length ? ` · ${row.result.failedProjects.length} skipped` : ""}`
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

function Step({
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
          color: "white",
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
  const totalDeploys = succeeded.reduce(
    (acc, r) => acc + (r.result?.cascadedTo.length ?? 0),
    0,
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>
          Done — {succeeded.length} updated, {totalDeploys} deployment
          {totalDeploys === 1 ? "" : "s"} synced
        </div>
        <span className="sk-tag mono">step 3 of 3</span>
      </div>
      <div className="hand" style={{ color: "var(--good)", fontSize: 15 }}>
        ✓ all clean — agents will pick up new skills on next run
      </div>

      {succeeded.length > 0 && (
        <>
          <div className="rail-section" style={{ padding: 0 }}>
            Updated
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
                <span style={{ fontSize: 11, color: "var(--good)" }}>
                  {row.result?.cascadedTo.length ?? 0} deploy
                  {(row.result?.cascadedTo.length ?? 0) === 1 ? "" : "s"} synced
                </span>
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
          <div className="sk-box" style={{ padding: 0, borderColor: "var(--warn)" }}>
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
