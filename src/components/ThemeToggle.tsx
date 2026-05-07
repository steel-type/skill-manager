// Sun ↔ Moon two-position slider for the theme. Persisted via the existing
// settings system. Mirrors the LayoutToggle's geometry so the LeftRail has
// a visual rhythm of small, paired controls.

import { useAppStore } from "../state/store";
import type { Theme } from "../../electron/services/types";

const TAB_W = 40;

interface ThemeToggleProps {
  /** Compact label-less mode for tight spaces (e.g. LeftRail bottom). */
  compact?: boolean;
}

const SunIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="7" cy="7" r="2.6" />
    <path d="M7 1v1.6M7 11.4V13M1 7h1.6M11.4 7H13M2.8 2.8l1.1 1.1M10.1 10.1l1.1 1.1M2.8 11.2l1.1-1.1M10.1 3.9l1.1-1.1" />
  </svg>
);

const MoonIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.5 8.4A4.6 4.6 0 0 1 5.6 2.5a5 5 0 1 0 5.9 5.9z" />
  </svg>
);

const options: { id: Theme; label: string; icon: JSX.Element; aria: string }[] = [
  { id: "light", label: "Light", icon: <SunIcon />, aria: "Light theme" },
  { id: "dark", label: "Dark", icon: <MoonIcon />, aria: "Dark theme" },
];

export function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const idx = settings.theme === "dark" ? 1 : 0;

  const itemWidth = compact ? TAB_W : TAB_W + 32;

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      style={{
        position: "relative",
        display: "inline-flex",
        padding: 3,
        border: "1.5px solid var(--line-soft)",
        borderRadius: 18,
        background: "var(--paper-2)",
      }}
      title="Toggle light / dark theme"
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 3,
          left: 3 + idx * itemWidth,
          width: itemWidth,
          height: 22,
          background: "var(--ink)",
          borderRadius: 14,
          transition: "left 0.28s cubic-bezier(.6,.2,.2,1)",
        }}
      />
      {options.map((o, i) => {
        const isActive = i === idx;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={o.aria}
            onClick={() => updateSettings({ theme: o.id })}
            style={{
              position: "relative",
              width: itemWidth,
              height: 22,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              fontSize: 11,
              fontWeight: isActive ? 700 : 500,
              fontFamily: "var(--read)",
              color: isActive ? "var(--paper)" : "var(--ink-soft)",
              zIndex: 1,
              transition: "color 0.2s",
              padding: 0,
            }}
          >
            {o.icon}
            {!compact && <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
