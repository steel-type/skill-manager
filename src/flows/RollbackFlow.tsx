// Rollback flow modal — pick a snapshot from history, optionally cascade
// the older version back into deployed projects, confirm.
//
// Snapshots come from `~/.claude/skills-history/<name>/<commit>/`; the
// listSkillHistory IPC decorates them with size + existence info.

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../components/Modal";
import { useAppStore } from "../state/store";
import { withCancellable } from "../lib/cancellable";
import type { HistoryEntry } from "../../electron/services/types";

type Phase = "loading" | "choose" | "running" | "done" | "error" | "cancelled";

function isCancelledError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /cancel/i.test(msg);
}

interface RollbackFlowProps {
  name: string;
}

function relativeTime(iso: string): string {
  // Append Z if missing — timestamps written by older nowIso() output (and
  // any Python-era config carryover) lack the trailing Z, so JS parses them
  // as local time, which made every snapshot read as "just now".
  const safe = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const t = new Date(safe).getTime();
  if (isNaN(t)) return iso;
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  if (day < 30) return `${Math.floor(day / 7)}w ago`;
  return `${Math.floor(day / 30)}mo ago`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function RollbackFlow({ name }: RollbackFlowProps) {
  const closeModal = useAppStore((s) => s.closeModal);
  const skills = useAppStore((s) => s.skills);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const setError = useAppStore((s) => s.setError);
  const settings = useAppStore((s) => s.settings);

  const skill = useMemo(() => skills.find((s) => s.name === name), [skills, name]);

  const [phase, setPhase] = useState<Phase>("loading");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [cascade, setCascade] = useState(true);
  const [log, setLog] = useState<string[]>([]);
  const [error, setLocalError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entries = await window.api.listSkillHistory(name);
        if (cancelled) return;
        setHistory(entries);
        const firstAvailable = entries.find((e) => e.exists);
        setSelected(firstAvailable?.commit ?? null);
        setPhase("choose");
      } catch (err) {
        if (cancelled) return;
        setLocalError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [name]);

  if (!skill) return null;

  const usableHistory = history.filter((h) => h.exists);
  const projectCount = skill.projects.length;
  const canCascade = projectCount > 0 && settings.cascade_updates;

  const performRollback = async () => {
    if (!selected) return;
    setPhase("running");
    setLog([`$ rollback ${name} ${selected}`]);
    abortRef.current = new AbortController();
    try {
      await withCancellable(abortRef.current.signal, (streamId) =>
        window.api.rollbackSkill(
          name,
          selected,
          cascade && canCascade,
          streamId,
          (line) => setLog((prev) => [...prev, line]),
        ),
      );
      await refreshSkills();
      await refreshProjects();
      setPhase("done");
    } catch (err) {
      if (isCancelledError(err)) {
        setPhase("cancelled");
      } else {
        setLocalError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const close = () => {
    if (phase === "running") {
      handleCancel();
      return;
    }
    closeModal();
    if (phase === "done") setError(null);
  };

  const title =
    phase === "running"
      ? `Rolling back ${skill.displayName}…`
      : phase === "done"
        ? `Rolled back ${skill.displayName}`
        : phase === "cancelled"
          ? "Rollback cancelled"
          : phase === "error"
            ? "Rollback failed"
            : `Roll back ${skill.displayName}`;

  return (
    <Modal
      open
      title={title}
      width={480}
      height={540}
      onClose={close}
      closeOnBackdrop={phase !== "running"}
    >
      <div
        style={{
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          flex: 1,
          minHeight: 0,
          overflow: "auto",
        }}
      >
        <div className="hand" style={{ color: "var(--ink-soft)", fontSize: 14 }}>
          current version{" "}
          <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
            {skill.commit ?? "unknown"}
          </span>
          {" "}will be archived to history before rollback (reversible)
        </div>

        {phase === "loading" && (
          <div style={{ padding: 24, color: "var(--ink-faint)" }}>
            Loading snapshots…
          </div>
        )}

        {phase === "choose" && usableHistory.length === 0 && (
          <div
            className="sk-box"
            style={{
              padding: 16,
              fontSize: 13,
              color: "var(--ink-soft)",
              textAlign: "center",
            }}
          >
            No snapshots available.
            {history.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 11, color: "var(--warn)" }}>
                {history.length} record{history.length === 1 ? "" : "s"} in
                config but the snapshot directories were removed.
              </div>
            )}
            {settings.update_history_retention === 0 && (
              <div style={{ marginTop: 8, fontSize: 11 }}>
                Snapshot retention is disabled in Settings — turn it on to
                start archiving updates.
              </div>
            )}
          </div>
        )}

        {phase === "choose" && usableHistory.length > 0 && (
          <>
            <div className="rail-section" style={{ padding: 0 }}>
              Available snapshots · {usableHistory.length}
            </div>
            <div
              className="sk-box"
              style={{ padding: 0, overflow: "auto", minHeight: 0 }}
            >
              {history.map((entry, i) => {
                const disabled = !entry.exists;
                const isSelected = selected === entry.commit;
                return (
                  <label
                    key={entry.commit}
                    onClick={() => {
                      if (!disabled) setSelected(entry.commit);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 14px",
                      borderBottom:
                        i < history.length - 1
                          ? "1px dashed var(--line-soft)"
                          : "none",
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.5 : 1,
                      background: isSelected ? "var(--card-selected-bg)" : "transparent",
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        border: "1.5px solid var(--line)",
                        background: isSelected ? "var(--ink)" : "var(--paper)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {isSelected && (
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "var(--paper)",
                          }}
                        />
                      )}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {entry.commit}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--ink-faint)",
                        }}
                      >
                        archived {relativeTime(entry.archived_at)} ·{" "}
                        {formatBytes(entry.sizeBytes)}
                        {disabled && (
                          <span style={{ color: "var(--warn)" }}>
                            {" "}
                            · missing on disk
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            {projectCount > 0 && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  cursor: canCascade ? "pointer" : "not-allowed",
                  opacity: canCascade ? 1 : 0.6,
                }}
                title={
                  canCascade
                    ? undefined
                    : "Cascade is OFF in Settings — turn it on to re-deploy on rollback."
                }
              >
                <input
                  type="checkbox"
                  checked={cascade && canCascade}
                  disabled={!canCascade}
                  onChange={(e) => setCascade(e.target.checked)}
                />
                Re-deploy older version to {projectCount} project
                {projectCount === 1 ? "" : "s"}
                {!canCascade && " (cascade disabled in settings)"}
              </label>
            )}
          </>
        )}

        {(phase === "running" ||
          phase === "done" ||
          phase === "error" ||
          phase === "cancelled") && (
          <div
            className="sk-box"
            style={{
              padding: 10,
              fontFamily: "var(--mono)",
              fontSize: 11,
              lineHeight: 1.6,
              background: "var(--terminal-bg)",
              color: "var(--terminal-fg)",
              borderColor: "var(--terminal-border)",
              flex: 1,
              minHeight: 120,
              overflow: "auto",
            }}
          >
            {log.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            {phase === "done" && (
              <div style={{ color: "var(--good)" }}>✓ Rollback complete</div>
            )}
            {phase === "error" && error && (
              <div style={{ color: "var(--warn)" }}>✗ {error}</div>
            )}
            {phase === "cancelled" && (
              <div style={{ color: "var(--ink-faint)" }}>
                ⊘ Cancelled by user
              </div>
            )}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0 }} />
        <div style={{ display: "flex", gap: 6 }}>
          <button className="sk-btn ghost" onClick={close}>
            {phase === "done"
              ? "Close"
              : phase === "running"
                ? "Cancel rollback"
                : "Cancel"}
          </button>
          <div style={{ flex: 1 }} />
          {phase === "choose" && (
            <button
              className="sk-btn primary"
              disabled={!selected || usableHistory.length === 0}
              onClick={performRollback}
            >
              Roll back →
            </button>
          )}
          {phase === "done" && (
            <button className="sk-btn primary" onClick={close}>
              Done
            </button>
          )}
          {(phase === "error" || phase === "cancelled") && (
            <button className="sk-btn" onClick={() => setPhase("choose")}>
              Try again
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
