// Permanent left sidebar — visible across every tab. Top section is the
// vertical tab nav (Library / Deploy / Settings); below it, when the
// Library tab is active, the per-section FilterRail (filter pills +
// tracked-projects mini-list).
//
// Width is fixed; the right pane handles its own scrolling, so this rail
// never moves when the user scrolls Settings or any deep view.

import { VerticalNav } from "./VerticalNav";
import { FilterRail } from "./FilterRail";
import { ThemeToggle } from "./ThemeToggle";
import { useAppStore } from "../state/store";

const RAIL_WIDTH = 188;

export function LeftRail() {
  const activeTab = useAppStore((s) => s.activeTab);

  return (
    <aside
      style={{
        width: RAIL_WIDTH,
        flexShrink: 0,
        borderRight: "1.5px solid var(--line-soft)",
        background: "var(--paper-2)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: 12 }}>
        <VerticalNav />
      </div>
      {activeTab === "library" && (
        <>
          <div className="sk-divider soft" style={{ margin: "0 12px 8px" }} />
          <FilterRail />
        </>
      )}
      {/* Theme toggle anchored to the bottom-left across every tab. */}
      <div
        style={{
          marginTop: "auto",
          padding: 12,
          borderTop: "1px dashed var(--line-soft)",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <ThemeToggle compact />
      </div>
    </aside>
  );
}
