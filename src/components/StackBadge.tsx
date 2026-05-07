// Small "this skill is part of N stacks" indicator, shown in the top-right
// corner of a SkillCard. Reuses the three-stacked-rectangles glyph from
// the Stacks tab so members of any stack are visually linked back to the
// composition surface.

interface StackBadgeProps {
  /** Names of stacks that include this skill — drives the tooltip. */
  stackNames: string[];
}

export function StackBadge({ stackNames }: StackBadgeProps) {
  if (stackNames.length === 0) return null;
  const tooltip = `In stacks: ${stackNames.join(", ")}`;
  return (
    <span
      aria-label={tooltip}
      title={tooltip}
      style={{
        position: "absolute",
        top: 6,
        right: 6,
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 4px",
        background: "var(--paper-2)",
        border: "1px solid var(--line-soft)",
        borderRadius: 4,
        color: "var(--ink-faint)",
        fontFamily: "var(--mono)",
        fontSize: 9,
        lineHeight: 1,
        pointerEvents: "auto",
      }}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="2" y="2.5" width="10" height="2.5" rx="0.6" />
        <rect x="2" y="5.75" width="10" height="2.5" rx="0.6" />
        <rect x="2" y="9" width="10" height="2.5" rx="0.6" />
      </svg>
      <span>{stackNames.length}</span>
    </span>
  );
}
