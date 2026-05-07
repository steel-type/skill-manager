import { useEffect } from "react";
import { AppWindow } from "./components/AppWindow";
import { LeftRail } from "./components/LeftRail";
import { LibraryView } from "./views/LibraryView";
import { DeployView } from "./views/DeployView";
import { SettingsView } from "./views/SettingsView";
import { PlaceholderView } from "./views/PlaceholderView";
import { StacksView } from "./views/StacksView";
import { InstallFlow } from "./flows/InstallFlow";
import { UpdateFlow } from "./flows/UpdateFlow";
import { ImportFlow } from "./flows/ImportFlow";
import { RemoveSkillFlow } from "./flows/RemoveSkillFlow";
import { RemoveProjectFlow } from "./flows/RemoveProjectFlow";
import { RollbackFlow } from "./flows/RollbackFlow";
import { DeployFlow } from "./flows/DeployFlow";
import { SkillDetailFlow } from "./flows/SkillDetailFlow";
import { useAppStore } from "./state/store";

const TITLES: Record<string, string> = {
  library: "Skill Library",
  stacks: "Stacks",
  deploy: "Deploy",
  settings: "Settings",
};

export default function App() {
  const activeTab = useAppStore((s) => s.activeTab);
  const screen = useAppStore((s) => s.screen);
  const lastError = useAppStore((s) => s.lastError);
  const setError = useAppStore((s) => s.setError);
  const modal = useAppStore((s) => s.modal);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const settings = useAppStore((s) => s.settings);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const runUpdateCheck = useAppStore((s) => s.runUpdateCheck);
  const setLibraryLayout = useAppStore((s) => s.setLibraryLayout);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  // Global keyboard shortcuts. ⌘K (Mac) / Ctrl+K (Win/Linux) toggles between
  // the card grid and the ⌘K command palette layout while the Library tab
  // is active. ⌘1/2/3 jump between tabs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // Skip if focus is in an input/textarea/contenteditable so the user's
      // text editing isn't hijacked.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target?.isContentEditable === true;
      if (e.key.toLowerCase() === "k" && !e.shiftKey) {
        // ⌘K toggles regardless of focus — the palette's own input is focused
        // while it's open, and we still want ⌘K to dismiss back to cards.
        e.preventDefault();
        // Switch to the Library tab if we're not already there — the
        // shortcut should "show me the palette" no matter where I am.
        const state = useAppStore.getState();
        if (state.activeTab !== "library") setActiveTab("library");
        setLibraryLayout(state.libraryLayout === "cards" ? "palette" : "cards");
      } else if (["1", "2", "3", "4"].includes(e.key)) {
        if (isEditable) return;
        e.preventDefault();
        const tabs = ["library", "stacks", "deploy", "settings"] as const;
        setActiveTab(tabs[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setActiveTab, setLibraryLayout]);

  // Bootstrap: load settings, then skills, then optionally auto-check.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadSettings();
      if (cancelled) return;
      await refreshSkills();
      if (cancelled) return;
      // Settings are now loaded; check the freshly-loaded value rather than
      // the closure-captured one above.
      if (useAppStore.getState().settings.auto_check_updates) {
        runUpdateCheck();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSettings, refreshSkills, runUpdateCheck]);

  // Apply theme to the document root whenever the persisted setting
  // changes. CSS variable overrides under `[data-theme="dark"]` swap
  // colours / fonts / radii in one shot.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);

  // Auto-dismiss transient error toasts.
  useEffect(() => {
    if (!lastError) return;
    const id = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(id);
  }, [lastError, setError]);

  // Avoid the unused-var warning while still ensuring settings is reactive.
  void settings;

  return (
    <div className="app-root">
      <AppWindow
        title={
          screen.kind === "update"
            ? "Updates"
            : screen.kind === "detail"
              ? screen.name
              : screen.kind === "stackDetail"
                ? "Stack"
                : screen.kind === "import"
                  ? "Import"
                  : TITLES[activeTab]
        }
      >
        <LeftRail />
        {screen.kind === "update" ? (
          <UpdateFlow prefillName={screen.prefillName} />
        ) : screen.kind === "detail" ? (
          <SkillDetailFlow name={screen.name} />
        ) : screen.kind === "stackDetail" ? (
          <PlaceholderView
            title={`Stack: ${screen.stackId}`}
            hint="Stack detail screen lands in the next step. Use Edit or Delete from the Stacks tab for now."
          />
        ) : screen.kind === "import" ? (
          <ImportFlow
            entries={screen.entries}
            sourcePath={screen.sourcePath}
            exportedAt={screen.exportedAt}
          />
        ) : (
          <>
            {activeTab === "library" && <LibraryView />}
            {activeTab === "stacks" && <StacksView />}
            {activeTab === "deploy" && <DeployView />}
            {activeTab === "settings" && <SettingsView />}
          </>
        )}
      </AppWindow>

      {modal?.type === "install" && (
        <InstallFlow prefillUrl={modal.prefillUrl} />
      )}
      {modal?.type === "removeSkill" && (
        <RemoveSkillFlow name={modal.name} />
      )}
      {modal?.type === "removeProject" && (
        <RemoveProjectFlow path={modal.path} />
      )}
      {modal?.type === "rollback" && <RollbackFlow name={modal.name} />}
      {modal?.type === "deploy" && <DeployFlow skillName={modal.skill} />}

      {lastError && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            padding: "10px 14px",
            background: "var(--warn)",
            color: "white",
            fontFamily: "var(--read)",
            fontSize: 13,
            borderRadius: 6,
            border: "1.5px solid var(--ink)",
            boxShadow: "3px 3px 0 var(--line)",
            maxWidth: 360,
            zIndex: 1000,
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <span style={{ flex: 1 }}>{lastError}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "white",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
