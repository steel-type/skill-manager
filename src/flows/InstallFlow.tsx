// Install flow modal — paste URL, watch live git output, see bundle preview
// when the clone finishes. Ported from design-reference/variations/flows.jsx
// InstallFlow.

import { useEffect, useRef, useState } from "react";
import { Modal } from "../components/Modal";
import { useAppStore } from "../state/store";
import { withCancellable } from "../lib/cancellable";
import type { InstallResult } from "../../electron/services/types";

type Phase = "input" | "cloning" | "done" | "error" | "cancelled";

function isCancelledError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /cancel/i.test(msg);
}

interface InstallFlowProps {
  prefillUrl?: string;
}

export function InstallFlow({ prefillUrl }: InstallFlowProps) {
  const closeModal = useAppStore((s) => s.closeModal);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const refreshProjects = useAppStore((s) => s.refreshProjects);

  const [url, setUrl] = useState(prefillUrl ?? "");
  const [phase, setPhase] = useState<Phase>("input");
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // If the modal is force-closed mid-clone (Escape, route change), abort the
  // running operation so the git child gets killed.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleInstall = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setPhase("cloning");
    setLog([`$ install ${trimmed}`]);
    setError(null);
    abortRef.current = new AbortController();
    try {
      const r = await withCancellable(
        abortRef.current.signal,
        (streamId) =>
          window.api.installFromUrl(trimmed, streamId, (line) =>
            setLog((prev) => [...prev, line]),
          ),
      );
      setResult(r);
      setPhase("done");
      await refreshSkills();
      await refreshProjects();
    } catch (err) {
      if (isCancelledError(err)) {
        setPhase("cancelled");
      } else {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const close = () => {
    if (phase === "cloning") {
      // Treat the dismiss action as a cancel request rather than blocking.
      handleCancel();
      return;
    }
    closeModal();
  };

  const title =
    phase === "done"
      ? "Install Skill — done"
      : phase === "error"
        ? "Install Skill — error"
        : phase === "cancelled"
          ? "Install Skill — cancelled"
          : phase === "cloning"
            ? "Install Skill — installing…"
            : "Install Skill";

  return (
    <Modal
      open
      title={title}
      width={580}
      height={520}
      onClose={close}
      closeOnBackdrop={phase !== "cloning"}
    >
      <div
        style={{
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          flex: 1,
          minHeight: 0,
        }}
      >
        {phase === "input" && (
          <>
            <div className="rail-section" style={{ padding: 0 }}>
              source
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              Install from GitHub
            </div>
            <div className="hand" style={{ color: "var(--ink-faint)" }}>
              shallow clone, captures commit SHA, copies into your library
            </div>
            <input
              className="sk-input"
              autoFocus
              placeholder="https://github.com/anthropic/anthropic-skills"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleInstall();
              }}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 13,
                padding: "10px 12px",
              }}
            />
          </>
        )}

        {(phase === "cloning" ||
          phase === "done" ||
          phase === "error" ||
          phase === "cancelled") && (
          <>
            <div className="rail-section" style={{ padding: 0 }}>
              {phase === "cloning"
                ? "cloning"
                : phase === "done"
                  ? "complete"
                  : phase === "cancelled"
                    ? "cancelled"
                    : "failed"}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {phase === "done"
                ? `Installed ${result?.name}`
                : `Installing from GitHub`}
            </div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--ink-faint)",
              }}
            >
              {url}
            </div>

            {phase === "cloning" && (
              <ProgressStrip />
            )}

            <div
              ref={logRef}
              className="sk-box"
              style={{
                padding: 10,
                fontFamily: "var(--mono)",
                fontSize: 11,
                lineHeight: 1.6,
                background: "#1c1c1c",
                color: "#d8d8d8",
                borderColor: "#333",
                flex: 1,
                minHeight: 120,
                overflow: "auto",
              }}
            >
              {log.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
              {phase === "done" && (
                <div style={{ color: "var(--good)" }}>
                  ✓ Installed{result?.commit ? ` · ${result.commit}` : ""}
                </div>
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

            {phase === "done" && result?.isBundle && (
              <div
                className="sk-box dashed"
                style={{ padding: 10, background: "#f7f6ee" }}
              >
                <div
                  className="rail-section"
                  style={{ padding: 0, marginBottom: 4 }}
                >
                  Bundle — {result.bundleSize} skills inside
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--ink-soft)",
                  }}
                >
                  Browse the library folder to deploy individual skills, or
                  deploy the bundle as a whole.
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ flex: 1, minHeight: 0 }} />

        <div style={{ display: "flex", gap: 6 }}>
          <button className="sk-btn ghost" onClick={close}>
            {phase === "done"
              ? "Close"
              : phase === "cloning"
                ? "Cancel install"
                : "Cancel"}
          </button>
          <div style={{ flex: 1 }} />
          {phase === "input" && (
            <button
              className="sk-btn primary"
              disabled={!url.trim()}
              onClick={handleInstall}
            >
              Install
            </button>
          )}
          {(phase === "error" || phase === "cancelled") && (
            <button className="sk-btn" onClick={() => setPhase("input")}>
              Try again
            </button>
          )}
          {phase === "done" && (
            <button className="sk-btn primary" onClick={close}>
              Done
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ProgressStrip() {
  // Indeterminate-feeling barber-pole — git's own % output drives the log;
  // this is just a visual heartbeat so the modal doesn't look frozen.
  return (
    <div
      style={{
        height: 8,
        background: "var(--paper-2)",
        borderRadius: 4,
        border: "1px solid var(--line)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          width: "30%",
          height: "100%",
          background: "var(--accent)",
          animation: "install-progress 1.6s linear infinite",
        }}
      />
      <style>{`
        @keyframes install-progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(380%); }
        }
      `}</style>
    </div>
  );
}
