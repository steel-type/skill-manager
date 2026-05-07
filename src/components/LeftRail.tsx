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

  // Read a skill share file (JSON in any supported shape, or plain text
  // with one URL per line), parse + tag installed entries, then route into
  // the ImportFlow review screen where per-row validation happens.
  const onImport = async () => {
    try {
      const file = await window.api.readTextFile({
        filterName: "Skill share",
        // Accept .txt / .md too so plain-URL-per-line lists are usable.
        extensions: ["json", "txt", "md"],
      });
      if (!file) return;
      const result = await window.api.parseImportJson(file.content);

      // Codex skill-config entries (local paths, no URL) install directly
      // via installLocalSkill — there's no URL to validate or clone, so
      // they'd just clutter the review screen. enabled:false from codex
      // means the user explicitly turned them off, so we respect that.
      // Already-installed entries are skipped to avoid surprise overwrites.
      const localToInstall = result.localEntries.filter(
        (e) => e.enabled !== false && !e.alreadyInstalled,
      );
      let localInstalled = 0;
      let localFailed = 0;
      let localSkippedDisabled = result.localEntries.length - localToInstall.length;
      for (const local of localToInstall) {
        try {
          await window.api.installLocalSkill(local.name, local.localPath);
          localInstalled += 1;
        } catch {
          localFailed += 1;
        }
      }
      if (localInstalled > 0) {
        await useAppStore.getState().refreshSkills();
      }

      if (result.entries.length === 0) {
        // No URL entries → nothing to route into the review screen. Report
        // whatever we did with the local-only entries instead.
        if (localInstalled > 0) {
          setError(
            `Imported ${localInstalled} local skill${localInstalled === 1 ? "" : "s"}${
              localFailed > 0 ? ` · ${localFailed} failed` : ""
            }${
              localSkippedDisabled > 0
                ? ` · ${localSkippedDisabled} skipped (disabled / already installed)`
                : ""
            }`,
          );
        } else {
          const detail =
            result.skipped > 0
              ? ` (${result.skipped} malformed ${result.skipped === 1 ? "entry was" : "entries were"} skipped.)`
              : localFailed > 0
                ? ` (${localFailed} local install${localFailed === 1 ? "" : "s"} failed.)`
                : "";
          setError(`No installable skills found in that file.${detail}`);
        }
        return;
      }

      // Surface non-fatal info via the toast — the user sees what was
      // recognised and whether anything was dropped before they hit the
      // review screen.
      const tail: string[] = [];
      if (result.detectedFormat !== "native") {
        tail.push(`format: ${formatLabel(result.detectedFormat)}`);
      }
      if (localInstalled > 0) {
        tail.push(`${localInstalled} local installed`);
      }
      if (localFailed > 0) tail.push(`${localFailed} local failed`);
      if (localSkippedDisabled > 0) {
        tail.push(`${localSkippedDisabled} local skipped`);
      }
      if (result.skipped > 0) tail.push(`${result.skipped} malformed skipped`);
      if (tail.length > 0) {
        setError(
          `${result.entries.length} URL ${result.entries.length === 1 ? "entry" : "entries"} ready — ${tail.join(", ")}`,
        );
      }
      setScreen({
        kind: "import",
        entries: result.entries,
        sourcePath: file.path,
        exportedAt: result.doc?.exported_at ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  function formatLabel(
    f:
      | "native"
      | "bare-array"
      | "codex-config"
      | "skills-array"
      | "url-map"
      | "url-lines"
      | "unknown",
  ): string {
    switch (f) {
      case "bare-array":
        return "bare JSON array";
      case "codex-config":
        return "codex skill config";
      case "skills-array":
        return "skills-array JSON";
      case "url-map":
        return "URL map";
      case "url-lines":
        return "plain text URLs";
      case "native":
        return "native skill share";
      case "unknown":
        return "unknown";
    }
  }

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
