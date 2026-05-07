// Ported from design-reference/variations/view-switcher.jsx.
// 3 tabs (Library / Deploy / Settings) with sliding terracotta indicator.
// Lives top-right of the active view's content area.

import type { Tab } from "../state/store";

interface ViewSwitcherProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const TAB_W = 80;

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
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 1.5v8M3.5 6L7 9.5 10.5 6M2 12h10" />
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

export function ViewSwitcher({ active, onChange }: ViewSwitcherProps) {
  const idx = Math.max(
    0,
    tabs.findIndex((t) => t.id === active),
  );

  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        padding: 3,
        border: "1.5px solid var(--line)",
        borderRadius: 22,
        background: "var(--paper-2)",
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 3,
          left: 3 + idx * TAB_W,
          width: TAB_W,
          height: 26,
          background: "var(--accent)",
          borderRadius: 18,
          transition: "left 0.32s cubic-bezier(.6,.2,.2,1)",
          boxShadow: "0 1px 3px rgba(201,100,66,0.35)",
        }}
      />
      {tabs.map((t, i) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          style={{
            position: "relative",
            width: TAB_W,
            height: 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            fontSize: 11,
            fontWeight: i === idx ? 700 : 500,
            fontFamily: "var(--read)",
            color: i === idx ? "white" : "var(--ink-soft)",
            cursor: "pointer",
            userSelect: "none",
            zIndex: 1,
            transition: "color 0.2s",
            background: "transparent",
            border: "none",
            padding: 0,
          }}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
