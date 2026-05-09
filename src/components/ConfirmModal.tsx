// Generic confirmation dialog. Replaces window.confirm() so popups honor
// the app theme (rounded corners, dark mode tokens) instead of using the
// OS-native square dialog.

import { useState } from "react";
import { Modal } from "./Modal";
import { useAppStore } from "../state/store";

export function ConfirmModal() {
  const modal = useAppStore((s) => s.modal);
  const closeModal = useAppStore((s) => s.closeModal);
  const setError = useAppStore((s) => s.setError);
  const [running, setRunning] = useState(false);

  if (!modal || modal.type !== "confirm") return null;

  const onConfirm = async () => {
    if (running) return;
    setRunning(true);
    try {
      await modal.onConfirm();
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  // When the modal carries an onCancel, the cancel button is a SECOND
  // action rather than a "back out" — wire it through the same
  // running/error guards as confirm.
  const onCancelButton = async () => {
    if (running) return;
    if (!modal.onCancel) {
      closeModal();
      return;
    }
    setRunning(true);
    try {
      await modal.onCancel();
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal open title={modal.title} width={400} onClose={closeModal}>
      <div
        style={{
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          fontFamily: "var(--read)",
          color: "var(--ink)",
          fontSize: 13,
          lineHeight: 1.45,
        }}
      >
        <div style={{ whiteSpace: "pre-wrap" }}>{modal.body}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button
            type="button"
            className="sk-btn ghost"
            onClick={onCancelButton}
            disabled={running}
          >
            {modal.cancelLabel ?? "Cancel"}
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="sk-btn"
            disabled={running}
            onClick={onConfirm}
            style={{
              background: modal.destructive ? "var(--warn)" : "var(--ink)",
              color: modal.destructive ? "var(--on-warn)" : "var(--paper)",
              borderColor: modal.destructive ? "var(--warn)" : "var(--ink)",
            }}
          >
            {running ? "…" : (modal.confirmLabel ?? "Confirm")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
