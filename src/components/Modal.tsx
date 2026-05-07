// Generic modal shell. Uses a portal-free fixed-position overlay (Electron
// only ever has one window so a portal is unnecessary). The modal body is a
// .sk-box.shadow inside a .wf chrome to keep the sketchy aesthetic.

import { useEffect, useRef, ReactNode } from "react";

interface ModalProps {
  open: boolean;
  title: string;
  width?: number;
  height?: number | string;
  onClose: () => void;
  closeOnBackdrop?: boolean;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled]), a[href]';

export function Modal({
  open,
  title,
  width = 560,
  height = "auto",
  onClose,
  closeOnBackdrop = true,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  // Escape closes; Tab is trapped within the modal so keyboard users can't
  // accidentally focus the (hidden) underlying tab content.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        FOCUSABLE_SELECTOR,
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Auto-focus the first focusable element when the modal opens; restore
  // focus to the previously-focused element on close. Without this,
  // keyboard users land on body after a close and lose context.
  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    const id = window.setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        FOCUSABLE_SELECTOR,
      );
      first?.focus();
    }, 0);
    return () => {
      window.clearTimeout(id);
      const previous = triggerRef.current;
      if (previous && previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="wf"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(42,42,42,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        padding: 24,
      }}
    >
      <div
        ref={dialogRef}
        className="wf-window"
        style={{
          width,
          maxWidth: "95vw",
          maxHeight: "90vh",
          height,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="wf-titlebar" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <div className="wf-tlights">
            <button
              className="tl"
              aria-label="Close"
              onClick={onClose}
              style={{
                background: "#ff736a",
                cursor: "pointer",
                padding: 0,
                border: "1px solid var(--line)",
              }}
            />
            <div className="tl" />
            <div className="tl" />
          </div>
          <div className="wf-title">{title}</div>
          <div style={{ width: 30 }} />
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
