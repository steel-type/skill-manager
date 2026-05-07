// Yellow update banner shown above the card grid when checkUpdates finds
// pending updates. Tilted slightly per the wireframe.

interface UpdateBannerProps {
  count: number;
  cascadeCount: number;
  onReview: () => void;
}

export function UpdateBanner({
  count,
  cascadeCount,
  onReview,
}: UpdateBannerProps) {
  return (
    <div
      className="sk-box shadow tilt-l"
      style={{
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "var(--highlight)",
        borderColor: "var(--accent)",
        borderWidth: 2,
      }}
    >
      <div style={{ fontSize: 18 }}>⚡</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          <span className="hl">
            {count} update{count === 1 ? "" : "s"}
          </span>{" "}
          available
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>
          cascades to {cascadeCount} project deployment
          {cascadeCount === 1 ? "" : "s"}
        </div>
      </div>
      <button className="sk-btn accent" onClick={onReview}>
        Review updates →
      </button>
    </div>
  );
}
