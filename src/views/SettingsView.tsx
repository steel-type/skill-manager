// Settings view — paths, behaviour toggles, about, and config-file actions.
// Ported from design-reference/variations/flows.jsx SettingsView.

import { useEffect, useState } from "react";
import { useAppStore } from "../state/store";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  HISTORY_RETENTION_OPTIONS,
  type AppSettings,
} from "../../electron/services/types";

interface EnvInfo {
  paths: { config: string; library: string; claudeDir: string };
  electron: string;
  node: string;
  platform: string;
}

// Lazy import-guard for static-analysis: useAppStore is the source of truth
// for refreshSkills, so we read it via getState() inside async handlers
// (rather than passing the closure around).

export function SettingsView() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const setError = useAppStore((s) => s.setError);
  const setup = useAppStore((s) => s.setup);
  const setSetup = useAppStore((s) => s.setSetup);
  const [primaryAgents, setPrimaryAgents] = useState<{ id: string; displayName: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    window.api.listAgents().then((list) => {
      if (cancelled) return;
      const PRIMARY_CAPABLE = new Set(["claude", "codex", "gemini", "continue"]);
      setPrimaryAgents(
        list
          .filter((a) => PRIMARY_CAPABLE.has(a.id))
          .map((a) => ({ id: a.id, displayName: a.displayName })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [env, setEnv] = useState<EnvInfo | null>(null);
  const [historyBytes, setHistoryBytes] = useState<number | null>(null);
  // Two-step confirmation for destructive actions, replacing the previous
  // window.confirm() popups. First click arms the button, second click
  // executes; the armed state self-clears after a few seconds. The Remove
  // Skill flow keeps its dedicated Modal because it has more to confirm
  // (cascade options, per-deployment toggles).
  const [armed, setArmed] = useState<"reset" | "clear" | null>(null);
  const armFor = (kind: "reset" | "clear") => {
    setArmed(kind);
    window.setTimeout(() => {
      setArmed((prev) => (prev === kind ? null : prev));
    }, 4000);
  };

  useEffect(() => {
    window.api.envInfo().then(setEnv);
    refreshHistorySize();
  }, []);

  const refreshHistorySize = () => {
    window.api
      .getHistorySize()
      .then(setHistoryBytes)
      .catch(() => setHistoryBytes(null));
  };

  const formatBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const onResetConfig = async () => {
    if (armed !== "reset") {
      armFor("reset");
      return;
    }
    setArmed(null);
    try {
      await window.api.resetConfig();
      await loadSettings();
      await useAppStore.getState().refreshSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onEditConfig = async () => {
    if (!env) return;
    try {
      const err = await window.api.openPath(env.paths.config);
      if (err) setError(err);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onClearSnapshots = async () => {
    if (armed !== "clear") {
      armFor("clear");
      return;
    }
    setArmed(null);
    try {
      await window.api.clearAllHistory();
      refreshHistorySize();
      // Re-pull skills so historyCount drops to 0 across the library.
      await useAppStore.getState().refreshSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      style={{
        flex: 1,
        padding: 22,
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
      }}
    >
      <div
        style={{
          // Sticky so the section title doesn't disappear when the user
          // scrolls down through the toggles + about + actions list.
          position: "sticky",
          top: 0,
          background: "var(--paper)",
          paddingBottom: 6,
          marginBottom: 4,
          zIndex: 2,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700 }}>Settings</div>
        <div className="hand" style={{ color: "var(--ink-faint)", fontSize: 14 }}>
          local install — no accounts, no sync
        </div>
      </div>

      <div className="rail-section" style={{ padding: "10px 0 0" }}>
        Paths
      </div>
      <PathRow
        label="Library folder"
        value={env?.paths.library ?? "~/.claude/skills"}
        hint="where skills live on disk"
        onOpen={() =>
          env && window.api.openInFinder(env.paths.library)
        }
        onCopy={() =>
          env && window.api.writeClipboard(env.paths.library)
        }
      />
      <PathRow
        label="Config"
        value={env?.paths.config ?? "~/.claude/skill-manager.json"}
        hint="tracked sources, deployments, settings"
        onOpen={() => env && window.api.openPath(env.paths.config)}
        onCopy={() => env && window.api.writeClipboard(env.paths.config)}
      />

      <div className="rail-section" style={{ padding: "16px 0 0" }}>
        Library
      </div>
      <PrimaryAgentRow
        agents={primaryAgents}
        primaryAgent={setup.primaryAgent}
        onChange={async (id) => {
          // Flip the flag first so the rest of the app sees the new
          // primary immediately, then wire the library into the new
          // agent's global skills dir so promoted stacks + skills are
          // discoverable from there. Best-effort: if wiring fails (e.g.
          // agent has no global dir, or a real dir already squats the
          // target name), surface the warning but don't block the flip.
          await setSetup({ primaryAgent: id });
          try {
            const result = await window.api.wireLibraryIntoAgent(id);
            if (result.skipped.length > 0) {
              useAppStore
                .getState()
                .setError(
                  `Primary agent set to ${id}, but ${result.skipped.length} library entr${result.skipped.length === 1 ? "y" : "ies"} couldn't be wired (real dirs already exist at the target).`,
                );
            }
          } catch (err) {
            useAppStore
              .getState()
              .setError(
                err instanceof Error ? err.message : String(err),
              );
          }
        }}
      />
      <PathRow
        label="Library location"
        value={setup.libraryPath || "(not set)"}
        hint="canonical source for all deployments"
        onOpen={() => setup.libraryPath && window.api.openInFinder(setup.libraryPath)}
        onCopy={() => setup.libraryPath && window.api.writeClipboard(setup.libraryPath)}
        subAction={
          <button
            type="button"
            className="sk-btn sm ghost"
            onClick={async () => {
              const picked = await window.api.pickFolder();
              if (!picked) return;
              useAppStore.getState().openModal({
                type: "migrate",
                toLibraryPath: picked,
              });
            }}
          >
            Move library to another folder…
          </button>
        }
      />
      <PathRow
        label="History location"
        value={setup.historyPath || "(not set)"}
        hint="snapshot directory for rollback"
        onOpen={() => setup.historyPath && window.api.openInFinder(setup.historyPath)}
        onCopy={() => setup.historyPath && window.api.writeClipboard(setup.historyPath)}
      />
      <SegmentedRow
        label="Default deploy mode"
        hint="fresh deployments use this; you can override per-deploy"
        value={settings.default_deploy_mode}
        options={[
          { value: "symlink", label: "Symlink" },
          { value: "copy", label: "Copy" },
        ]}
        onChange={(v) =>
          updateSettings({ default_deploy_mode: v as "symlink" | "copy" })
        }
        subAction={
          <button
            type="button"
            className="sk-btn sm ghost"
            onClick={() =>
              useAppStore.getState().openModal({
                type: "confirm",
                title: "Re-run onboarding?",
                body:
                  "Setup will start over so you can pick a different agent, library location, or re-import skills. Your skills and library files stay where they are — only the setup flag is reset.",
                confirmLabel: "Re-run",
                onConfirm: () => setSetup({ completed: false }),
              })
            }
          >
            Re-run onboarding…
          </button>
        }
      />

      <div className="rail-section" style={{ padding: "16px 0 0" }}>
        Appearance
      </div>
      <ThemeRow />

      <div className="rail-section" style={{ padding: "16px 0 0" }}>
        Behavior
      </div>
      <ToggleRow
        label="Auto-check updates on launch"
        hint="git ls-remote, parallel"
        value={settings.auto_check_updates}
        onChange={(v) => updateSettings({ auto_check_updates: v })}
      />
      <ToggleRow
        label="Cascade updates to projects"
        hint="re-copy on update"
        value={settings.cascade_updates}
        onChange={(v) => updateSettings({ cascade_updates: v })}
      />
      <ToggleRow
        label="Confirm before remove"
        value={settings.confirm_before_remove}
        onChange={(v) => updateSettings({ confirm_before_remove: v })}
      />
      <ToggleRow
        label="Show resource-only entries"
        hint="folders without SKILL.md"
        value={settings.show_resource_only}
        onChange={(v) => updateSettings({ show_resource_only: v })}
      />
      <SegmentedRow
        label="Default library layout"
        hint="card grid or ⌘K command palette"
        value={settings.default_layout}
        onChange={(v) =>
          updateSettings({ default_layout: v as AppSettings["default_layout"] })
        }
        options={[
          { value: "cards", label: "Cards" },
          { value: "palette", label: "⌘K" },
        ]}
      />
      <SegmentedRow
        label="Snapshot retention"
        hint={
          historyBytes !== null && historyBytes > 0
            ? `keep N previous versions per skill so updates are reversible — currently using ${formatBytes(historyBytes)}`
            : "keep N previous versions per skill so updates are reversible"
        }
        value={String(settings.update_history_retention)}
        onChange={async (v) => {
          await updateSettings({
            update_history_retention: Number(
              v,
            ) as AppSettings["update_history_retention"],
          });
          // The size doesn't change immediately on toggle (that would
          // require pruning), but the on-disk total may have shifted from
          // the last update. Refresh on every change.
          refreshHistorySize();
        }}
        options={HISTORY_RETENTION_OPTIONS.map((n) => ({
          value: String(n),
          label: n === 0 ? "off" : String(n),
        }))}
      />

      <div className="rail-section" style={{ padding: "16px 0 0" }}>
        About
      </div>
      <PathRow
        label="App"
        value={env ? `Electron ${env.electron} · Node ${env.node}` : "loading…"}
        readOnly
      />
      <PathRow
        label="Platform"
        value={env?.platform ?? "—"}
        readOnly
      />

      <div style={{ flex: 1, minHeight: 8 }} />
      <div
        style={{
          display: "flex",
          gap: 6,
          paddingTop: 12,
          marginTop: 8,
          borderTop: "1px dashed var(--line-soft)",
          flexWrap: "wrap",
        }}
      >
        <button
          className="sk-btn ghost"
          onClick={() =>
            env && window.api.openInFinder(env.paths.library)
          }
        >
          Open library folder
        </button>
        <button className="sk-btn ghost" onClick={onEditConfig}>
          Edit config.json
        </button>
        <button
          className="sk-btn ghost"
          onClick={onClearSnapshots}
          disabled={!historyBytes || historyBytes === 0}
          style={{
            background: armed === "clear" ? "var(--warn)" : undefined,
            color: armed === "clear" ? "#0a0a0a" : "var(--warn)",
            borderColor: armed === "clear" ? "var(--warn)" : undefined,
          }}
          title={
            armed === "clear"
              ? "click again within 4s to confirm"
              : historyBytes && historyBytes > 0
                ? `wipe all snapshots (${formatBytes(historyBytes)})`
                : "no snapshots to clear"
          }
        >
          {armed === "clear"
            ? `Confirm — wipe ${
                historyBytes && historyBytes > 0
                  ? formatBytes(historyBytes)
                  : "snapshots"
              }`
            : "Clear snapshots"}
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="sk-btn ghost"
          onClick={onResetConfig}
          style={{
            background: armed === "reset" ? "var(--warn)" : undefined,
            color: armed === "reset" ? "#0a0a0a" : "var(--warn)",
            borderColor: armed === "reset" ? "var(--warn)" : undefined,
          }}
          title={
            armed === "reset"
              ? "click again within 4s to confirm"
              : "reset config to defaults"
          }
        >
          {armed === "reset" ? "Confirm — reset config" : "Reset config"}
        </button>
      </div>
    </div>
  );
}

function PrimaryAgentRow({
  agents,
  primaryAgent,
  onChange,
}: {
  agents: { id: string; displayName: string }[];
  primaryAgent: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 0",
        borderBottom: "1px dashed var(--line-soft)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Primary agent</div>
        <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>
          pre-checked in Deploy and pinned to top of the agent list
        </div>
      </div>
      <select
        value={primaryAgent}
        onChange={(e) => onChange(e.target.value)}
        style={{
          fontFamily: "var(--read)",
          fontSize: 12,
          padding: "4px 8px",
          border: "1.5px solid var(--line-soft)",
          borderRadius: 6,
          background: "var(--paper)",
          color: "var(--ink)",
        }}
      >
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}

function ThemeRow() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "12px 0",
        borderBottom: "1px dashed var(--line-soft)",
        gap: 14,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Theme</div>
        <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>
          warm cream wireframe or sharp dark minimal
        </div>
      </div>
      <ThemeToggle />
    </div>
  );
}

function PathRow({
  label,
  value,
  hint,
  onOpen,
  onCopy,
  readOnly,
  subAction,
}: {
  label: string;
  value: string;
  hint?: string;
  onOpen?: () => void;
  onCopy?: () => void;
  readOnly?: boolean;
  /** Optional sub-action button rendered below the row body, aligned
   *  with the label column. Used for 'Move library to another folder'
   *  type follow-on actions that belong to the row but shouldn't sit
   *  inline with Copy / Open. */
  subAction?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "12px 0",
        borderBottom: "1px dashed var(--line-soft)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
          {hint && (
            <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>
              {hint}
            </div>
          )}
        </div>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-soft)",
            textAlign: "right",
            maxWidth: 280,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={value}
        >
          {value.replace(/^\/Users\/[^/]+/, "~")}
        </div>
        {!readOnly && (
          <div style={{ display: "flex", gap: 4 }}>
            {onCopy && (
              <button className="sk-btn sm ghost" onClick={onCopy} title="Copy path">
                Copy
              </button>
            )}
            {onOpen && (
              <button className="sk-btn sm ghost" onClick={onOpen} title="Open">
                Open
              </button>
            )}
          </div>
        )}
      </div>
      {subAction && <div style={{ marginTop: 8 }}>{subAction}</div>}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        padding: "12px 0",
        borderBottom: "1px dashed var(--line-soft)",
        gap: 14,
        cursor: "pointer",
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        {hint && (
          <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{hint}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        style={{
          width: 32,
          height: 18,
          borderRadius: 9,
          border: "1.5px solid var(--line)",
          background: value ? "var(--ink)" : "var(--paper)",
          position: "relative",
          flexShrink: 0,
          padding: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 1,
            left: value ? 13 : 1,
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: value ? "var(--paper)" : "var(--ink-soft)",
            transition: "left 0.2s",
          }}
        />
      </button>
    </label>
  );
}

function SegmentedRow({
  label,
  hint,
  value,
  onChange,
  options,
  subAction,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
  /** Optional sub-action below the row body — same convention as
   *  PathRow.subAction. */
  subAction?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "12px 0",
        borderBottom: "1px dashed var(--line-soft)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
          {hint && (
            <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{hint}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {options.map((o) => (
            <button
              key={o.value}
              className={`sk-btn sm ${value === o.value ? "primary" : ""}`}
              onClick={() => onChange(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {subAction && <div style={{ marginTop: 8 }}>{subAction}</div>}
    </div>
  );
}
