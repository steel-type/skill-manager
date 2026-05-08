// Library relocation modal. Opens from Settings → Library section. Four
// stages: confirm (pick target + history toggle) → preview (planMigration
// result, conflicts, symlink rewrites) → progress (live log via the
// op-log channel) → complete (summary + Done).

import { useEffect, useState } from "react";
import { Modal } from "../components/Modal";
import { useAppStore } from "../state/store";
import type {
  MigrationPlan,
  MigrationProgressMsg,
  MigrationResult,
} from "../../electron/services/migration";

type Stage = "confirm" | "preview" | "running" | "complete";

interface MigrationFlowProps {
  /** The chosen destination library path. The modal computes everything
   *  else (history sibling, plan, etc) from setup state + this. */
  toLibraryPath: string;
}

function tildify(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~");
}

export function MigrationFlow({ toLibraryPath }: MigrationFlowProps) {
  const setup = useAppStore((s) => s.setup);
  const closeModal = useAppStore((s) => s.closeModal);
  const loadSetup = useAppStore((s) => s.loadSetup);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const loadStacks = useAppStore((s) => s.loadStacks);
  const loadStackDeployments = useAppStore((s) => s.loadStackDeployments);
  const setError = useAppStore((s) => s.setError);

  const [stage, setStage] = useState<Stage>("confirm");
  const [moveHistory, setMoveHistory] = useState(true);
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [progress, setProgress] = useState<MigrationProgressMsg[]>([]);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [streamId] = useState(() => `migrate-${Date.now()}-${Math.random()}`);

  const fromLibrary = setup.libraryPath;
  const fromHistory = setup.historyPath;
  const toHistorySibling = (() => {
    const parent = toLibraryPath.replace(/\/+$/, "").split("/").slice(0, -1).join("/");
    const base = toLibraryPath.replace(/\/+$/, "").split("/").pop() ?? "skills";
    return `${parent}/${base}-history`;
  })();

  const onComputePlan = async () => {
    setPlanning(true);
    try {
      const p = await window.api.planMigration({
        fromLibrary,
        toLibrary: toLibraryPath,
        moveHistory,
        fromHistory,
        toHistory: moveHistory ? toHistorySibling : undefined,
      });
      setPlan(p);
      setStage("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPlanning(false);
    }
  };

  const onRun = async () => {
    if (!plan) return;
    setStage("running");
    setProgress([]);
    try {
      const r = await window.api.runMigration(
        plan,
        streamId,
        (m) => setProgress((prev) => [...prev, m]),
      );
      setResult(r);
      setStage("complete");
      // Refresh everything so the rest of the UI lands on the new paths.
      await loadSetup();
      await refreshSkills();
      await refreshProjects();
      await loadStacks();
      await loadStackDeployments();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("preview");
    }
  };

  const onCancelRunning = () => {
    window.api.cancelOperation(streamId).catch(() => undefined);
  };

  return (
    <Modal
      open
      title="Move library"
      width={620}
      onClose={stage === "running" ? () => undefined : closeModal}
      closeOnBackdrop={false}
    >
      <div
        style={{
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          fontFamily: "var(--read)",
          color: "var(--ink)",
          fontSize: 13,
        }}
      >
        {stage === "confirm" && (
          <>
            <div
              style={{
                fontSize: 12,
                background: "var(--paper-2)",
                padding: 10,
                borderRadius: 6,
                fontFamily: "var(--mono)",
                lineHeight: 1.6,
              }}
            >
              <div>
                <span style={{ color: "var(--ink-faint)" }}>from:</span>{" "}
                {tildify(fromLibrary)}
              </div>
              <div>
                <span style={{ color: "var(--ink-faint)" }}>to:</span>{" "}
                {tildify(toLibraryPath)}
              </div>
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={moveHistory}
                onChange={(e) => setMoveHistory(e.target.checked)}
              />
              Also move history snapshots ({tildify(fromHistory)} →{" "}
              {tildify(toHistorySibling)})
            </label>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button
                type="button"
                className="sk-btn ghost"
                onClick={closeModal}
                disabled={planning}
              >
                Cancel
              </button>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                className="sk-btn"
                onClick={onComputePlan}
                disabled={planning}
                style={{
                  background: "var(--accent)",
                  color: "var(--on-accent)",
                  borderColor: "var(--accent)",
                }}
              >
                {planning ? "Computing…" : "Compute plan →"}
              </button>
            </div>
          </>
        )}

        {stage === "preview" && plan && (
          <>
            <div
              style={{
                fontSize: 12,
                background: "var(--paper-2)",
                padding: 10,
                borderRadius: 6,
                fontFamily: "var(--mono)",
                lineHeight: 1.6,
              }}
            >
              <div>
                <span style={{ color: "var(--ink-faint)" }}>entries:</span>{" "}
                {plan.entries.length} ({(plan.totalBytes / 1024).toFixed(0)}{" "}
                KB)
              </div>
              <div>
                <span style={{ color: "var(--ink-faint)" }}>conflicts:</span>{" "}
                {plan.conflicts.length}
              </div>
              <div>
                <span style={{ color: "var(--ink-faint)" }}>
                  symlinks to rewrite:
                </span>{" "}
                {plan.symlinkRewrites.length}
              </div>
              <div>
                <span style={{ color: "var(--ink-faint)" }}>history:</span>{" "}
                {plan.toHistory ? `move to ${tildify(plan.toHistory)}` : "leave at source"}
              </div>
            </div>
            {plan.conflicts.length > 0 && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--warn)",
                }}
              >
                ⚠ {plan.conflicts.length} entr
                {plan.conflicts.length === 1 ? "y" : "ies"} already exist at
                the target and will be skipped: {plan.conflicts.join(", ")}
              </div>
            )}
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-soft)",
                fontStyle: "italic",
              }}
            >
              Per-entry atomic: copy → verify → re-point symlinks → delete
              source. Re-running the same plan is safe; failed entries
              don't block successful ones.
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button
                type="button"
                className="sk-btn ghost"
                onClick={() => setStage("confirm")}
              >
                ← Back
              </button>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                className="sk-btn"
                onClick={onRun}
                style={{
                  background: "var(--warn)",
                  color: "var(--on-warn)",
                  borderColor: "var(--warn)",
                }}
              >
                Run migration
              </button>
            </div>
          </>
        )}

        {stage === "running" && (
          <>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                background: "var(--paper-2)",
                borderRadius: 6,
                padding: 10,
                maxHeight: 320,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              {progress.map((m, i) => (
                <ProgressLine key={i} m={m} />
              ))}
              {progress.length === 0 && (
                <span style={{ color: "var(--ink-faint)" }}>working…</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button
                type="button"
                className="sk-btn ghost"
                onClick={onCancelRunning}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {stage === "complete" && result && (
          <>
            <div
              style={{
                fontSize: 12,
                background: "var(--paper-2)",
                padding: 10,
                borderRadius: 6,
                fontFamily: "var(--mono)",
                lineHeight: 1.6,
              }}
            >
              <div>
                <span style={{ color: "var(--ink-faint)" }}>moved:</span>{" "}
                {result.movedEntries.length}
              </div>
              <div>
                <span style={{ color: "var(--ink-faint)" }}>skipped:</span>{" "}
                {result.skippedEntries.length}
              </div>
              <div>
                <span style={{ color: "var(--ink-faint)" }}>
                  symlinks rewritten:
                </span>{" "}
                {result.rewrittenSymlinks}
              </div>
              <div>
                <span style={{ color: "var(--ink-faint)" }}>history:</span>{" "}
                {result.movedHistory ? "moved" : "stayed"}
              </div>
            </div>
            {result.skippedEntries.length > 0 && (
              <details>
                <summary style={{ fontSize: 12, cursor: "pointer" }}>
                  Skipped details
                </summary>
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--mono)",
                    color: "var(--ink-soft)",
                    marginTop: 6,
                  }}
                >
                  {result.skippedEntries.map((s, i) => (
                    <div key={i}>
                      {s.name}: {s.reason}
                    </div>
                  ))}
                </div>
              </details>
            )}
            {result.failedSymlinks.length > 0 && (
              <details>
                <summary style={{ fontSize: 12, cursor: "pointer" }}>
                  Failed symlink rewrites
                </summary>
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--mono)",
                    color: "var(--warn)",
                    marginTop: 6,
                  }}
                >
                  {result.failedSymlinks.map((f, i) => (
                    <div key={i}>
                      {f.entryName} @ {f.symlinkPath}: {f.error}
                    </div>
                  ))}
                </div>
              </details>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                className="sk-btn"
                onClick={closeModal}
                style={{
                  background: "var(--accent)",
                  color: "var(--on-accent)",
                  borderColor: "var(--accent)",
                }}
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function ProgressLine({ m }: { m: MigrationProgressMsg }) {
  const color =
    m.level === "error" || m.level === "warn"
      ? "var(--warn)"
      : m.level === "success"
        ? "var(--good)"
        : "var(--ink-soft)";
  const prefix =
    m.level === "success"
      ? "✓ "
      : m.level === "error"
        ? "✗ "
        : m.level === "warn"
          ? "! "
          : "";
  return (
    <div style={{ color }}>
      {prefix}
      {m.text}
    </div>
  );
}

// Suppress lint complaints about useEffect importing being unused if the
// component grows simpler; explicit reference for compatibility.
void useEffect;
