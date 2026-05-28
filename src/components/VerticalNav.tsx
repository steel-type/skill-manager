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
    id: "stacks",
    label: "Stacks",
    // Three horizontal slabs stacked with a small gap. Reads as "layered
    // bundle" — matches the StackBadge that appears on member skill cards.
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2.5" width="10" height="2.5" rx="0.6" />
        <rect x="2" y="5.75" width="10" height="2.5" rx="0.6" />
        <rect x="2" y="9" width="10" height="2.5" rx="0.6" />
      </svg>
    ),
  },
  {
    id: "deploy",
    label: "Deploy",
    // V-shape diverging arrows: two legs originate at the centre-bottom and
    // travel outward to the upper corners, each capped with an arrowhead
    // whose strokes splay symmetrically along the back-of-shaft direction
    // (~±35°). Reads as "splitting up / sending out" — one source, many
    // destinations — with the tips spaced wide so the arrows feel distinct
    // from a decorative chevron.
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 12 L1.5 2 M7 12 L12.5 2 M1.5 2 L1.4 5.5 M1.5 2 L4.5 3.8 M12.5 2 L12.6 5.5 M12.5 2 L9.5 3.8" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    // Cog: outer ring + central hub + 8 short teeth poking out at the
    // cardinal and diagonal directions. Was previously a sun-with-rays
    // which read as a brightness toggle in dark mode.
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="7" cy="7" r="3.4" />
        <circle cx="7" cy="7" r="1.4" />
        <path d="M7 0.8 V2.4 M7 11.6 V13.2 M0.8 7 H2.4 M11.6 7 H13.2 M2.6 2.6 L3.7 3.7 M10.3 10.3 L11.4 11.4 M2.6 11.4 L3.7 10.3 M10.3 3.7 L11.4 2.6" />
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
        boxShadow: "inset 0 1px 2px var(--inset-shadow)",
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
          boxShadow: "0 1px 3px var(--active-shadow)",
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
