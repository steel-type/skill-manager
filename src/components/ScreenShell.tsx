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
  /** Sticky footer rendered below `children` with a dashed top border
   *  and the same vertical padding as the LeftRail's theme dock. Used
   *  for primary action rows (Send to Deploy, Update N, Import N, etc)
   *  so they stay reachable regardless of how far the user scrolls.
   *  Pair with a `flex: 1; overflow: auto` content wrapper around the
   *  scrolling region inside `children`. */
  footerSlot?: ReactNode;
  children: ReactNode;
}

export function ScreenShell({
  title,
  onBack,
  backDisabledReason,
  rightSlot,
  footerSlot,
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
      {footerSlot && (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            alignItems: "center",
            flexShrink: 0,
            padding: "12px 18px",
            borderTop: "1px dashed var(--line-soft)",
            background: "var(--paper)",
          }}
        >
          {footerSlot}
        </div>
      )}
    </div>
  );
}
