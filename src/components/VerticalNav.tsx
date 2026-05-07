// Vertical 3-tab navigation. Lives in the top-left of the LeftRail and
// stays anchored across every view (the right pane scrolls; this column
// does not). Sliding terracotta pill mirrors the original horizontal
// ViewSwitcher's motion language but on the Y axis.

import { useAppStore, type Tab } from "../state/store";

const ITEM_HEIGHT = 32;
const PADDING = 4;

const tabs: { id: Tab; label: string; icon: JSX.Element }[] = [
  {
    id: "library",
    label: "Library",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="2" y="2" width="3" height="10" />
        <rect x="6" y="2" width="3" height="10" />
        <rect x="10" y="3" width="2.5" height="9" transform="rotate(8 11 7.5)" />
      </svg>
    ),
  },
  {
    id: "deploy",
    label: "Deploy",
    // Diverging-arrows mark: a horizontal axis with a tick at the centre and
    // arrowheads pointing outward. Reads as "splitting up / sending out" —
    // skills going from one library to many projects.
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 7 H12 M5 4.5 L2 7 L5 9.5 M9 4.5 L12 7 L9 9.5 M7 4.5 V9.5" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="7" cy="7" r="2" />
        <path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4M2.8 11.2l1.4-1.4M9.8 4.2l1.4-1.4" />
      </svg>
    ),
  },
];

export function VerticalNav() {
  const active = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const idx = Math.max(
    0,
    tabs.findIndex((t) => t.id === active),
  );

  return (
    <nav
      role="tablist"
      aria-label="Primary"
      style={{
        position: "relative",
        padding: PADDING,
        border: "1.5px solid var(--line)",
        borderRadius: 14,
        background: "var(--paper-2)",
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      {/* Sliding terracotta indicator — y-axis travel mirrors the original
          horizontal pill's animation. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: PADDING + idx * ITEM_HEIGHT,
          left: PADDING,
          right: PADDING,
          height: ITEM_HEIGHT,
          background: "var(--accent)",
          borderRadius: 10,
          transition: "top 0.32s cubic-bezier(.6,.2,.2,1)",
          boxShadow: "0 1px 3px rgba(201,100,66,0.35)",
        }}
      />
      {tabs.map((t, i) => {
        const isActive = i === idx;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`view-${t.id}`}
            onClick={() => setActiveTab(t.id)}
            style={{
              position: "relative",
              width: "100%",
              height: ITEM_HEIGHT,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 10px",
              fontSize: 12,
              fontWeight: isActive ? 700 : 500,
              fontFamily: "var(--read)",
              // Theme-aware contrast: paper-on-accent reads as cream-on-
              // terracotta in light and black-on-green in dark. White on
              // bright green fails AA contrast badly.
              color: isActive ? "var(--paper)" : "var(--ink-soft)",
              background: "transparent",
              border: "none",
              borderRadius: 10,
              cursor: "pointer",
              userSelect: "none",
              transition: "color 0.2s",
              textAlign: "left",
              zIndex: 1,
            }}
          >
            <span aria-hidden style={{ display: "inline-flex" }}>
              {t.icon}
            </span>
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
