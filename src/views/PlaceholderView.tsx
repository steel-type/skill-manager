// Stage-1 placeholder. Replaced in Stage 2 (LibraryView) and Stage 3
// (DeployView, SettingsView) with the real content.

interface PlaceholderViewProps {
  title: string;
  hint: string;
}

export function PlaceholderView({ title, hint }: PlaceholderViewProps) {
  return (
    <div
      style={{
        flex: 1,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        color: "var(--ink-soft)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--hand)",
          fontSize: 28,
          color: "var(--ink)",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: "var(--read)",
          fontSize: 13,
          color: "var(--ink-faint)",
          maxWidth: 360,
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        {hint}
      </div>
    </div>
  );
}
