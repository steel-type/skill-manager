// Confirmation modal for deleting a stack. Two outcomes:
//   - Cleanup: remove the meta-skill SKILL.md from every tracked project
//     deployment, then drop the stack from config. Member skill files are
//     intentionally left in place — same skill may be deployed standalone.
//   - No cleanup: only the config entries are dropped; meta-skill files
//     stay on disk for the user to clean up manually.

import { useMemo, useState } from "react";
import { Modal } from "../components/Modal";
import { useAppStore } from "../state/store";

interface DeleteStackFlowProps {
  stackId: string;
}

export function DeleteStackFlow({ stackId }: DeleteStackFlowProps) {
  const closeModal = useAppStore((s) => s.closeModal);
  const stacks = useAppStore((s) => s.stacks);
  const stackDeployments = useAppStore((s) => s.stackDeployments);
  const deleteStack = useAppStore((s) => s.deleteStack);
  const setError = useAppStore((s) => s.setError);

  const stack = useMemo(
    () => stacks.find((s) => s.id === stackId),
    [stacks, stackId],
  );
  const deployments = useMemo(
    () => stackDeployments.filter((d) => d.stackId === stackId),
    [stackDeployments, stackId],
  );

  const [cleanup, setCleanup] = useState(false);
  const [running, setRunning] = useState(false);

  if (!stack) return null;

  const onConfirm = async () => {
    setRunning(true);
    try {
      await deleteStack(stackId, cleanup);
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  };

  return (
    <Modal
      open
      title="Delete stack — confirm"
      width={480}
      onClose={running ? () => {} : closeModal}
      closeOnBackdrop={!running}
    >
      <div
        style={{
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          flex: 1,
          minHeight: 0,
          overflow: "auto",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700 }}>
          Delete stack{" "}
          <span style={{ fontFamily: "var(--mono)", fontSize: 15 }}>
            {stack.name}
          </span>
          ?
        </div>
        <div className="hand" style={{ color: "var(--ink-soft)", fontSize: 15 }}>
          {deployments.length === 0
            ? "no projects host this stack right now"
            : `currently deployed to ${deployments.length} project${deployments.length === 1 ? "" : "s"}`}
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: 12,
            cursor: deployments.length === 0 ? "not-allowed" : "pointer",
            opacity: deployments.length === 0 ? 0.5 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={cleanup}
            onChange={(e) => setCleanup(e.target.checked)}
            disabled={deployments.length === 0}
          />
          <span>
            <div style={{ fontWeight: 600 }}>
              Remove the meta-skill from each project
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>
              member skill files stay on disk — they may be deployed
              standalone or via another stack.
            </div>
          </span>
        </label>

        <div style={{ flex: 1, minHeight: 0 }} />
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className="sk-btn ghost"
            onClick={closeModal}
            disabled={running}
          >
            Cancel
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="sk-btn"
            style={{
              background: "var(--warn)",
              color: "white",
              borderColor: "var(--warn)",
            }}
            disabled={running}
            onClick={onConfirm}
          >
            {running ? "Deleting…" : cleanup ? "Delete + clean up" : "Delete stack"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
