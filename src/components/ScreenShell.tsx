// Shared chrome for screen-style takeover flows (Update, SkillDetail).
// Renders a sticky top bar with a Back breadcrumb on the left and the
// title, then fills the rest of the right pane with `children`. The
// LeftRail stays anchored at the App level — this component only owns
// the right-pane real estate.

import { ReactNode } from "react";

interface ScreenShellProps {
  title: string;
  onBack: () => void;
  /** Optional tooltip on the Back button. Used to explain a deferred-back
   *  state (e.g. "press again to cancel the running operation"). */
  backDisabledReason?: string;
  /** Inline content rendered to the right of the title — useful for
   *  per-screen actions (e.g. a "Refresh" button on a detail view). */
  rightSlot?: ReactNode;
  children: ReactNode;
}

export function ScreenShell({
  title,
  onBack,
  backDisabledReason,
  rightSlot,
  children,
}: ScreenShellProps) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: "1px dashed var(--line-soft)",
          background: "var(--paper)",
          flexShrink: 0,
        }}
      >
        <button
          className="sk-btn sm ghost"
          onClick={onBack}
          title={backDisabledReason ?? "back"}
          style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
        >
          ← Back
        </button>
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "var(--ink)",
            flex: 1,
          }}
        >
          {title}
        </div>
        {rightSlot}
      </div>
      {children}
    </div>
  );
}
