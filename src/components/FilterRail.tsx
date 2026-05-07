// Library-specific filter rail (filter pills + tracked-projects mini-list).
// Lives below the VerticalNav inside the LeftRail and is only mounted when
// the Library tab is active.
//
// Counts derive from the store directly so the rail can be plopped
// anywhere without prop-drilling.

import { useMemo } from "react";
import { useAppStore, type LibraryFilter } from "../state/store";

const FILTER_ORDER: { id: LibraryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "updates", label: "Updates" },
  { id: "bundles", label: "Bundles" },
  { id: "local", label: "Local" },
  { id: "deployed", label: "Deployed" },
];

export function FilterRail() {
  const skills = useAppStore((s) => s.skills);
  const updateInfo = useAppStore((s) => s.updateInfo);
  const filter = useAppStore((s) => s.filter);
  const setFilter = useAppStore((s) => s.setFilter);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const projects = useAppStore((s) => s.projects);

  const counts = useMemo(
    () => ({
      all: skills.length,
      updates: skills.filter((s) => updateInfo[s.name]?.hasUpdate).length,
      bundles: skills.filter((s) => s.isBundle).length,
      local: skills.filter((s) => s.isLocal).length,
      deployed: skills.filter((s) => s.projects.length > 0).length,
    }),
    [skills, updateInfo],
  );

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        padding: "0 12px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        overflow: "hidden",
      }}
    >
      <div className="rail-section">Library</div>
      {FILTER_ORDER.map((f) => {
        const count = counts[f.id];
        const selected = filter === f.id;
        return (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              padding: "5px 8px",
              borderRadius: 5,
              fontSize: 12,
              textAlign: "left",
              background: selected ? "var(--ink)" : "transparent",
              // Theme-aware contrast: paper-on-ink in light = cream on dark;
              // in dark theme it inverts cleanly so the active pill matches
              // the Install / Set-as-active buttons (both also --ink).
              color: selected ? "var(--paper)" : "var(--ink)",
              fontWeight: selected ? 600 : 400,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ flex: 1 }}>
              {f.label} · {count}
            </span>
            {f.id === "updates" && count > 0 && !selected && (
              <span
                className="sk-tag update"
                style={{ fontSize: 9, padding: "0 5px" }}
              >
                NEW
              </span>
            )}
          </button>
        );
      })}

      <div className="sk-divider soft" style={{ margin: "10px 0 4px" }} />
      <div className="rail-section">Projects</div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflowY: "auto",
          minHeight: 0,
        }}
      >
        {projects.length === 0 && (
          <div
            style={{
              padding: "4px 8px",
              fontSize: 11,
              color: "var(--ink-faint)",
              fontStyle: "italic",
            }}
          >
            none yet
          </div>
        )}
        {projects.map((p) => (
          <button
            key={p.path}
            onClick={() => setActiveTab("deploy")}
            title={p.path}
            style={{
              padding: "4px 8px",
              fontSize: 11,
              fontFamily: "var(--mono)",
              textAlign: "left",
              color: p.exists ? "var(--ink)" : "var(--ink-faint)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              borderRadius: 4,
            }}
          >
            {p.path.replace(/^\/Users\/[^/]+/, "~")}
          </button>
        ))}
      </div>
    </div>
  );
}
