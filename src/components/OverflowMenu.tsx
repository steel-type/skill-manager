// Lightweight dropdown menu — opens below the trigger, closes on outside
// click or Escape. Used for per-skill-card actions (Browse, Update, Remove).

import {
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

export interface MenuItem {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export function OverflowMenu({
  items,
  trigger,
}: {
  items: MenuItem[];
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        wrapRef.current &&
        !wrapRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        className="sk-btn sm"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          // Stop Enter/Space from bubbling up to a parent role="button"
          // (e.g. SkillCard) — without this, opening the menu would also
          // toggle the card's selection.
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
          }
        }}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ padding: "3px 8px" }}
      >
        {trigger ?? "⋯"}
      </button>
      {open && (
        <div
          role="menu"
          className="sk-box shadow"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: 140,
            background: "var(--paper)",
            zIndex: 50,
            padding: 4,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              role="menuitem"
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                item.onClick();
              }}
              style={{
                textAlign: "left",
                padding: "6px 10px",
                fontSize: 12,
                fontFamily: "var(--read)",
                color: item.destructive ? "var(--warn)" : "var(--ink)",
                background: "transparent",
                borderRadius: 4,
                cursor: item.disabled ? "not-allowed" : "pointer",
                opacity: item.disabled ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!item.disabled)
                  e.currentTarget.style.background = "var(--paper-2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
