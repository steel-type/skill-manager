// First-run setup overlay. Renders edge-to-edge over the entire app
// when setup.completed === false; the rest of the UI is hidden until
// completeSetup() succeeds. Five steps:
//   1. Welcome
//   2. Library location (claude / centralized / custom)
//   3. Primary agent + default deploy mode
//   4. Existing skills detection (import or skip per name conflicts)
//   5. Confirm + run

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../state/store";
import type {
  CompleteSetupArgs,
  DetectedSkill,
} from "../../electron/services/setup";
import type {
  DeployMode,
  LibraryRoot,
  Theme,
} from "../../electron/services/types";

type Step =
  | "welcome"
  | "location"
  | "primary"
  | "existing"
  | "confirm"
  | "running";

interface AgentChoice {
  id: string;
  displayName: string;
}

export function SetupFlow() {
  const setup = useAppStore((s) => s.setup);
  const loadSetup = useAppStore((s) => s.loadSetup);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const loadStacks = useAppStore((s) => s.loadStacks);
  const loadStackDeployments = useAppStore((s) => s.loadStackDeployments);
  const setError = useAppStore((s) => s.setError);

  const [step, setStep] = useState<Step>("welcome");
  const [libraryRoot, setLibraryRoot] = useState<LibraryRoot>("claude");
  const [customPath, setCustomPath] = useState<string>("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [resolvedPaths, setResolvedPaths] = useState<{
    libraryPath: string;
    historyPath: string;
  } | null>(null);
  const [agents, setAgents] = useState<AgentChoice[]>([]);
  const [primaryAgent, setPrimaryAgent] = useState<string>("claude");
  const [deployMode, setDeployMode] = useState<DeployMode>("symlink");
  const [detectedSkills, setDetectedSkills] = useState<DetectedSkill[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [selectedToImport, setSelectedToImport] = useState<Set<string>>(
    new Set(),
  );
  const [progress, setProgress] = useState<string[]>([]);

  // Pre-setup theme picker. The Settings tab doesn't exist yet — give
  // the user immediate control over the appearance from the very first
  // screen so they aren't blinded.
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  // Load the agent list once. Filter to those with a globalSkillPath —
  // cursor and cline have no global skills directory so they can't be
  // primary.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await window.api.listAgents();
        if (cancelled) return;
        // listAgents returns minimal info; the renderer doesn't have
        // direct access to the registry's globalSkillPath. Filter by id
        // against the known set instead.
        const PRIMARY_CAPABLE = new Set([
          "claude",
          "codex",
          "gemini",
          "continue",
        ]);
        setAgents(
          list
            .filter((a) => PRIMARY_CAPABLE.has(a.id))
            .map((a) => ({ id: a.id, displayName: a.displayName })),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setError]);

  // Resolve the chosen library root → absolute paths whenever it changes.
  useEffect(() => {
    if (step !== "location" && step !== "existing" && step !== "confirm")
      return;
    let cancelled = false;
    (async () => {
      try {
        if (libraryRoot === "custom" && !customPath.trim()) {
          setResolvedPaths(null);
          setPathError(null);
          return;
        }
        const r = await window.api.resolveLibraryRoot(
          libraryRoot,
          libraryRoot === "custom" ? customPath.trim() : null,
        );
        if (cancelled) return;
        setResolvedPaths(r);
        const err = await window.api.validateLibraryPath(r.libraryPath);
        if (cancelled) return;
        setPathError(err);
      } catch (err) {
        if (!cancelled) {
          setPathError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [libraryRoot, customPath, step]);

  // When entering Existing step, scan the resolved library for any skills
  // already on disk.
  useEffect(() => {
    if (step !== "existing" || !resolvedPaths) return;
    let cancelled = false;
    setScanLoading(true);
    (async () => {
      try {
        const found = await window.api.scanForExistingSkills(
          resolvedPaths.libraryPath,
        );
        if (cancelled) return;
        setDetectedSkills(found);
        // Default: import everything detected.
        setSelectedToImport(new Set(found.map((s) => s.name)));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setScanLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, resolvedPaths, setError]);

  const canContinueLocation =
    pathError === null &&
    resolvedPaths !== null &&
    (libraryRoot !== "custom" || customPath.trim().length > 0);

  const onComplete = async () => {
    if (!resolvedPaths) return;
    setStep("running");
    setProgress(["Creating directories…"]);
    try {
      const importSkills = Array.from(selectedToImport).map((name) => {
        const detected = detectedSkills.find((d) => d.name === name);
        return { name, sourcePath: detected?.path ?? "" };
      }).filter((s) => s.sourcePath !== "");
      const args: CompleteSetupArgs = {
        libraryRoot,
        customPath: libraryRoot === "custom" ? customPath.trim() : null,
        primaryAgent,
        defaultDeployMode: deployMode,
        importSkills,
      };
      const result = await window.api.completeSetup(args);
      setProgress((p) => [
        ...p,
        `Imported ${result.imported.length} skill${result.imported.length === 1 ? "" : "s"}.`,
        ...result.skipped.map((s) => `Skipped ${s.name}: ${s.reason}`),
        "Setup complete.",
      ]);
      // Refresh everything before unmounting so the main UI lands populated.
      await loadSetup();
      await loadSettings();
      await refreshSkills();
      await refreshProjects();
      await loadStacks();
      await loadStackDeployments();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("confirm");
    }
  };

  // Setup is complete — App.tsx will unmount this overlay on next render.
  if (setup.completed) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "var(--paper)",
        color: "var(--ink)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--read)",
      }}
    >
      <div
        style={{
          padding: "10px 20px",
          borderBottom: "1.5px solid var(--line-soft)",
          background: "var(--paper-2)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          // Drag region so the user can move the window even on the
          // setup overlay. Children opt-out via WebkitAppRegion: 'no-drag'.
          // (cast to React.CSSProperties to satisfy TS — the property is
          // a Webkit extension.)
          WebkitAppRegion: "drag",
          height: 36,
          flexShrink: 0,
        } as React.CSSProperties}
      >
        {/* Reserve space for the native traffic lights on the left so
            'Skill Manager' doesn't sit underneath the close/minimize
            buttons. Same 76px reservation as AppWindow. */}
        <div aria-hidden style={{ width: 76, flexShrink: 0 }} />
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: "var(--hand)",
            fontSize: 22,
            color: "var(--ink)",
            textAlign: "center",
          }}
        >
          Skill Manager
        </span>
        <span style={{ flex: 1 }} />
        <ThemeToggleInline
          value={settings.theme}
          onChange={(v) => updateSettings({ theme: v })}
        />
        <StepDots active={step} />
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "40px 24px",
        }}
      >
        <div style={{ width: "100%", maxWidth: 560 }}>
          {step === "welcome" && (
            <Welcome onNext={() => setStep("location")} />
          )}
          {step === "location" && (
            <LocationStep
              libraryRoot={libraryRoot}
              setLibraryRoot={setLibraryRoot}
              customPath={customPath}
              setCustomPath={setCustomPath}
              resolvedPaths={resolvedPaths}
              pathError={pathError}
              onBack={() => setStep("welcome")}
              onNext={() => setStep("primary")}
              canContinue={canContinueLocation}
            />
          )}
          {step === "primary" && (
            <PrimaryStep
              agents={agents}
              primaryAgent={primaryAgent}
              setPrimaryAgent={setPrimaryAgent}
              deployMode={deployMode}
              setDeployMode={setDeployMode}
              onBack={() => setStep("location")}
              onNext={() => setStep("existing")}
            />
          )}
          {step === "existing" && (
            <ExistingStep
              loading={scanLoading}
              detected={detectedSkills}
              selected={selectedToImport}
              setSelected={setSelectedToImport}
              libraryPath={resolvedPaths?.libraryPath ?? ""}
              onBack={() => setStep("primary")}
              onNext={() => setStep("confirm")}
            />
          )}
          {step === "confirm" && resolvedPaths && (
            <ConfirmStep
              libraryRoot={libraryRoot}
              libraryPath={resolvedPaths.libraryPath}
              historyPath={resolvedPaths.historyPath}
              primaryAgent={primaryAgent}
              primaryAgentName={
                agents.find((a) => a.id === primaryAgent)?.displayName ??
                primaryAgent
              }
              deployMode={deployMode}
              importCount={selectedToImport.size}
              onBack={() => setStep("existing")}
              onComplete={onComplete}
            />
          )}
          {step === "running" && (
            <RunningStep progress={progress} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Steps ──────────────────────────────────────────────────────────────

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ textAlign: "center", paddingTop: 40 }}>
      <div
        style={{
          fontFamily: "var(--hand)",
          fontSize: 56,
          marginBottom: 24,
          color: "var(--ink)",
          lineHeight: 1.1,
        }}
      >
        Welcome
      </div>
      <p
        style={{
          fontSize: 17,
          lineHeight: 1.6,
          color: "var(--ink-soft)",
          maxWidth: 480,
          margin: "0 auto",
        }}
      >
        Let's set up your skill library. You'll pick where it lives, which
        agent is your primary, and how skills deploy by default. This takes
        about a minute.
      </p>
      <div style={{ marginTop: 40 }}>
        <button
          type="button"
          className="sk-btn"
          onClick={onNext}
          style={{
            background: "var(--accent)",
            color: "var(--on-accent)",
            borderColor: "var(--accent)",
            padding: "10px 28px",
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          Get started →
        </button>
      </div>
    </div>
  );
}

function LocationStep({
  libraryRoot,
  setLibraryRoot,
  customPath,
  setCustomPath,
  resolvedPaths,
  pathError,
  onBack,
  onNext,
  canContinue,
}: {
  libraryRoot: LibraryRoot;
  setLibraryRoot: (r: LibraryRoot) => void;
  customPath: string;
  setCustomPath: (p: string) => void;
  resolvedPaths: { libraryPath: string; historyPath: string } | null;
  pathError: string | null;
  onBack: () => void;
  onNext: () => void;
  canContinue: boolean;
}) {
  return (
    <div>
      <h2 style={{ fontFamily: "var(--hand)", fontSize: 28, margin: 0 }}>
        Where should your library live?
      </h2>
      <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>
        Skills are stored once in this directory; deployments to projects
        symlink or copy from here.
      </p>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginTop: 18,
        }}
      >
        <RootCard
          checked={libraryRoot === "claude"}
          onClick={() => setLibraryRoot("claude")}
          title="Claude home"
          subtitle="~/.claude/skills"
          hint="Default, plays well with Claude Code's native layout."
        />
        <RootCard
          checked={libraryRoot === "centralized"}
          onClick={() => setLibraryRoot("centralized")}
          title="Centralized (recommended)"
          subtitle="~/.skill-stack/skills"
          hint="Agent-neutral location. Pick this if you use multiple agents."
        />
        <RootCard
          checked={libraryRoot === "custom"}
          onClick={() => setLibraryRoot("custom")}
          title="Custom"
          subtitle={customPath || "Choose a folder…"}
          hint="Pick your own path."
        >
          {libraryRoot === "custom" && (
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input
                type="text"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="/Users/you/my-skills"
                style={{
                  flex: 1,
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  padding: "6px 8px",
                  border: "1.5px solid var(--line-soft)",
                  borderRadius: 6,
                  background: "var(--paper)",
                  color: "var(--ink)",
                }}
              />
              <button
                type="button"
                className="sk-btn sm"
                onClick={async () => {
                  const picked = await window.api.pickFolder();
                  if (picked) setCustomPath(picked);
                }}
              >
                Browse…
              </button>
            </div>
          )}
        </RootCard>
      </div>
      {resolvedPaths && (
        <div
          style={{
            marginTop: 14,
            padding: 10,
            background: "var(--paper-2)",
            borderRadius: 6,
            fontSize: 11,
            fontFamily: "var(--mono)",
            color: "var(--ink-soft)",
          }}
        >
          Library: {resolvedPaths.libraryPath}
          <br />
          History: {resolvedPaths.historyPath}
        </div>
      )}
      {pathError && (
        <div style={{ marginTop: 8, color: "var(--warn)", fontSize: 12 }}>
          {pathError}
        </div>
      )}
      <Footer onBack={onBack} onNext={onNext} canContinue={canContinue} />
    </div>
  );
}

function PrimaryStep({
  agents,
  primaryAgent,
  setPrimaryAgent,
  deployMode,
  setDeployMode,
  onBack,
  onNext,
}: {
  agents: AgentChoice[];
  primaryAgent: string;
  setPrimaryAgent: (id: string) => void;
  deployMode: DeployMode;
  setDeployMode: (m: DeployMode) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 style={{ fontFamily: "var(--hand)", fontSize: 28, margin: 0 }}>
        Primary agent
      </h2>
      <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>
        Which agent do you use most? This pre-selects in Deploy and orders
        the agent list.
      </p>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginTop: 14,
        }}
      >
        {agents.map((a) => (
          <RadioRow
            key={a.id}
            checked={primaryAgent === a.id}
            onClick={() => setPrimaryAgent(a.id)}
            label={a.displayName}
          />
        ))}
      </div>

      <h3
        style={{
          fontFamily: "var(--hand)",
          fontSize: 22,
          marginTop: 28,
          marginBottom: 4,
        }}
      >
        Default deploy mode
      </h3>
      <p style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 0 }}>
        Symlink: edits propagate automatically. Copy: independent
        per-project copies. You can change this per-deploy.
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <ModePill
          active={deployMode === "symlink"}
          onClick={() => setDeployMode("symlink")}
          label="Symlink"
        />
        <ModePill
          active={deployMode === "copy"}
          onClick={() => setDeployMode("copy")}
          label="Copy"
        />
      </div>

      <Footer onBack={onBack} onNext={onNext} canContinue={true} />
    </div>
  );
}

function ExistingStep({
  loading,
  detected,
  selected,
  setSelected,
  libraryPath,
  onBack,
  onNext,
}: {
  loading: boolean;
  detected: DetectedSkill[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  libraryPath: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  };
  return (
    <div>
      <h2 style={{ fontFamily: "var(--hand)", fontSize: 28, margin: 0 }}>
        Existing skills
      </h2>
      {loading ? (
        <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>
          Scanning {libraryPath}…
        </p>
      ) : detected.length === 0 ? (
        <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>
          No skills found at {libraryPath}. We'll create the directory for
          you.
        </p>
      ) : (
        <>
          <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>
            Found {detected.length} skill
            {detected.length === 1 ? "" : "s"} at {libraryPath}. Select which
            ones to track in your library.
          </p>
          <div
            style={{
              marginTop: 12,
              padding: 4,
              background: "var(--paper-2)",
              borderRadius: 6,
              maxHeight: 280,
              overflow: "auto",
            }}
          >
            {detected.map((s) => (
              <label
                key={s.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.name)}
                  onChange={() => toggle(s.name)}
                />
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    flex: 1,
                  }}
                >
                  {s.name}
                </span>
                {s.isBundle && (
                  <span
                    className="sk-tag"
                    style={{ fontSize: 9 }}
                    title={`${s.nestedCount} nested`}
                  >
                    bundle
                  </span>
                )}
              </label>
            ))}
          </div>
        </>
      )}
      <Footer onBack={onBack} onNext={onNext} canContinue={!loading} />
    </div>
  );
}

function ConfirmStep({
  libraryRoot,
  libraryPath,
  historyPath,
  primaryAgent,
  primaryAgentName,
  deployMode,
  importCount,
  onBack,
  onComplete,
}: {
  libraryRoot: LibraryRoot;
  libraryPath: string;
  historyPath: string;
  primaryAgent: string;
  primaryAgentName: string;
  deployMode: DeployMode;
  importCount: number;
  onBack: () => void;
  onComplete: () => void;
}) {
  void primaryAgent;
  return (
    <div>
      <h2 style={{ fontFamily: "var(--hand)", fontSize: 28, margin: 0 }}>
        Ready to set up
      </h2>
      <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>
        Confirm and we'll create directories + import any selected skills.
      </p>
      <div
        style={{
          marginTop: 14,
          padding: 12,
          background: "var(--paper-2)",
          borderRadius: 6,
          fontFamily: "var(--mono)",
          fontSize: 12,
          lineHeight: 1.7,
        }}
      >
        <div>
          <span style={{ color: "var(--ink-faint)" }}>library root:</span>{" "}
          {libraryRoot}
        </div>
        <div>
          <span style={{ color: "var(--ink-faint)" }}>library path:</span>{" "}
          {libraryPath}
        </div>
        <div>
          <span style={{ color: "var(--ink-faint)" }}>history path:</span>{" "}
          {historyPath}
        </div>
        <div>
          <span style={{ color: "var(--ink-faint)" }}>primary agent:</span>{" "}
          {primaryAgentName}
        </div>
        <div>
          <span style={{ color: "var(--ink-faint)" }}>deploy mode:</span>{" "}
          {deployMode}
        </div>
        <div>
          <span style={{ color: "var(--ink-faint)" }}>import:</span>{" "}
          {importCount} skill{importCount === 1 ? "" : "s"}
        </div>
      </div>
      <div
        style={{
          marginTop: 24,
          display: "flex",
          gap: 8,
        }}
      >
        <button
          type="button"
          className="sk-btn ghost"
          onClick={onBack}
        >
          ← Back
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="sk-btn"
          onClick={onComplete}
          style={{
            background: "var(--accent)",
            color: "var(--on-accent)",
            borderColor: "var(--accent)",
            fontWeight: 700,
          }}
        >
          Complete setup
        </button>
      </div>
    </div>
  );
}

function RunningStep({ progress }: { progress: string[] }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontFamily: "var(--hand)",
          fontSize: 28,
          marginBottom: 14,
        }}
      >
        Setting up…
      </div>
      <div
        style={{
          padding: 14,
          background: "var(--paper-2)",
          borderRadius: 6,
          fontFamily: "var(--mono)",
          fontSize: 11,
          textAlign: "left",
        }}
      >
        {progress.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}

// ── Building blocks ────────────────────────────────────────────────────

function StepDots({ active }: { active: Step }) {
  const order: Step[] = ["welcome", "location", "primary", "existing", "confirm"];
  const idx = order.indexOf(active === "running" ? "confirm" : active);
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {order.map((_, i) => (
        <span
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background:
              i < idx
                ? "var(--good)"
                : i === idx
                  ? "var(--accent)"
                  : "var(--line-soft)",
          }}
        />
      ))}
    </div>
  );
}

function Footer({
  onBack,
  onNext,
  canContinue,
}: {
  onBack: () => void;
  onNext: () => void;
  canContinue: boolean;
}) {
  return (
    <div style={{ marginTop: 24, display: "flex", gap: 8 }}>
      <button type="button" className="sk-btn ghost" onClick={onBack}>
        ← Back
      </button>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        className="sk-btn"
        disabled={!canContinue}
        onClick={onNext}
        style={{
          background: canContinue ? "var(--accent)" : "var(--paper-2)",
          color: canContinue ? "var(--on-accent)" : "var(--ink-faint)",
          borderColor: canContinue ? "var(--accent)" : "var(--line-soft)",
          fontWeight: 700,
        }}
      >
        Continue →
      </button>
    </div>
  );
}

function RootCard({
  checked,
  onClick,
  title,
  subtitle,
  hint,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      role="radio"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        padding: 12,
        border: `1.5px solid ${checked ? "var(--accent)" : "var(--line-soft)"}`,
        borderRadius: 8,
        background: checked ? "var(--card-selected-bg)" : "var(--paper)",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            border: "1.5px solid var(--line)",
            background: checked ? "var(--ink)" : "var(--paper)",
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {checked && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--paper)",
              }}
            />
          )}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--mono)",
              color: "var(--ink-soft)",
            }}
          >
            {subtitle}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2 }}>
            {hint}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

function RadioRow({
  checked,
  onClick,
  label,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <label
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        border: `1.5px solid ${checked ? "var(--accent)" : "var(--line-soft)"}`,
        borderRadius: 6,
        cursor: "pointer",
        background: checked ? "var(--card-selected-bg)" : "transparent",
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "1.5px solid var(--line)",
          background: checked ? "var(--ink)" : "var(--paper)",
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--paper)",
            }}
          />
        )}
      </span>
      <span style={{ fontSize: 13 }}>{label}</span>
    </label>
  );
}

function ModePill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 16px",
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        fontFamily: "var(--read)",
        background: active ? "var(--accent)" : "var(--paper-2)",
        color: active ? "var(--on-accent)" : "var(--ink-soft)",
        border: `1.5px solid ${active ? "var(--accent)" : "var(--line-soft)"}`,
        borderRadius: 999,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function ThemeToggleInline({
  value,
  onChange,
}: {
  value: Theme;
  onChange: (v: Theme) => void;
}) {
  const opts: { v: Theme; label: string }[] = [
    { v: "light", label: "☀" },
    { v: "dark", label: "☾" },
    { v: "system", label: "⌥" },
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        border: "1.5px solid var(--line-soft)",
        borderRadius: 999,
        background: "var(--paper)",
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}
    >
      {opts.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            title={o.v}
            style={{
              padding: "2px 10px",
              fontSize: 13,
              fontFamily: "var(--read)",
              background: active ? "var(--accent)" : "transparent",
              color: active ? "var(--on-accent)" : "var(--ink-soft)",
              border: "none",
              borderRadius: 999,
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Suppress unused import warning for the type in the IIFE above.
void ({} as { _: typeof useMemo });
