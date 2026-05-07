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
  const setScreen = useAppStore((s) => s.setScreen);
  const setError = useAppStore((s) => s.setError);

  // Export the structured-JSON share to a user-chosen location. No flow
  // needed — one click → dialog → file. Shows a transient toast on success
  // / failure via the standard error channel.
  const onShare = async () => {
    try {
      const { json, count } = await window.api.exportJson();
      if (count === 0) {
        setError("Nothing to share — your library is empty.");
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const path = await window.api.saveTextFile({
        defaultName: `skills-${today}.json`,
        content: json,
        filterName: "Skill share",
        extensions: ["json"],
      });
      if (!path) return; // user cancelled
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Read a JSON share, parse + tag installed entries, then route into the
  // ImportFlow review screen where validation happens per-row.
  const onImport = async () => {
    try {
      const file = await window.api.readTextFile({
        filterName: "Skill share",
        extensions: ["json"],
      });
      if (!file) return;
      const { entries, doc } = await window.api.parseImportJson(file.content);
      if (entries.length === 0) {
        setError("No skills found in that file.");
        return;
      }
      setScreen({
        kind: "import",
        entries,
        sourcePath: file.path,
        exportedAt: doc?.exported_at ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

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
          gap: 6,
          alignItems: "center",
        }}
      >
        <RailIconButton
          title="Share library — export JSON"
          onClick={onShare}
        >
          <ShareIcon />
        </RailIconButton>
        <RailIconButton
          title="Import shared library — open JSON"
          onClick={onImport}
        >
          <ImportIcon />
        </RailIconButton>
        <ThemeToggle compact />
      </div>
    </aside>
  );
}

function RailIconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 28,
        height: 28,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1.5px solid var(--line-soft)",
        borderRadius: 14,
        background: "var(--paper-2)",
        color: "var(--ink-soft)",
        padding: 0,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function ShareIcon() {
  // Upload glyph — arrow rising out of a tray. Reads as "send out" /
  // "share" and pairs visually with the import down-arrow.
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 9V2" />
      <path d="M4.2 4.6 7 1.8l2.8 2.8" />
      <path d="M2.5 8.5v2.4c0 .6.4 1 1 1h7c.6 0 1-.4 1-1V8.5" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 1.8V9" />
      <path d="M4.2 6.2 7 9l2.8-2.8" />
      <path d="M2.5 10.5v.4c0 .6.4 1 1 1h7c.6 0 1-.4 1-1v-.4" />
    </svg>
  );
}
