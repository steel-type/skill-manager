// Blue two-position slider — toggles the Library between "cards" (default
// grid) and "palette" (the same verb-driven UI used by the global ⌘K
// overlay, but rendered inline in the Library so power users can browse
// + search without dismissing it).
//
// Note: ⌘K used to drive this toggle, but as of the Stacks build it opens
// a global command overlay instead. This button is the canonical way to
// switch the Library skill list into palette mode.

import { useAppStore, type LibraryLayout } from "../state/store";

const TAB_W = 64;
// Pulled from --accent-2 at runtime so the toggle adopts the dark theme's
// green accent automatically (where --accent-2 is unified with --accent).
const TOGGLE_COLOR = "var(--accent-2)";

const options: { id: LibraryLayout; label: string; icon: JSX.Element }[] = [
  {
    id: "cards",
    label: "Cards",
    icon: (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="1" y="1" width="4" height="4" rx="0.5" />
        <rect x="7" y="1" width="4" height="4" rx="0.5" />
        <rect x="1" y="7" width="4" height="4" rx="0.5" />
        <rect x="7" y="7" width="4" height="4" rx="0.5" />
      </svg>
    ),
  },
  {
    id: "palette",
    label: "List",
    icon: (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M2 4l2 2-2 2M6 8h4" />
      </svg>
    ),
  },
];

export function LayoutToggle() {
  const layout = useAppStore((s) => s.libraryLayout);
  const setLayout = useAppStore((s) => s.setLibraryLayout);
  const idx = Math.max(0, options.findIndex((o) => o.id === layout));

  return (
    <div
      role="tablist"
      style={{
        position: "relative",
        display: "inline-flex",
        padding: 3,
        border: `1.5px solid ${TOGGLE_COLOR}`,
        borderRadius: 18,
        background: "var(--toggle-tint)",
      }}
      title="Toggle library layout — Cards / List. Press ⌘K for the global command palette."
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 3,
          left: 3 + idx * TAB_W,
          width: TAB_W,
          height: 22,
          background: TOGGLE_COLOR,
          borderRadius: 14,
          transition: "left 0.28s cubic-bezier(.6,.2,.2,1)",
          boxShadow: "0 1px 3px var(--toggle-shadow)",
        }}
      />
      {options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          onClick={() => setLayout(o.id)}
          style={{
            position: "relative",
            width: TAB_W,
            height: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            fontSize: 11,
            fontWeight: i === idx ? 700 : 500,
            fontFamily: "var(--read)",
            color: i === idx ? "var(--on-accent-2)" : TOGGLE_COLOR,
            zIndex: 1,
            transition: "color 0.2s",
          }}
        >
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
