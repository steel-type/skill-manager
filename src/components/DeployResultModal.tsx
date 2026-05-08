// Shows the outcome of a Deploy run as a real modal so it doesn't push
// the deploy view's three-column layout around the way an inline card
// did. Title is computed from the message list (success / warnings /
// failure) so the user knows the outcome at a glance.

import { Modal } from "./Modal";
import { useAppStore, type DeployResultMessage } from "../state/store";

function classifyOutcome(messages: DeployResultMessage[]): {
  title: string;
  tone: "good" | "warn" | "error";
} {
  const hasError = messages.some((m) => m.level === "error");
  const hasWarn = messages.some((m) => m.level === "warn");
  if (hasError) return { title: "Deploy failed", tone: "error" };
  if (hasWarn) return { title: "Deployed with warnings", tone: "warn" };
  return { title: "Deployed", tone: "good" };
}

export function DeployResultModal() {
  const modal = useAppStore((s) => s.modal);
  const closeModal = useAppStore((s) => s.closeModal);
  if (!modal || modal.type !== "deployResult") return null;

  const { title, tone } = classifyOutcome(modal.messages);
  const subtitle =
    modal.itemKind === "stack"
      ? `Stack ${modal.itemId}`
      : `Skill ${modal.itemId}`;

  return (
    <Modal open title={title} width={520} onClose={closeModal}>
      <div
        style={{
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          fontFamily: "var(--read)",
          color: "var(--ink)",
          fontSize: 12,
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-faint)",
          }}
        >
          {subtitle}
        </div>
        <div
          className="sk-box"
          style={{
            padding: 10,
            background: "var(--paper-2)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {modal.messages.map((m, i) => (
            <div
              key={i}
              style={{
                fontSize: 11,
                fontFamily: "var(--mono)",
                color:
                  m.level === "error"
                    ? "var(--warn)"
                    : m.level === "warn"
                      ? "var(--warn)"
                      : m.level === "success"
                        ? "var(--good)"
                        : "var(--ink-soft)",
              }}
            >
              {m.level === "success"
                ? "✓ "
                : m.level === "error"
                  ? "✗ "
                  : m.level === "warn"
                    ? "! "
                    : ""}
              {m.text}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="sk-btn"
            onClick={closeModal}
            style={{
              background:
                tone === "error"
                  ? "var(--warn)"
                  : tone === "warn"
                    ? "var(--warn)"
                    : "var(--accent)",
              color:
                tone === "error" || tone === "warn"
                  ? "var(--on-warn)"
                  : "var(--on-accent)",
              borderColor:
                tone === "error" || tone === "warn"
                  ? "var(--warn)"
                  : "var(--accent)",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
