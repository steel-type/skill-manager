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

  const [env, setEnv] = useState<EnvInfo | null>(null);
  const [historyBytes, setHistoryBytes] = useState<number | null>(null);

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
    if (
      !window.confirm(
        "Reset config to defaults?\n\nThis clears the active project and resets behaviour toggles. Your library and deployments are not touched.",
      )
    ) {
      return;
    }
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
    const sizeText =
      historyBytes && historyBytes > 0 ? formatBytes(historyBytes) : "0 B";
    if (
      !window.confirm(
        `Clear all rollback snapshots?\n\nThis frees ${sizeText} and removes every previous-version backup. Updates done after this point will start fresh history per the current retention setting. This action cannot be undone.`,
      )
    ) {
      return;
    }
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
      <div style={{ display: "flex", gap: 6, paddingTop: 12, flexWrap: "wrap" }}>
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
          style={{ color: "var(--warn)" }}
          title={
            historyBytes && historyBytes > 0
              ? `wipe all snapshots (${formatBytes(historyBytes)})`
              : "no snapshots to clear"
          }
        >
          Clear snapshots
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="sk-btn ghost"
          onClick={onResetConfig}
          style={{ color: "var(--warn)" }}
        >
          Reset config
        </button>
      </div>
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
          warm cream wireframe (light) or sharp dark minimal (SteelClaw)
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
}: {
  label: string;
  value: string;
  hint?: string;
  onOpen?: () => void;
  onCopy?: () => void;
  readOnly?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        padding: "12px 0",
        borderBottom: "1px dashed var(--line-soft)",
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
            background: value ? "white" : "var(--ink-soft)",
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
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        padding: "12px 0",
        borderBottom: "1px dashed var(--line-soft)",
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
  );
}
