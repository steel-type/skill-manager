// First-run setup overlay. Renders edge-to-edge over the entire app
// when setup.completed === false; the rest of the UI is hidden until
// completeSetup() succeeds.
//
// Steps:
//   1. Welcome
//   2. Agent (a/b/c/d/e shortcuts) → primary agent + auto-scan its default
//      skills dir so the next step can branch.
//   3. Location → "Use {agent}'s skills dir" vs. "Move to Skill Manager
//      library (recommended)" when skills were found, or "Use Skill Manager
//      default" when nothing was found. "Choose folder…" + More options
//      below for power users.
//   4. Existing → review+confirm which detected skills to track.
//   5. Confirm → final summary.
//   6. Running → progress.

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../state/store";
import type {
  CompleteSetupArgs,
  DetectedSkill,
  ImportMode,
} from "../../electron/services/setup";
import type {
  DeployMode,
  LibraryRoot,
  Theme,
} from "../../electron/services/types";

type Step =
  | "welcome"
  | "agent"
  | "location"
  | "existing"
  | "confirm"
  | "running";

interface AgentChoice {
  id: string;
  displayName: string;
  skillsDir: string | null;
}

// Stable display order for agent letter shortcuts. Claude first, then the
// other primary-capable agents, then the catch-all.
const AGENT_ORDER = ["claude", "codex", "gemini", "continue"] as const;

// What the user picked on the location step.
type LibraryChoice =
  | { kind: "agentInPlace"; agentId: string; libraryPath: string }
  | { kind: "smCentralized" }
  | { kind: "claudeDefault" }
  | { kind: "custom"; path: string };

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

  // Agent step.
  const [agents, setAgents] = useState<AgentChoice[]>([]);
  const [primaryAgent, setPrimaryAgent] = useState<string>("claude");
  const [otherSelected, setOtherSelected] = useState(false);

  // Auto-scan of agent's default skills dir, populated when entering Agent
  // step and used on Location step to branch the UI.
  const [agentScanResult, setAgentScanResult] = useState<DetectedSkill[]>(
    [],
  );
  const [agentScanLoading, setAgentScanLoading] = useState(false);

  // Library choice.
  const [libraryChoice, setLibraryChoice] = useState<LibraryChoice | null>(
    null,
  );
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [customPath, setCustomPath] = useState<string>("");
  const [resolvedPaths, setResolvedPaths] = useState<{
    libraryPath: string;
    historyPath: string;
  } | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [deployMode, setDeployMode] = useState<DeployMode>("symlink");

  // Existing skills step.
  const [detectedSkills, setDetectedSkills] = useState<DetectedSkill[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [selectedToImport, setSelectedToImport] = useState<Set<string>>(
    new Set(),
  );
  // JSON entries pulled from a skills.json the user picked. We don't clone
  // these during setup — that's slow and can fail. Instead, after
  // completeSetup the ImportFlow opens with these pre-loaded.
  const [jsonEntries, setJsonEntries] = useState<
    {
      name: string;
      url: string;
      commit?: string | null;
      description?: string;
      alreadyInstalled: boolean;
    }[]
  >([]);
  const [jsonSourcePath, setJsonSourcePath] = useState<string | null>(null);

  const [progress, setProgress] = useState<string[]>([]);
  const setScreen = useAppStore((s) => s.setScreen);

  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  // Load the agent list once. Filter to PRIMARY_CAPABLE — cursor and cline
  // have no globalSkillPath so they can't be the primary agent.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await window.api.listAgents();
        if (cancelled) return;
        const PRIMARY_CAPABLE = new Set<string>([
          "claude",
          "codex",
          "gemini",
          "continue",
        ]);
        const filtered = list.filter((a) => PRIMARY_CAPABLE.has(a.id));
        // Sort by AGENT_ORDER so the letter shortcuts are stable.
        filtered.sort(
          (a, b) =>
            AGENT_ORDER.indexOf(a.id as typeof AGENT_ORDER[number]) -
            AGENT_ORDER.indexOf(b.id as typeof AGENT_ORDER[number]),
        );
        setAgents(
          filtered.map((a) => ({
            id: a.id,
            displayName: a.displayName,
            skillsDir: a.skillsDir,
          })),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setError]);

  // Auto-scan agent's default skills dir whenever the user picks one. The
  // result drives the Location step's branching.
  useEffect(() => {
    if (otherSelected) {
      setAgentScanResult([]);
      return;
    }
    const agent = agents.find((a) => a.id === primaryAgent);
    if (!agent || !agent.skillsDir) {
      setAgentScanResult([]);
      return;
    }
    let cancelled = false;
    setAgentScanLoading(true);
    (async () => {
      try {
        const found = await window.api.scanForExistingSkills(agent.skillsDir!);
        if (!cancelled) setAgentScanResult(found);
      } catch {
        if (!cancelled) setAgentScanResult([]);
      } finally {
        if (!cancelled) setAgentScanLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [primaryAgent, otherSelected, agents]);

  // Resolve the library choice → absolute paths whenever it changes.
  useEffect(() => {
    if (!libraryChoice) {
      setResolvedPaths(null);
      setPathError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let root: LibraryRoot;
        let path: string | null = null;
        switch (libraryChoice.kind) {
          case "agentInPlace":
            // Map known agents to their LibraryRoot preset; else custom.
            if (libraryChoice.agentId === "claude") root = "claude";
            else {
              root = "custom";
              path = libraryChoice.libraryPath;
            }
            break;
          case "smCentralized":
            root = "centralized";
            break;
          case "claudeDefault":
            root = "claude";
            break;
          case "custom":
            root = "custom";
            path = libraryChoice.path;
            break;
        }
        if (root === "custom" && !path) {
          setResolvedPaths(null);
          setPathError(null);
          return;
        }
        const r = await window.api.resolveLibraryRoot(root, path);
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
  }, [libraryChoice]);

  // When entering the Existing step, scan the chosen library — UNLESS the
  // user picked "Move to SM" with skills already detected at the agent
  // dir; in that case prefill with the agent-scan results so we move them.
  useEffect(() => {
    if (step !== "existing" || !resolvedPaths || !libraryChoice) return;
    let cancelled = false;
    setScanLoading(true);
    (async () => {
      try {
        // Source of detected skills depends on the library choice.
        let found: DetectedSkill[] = [];
        if (
          libraryChoice.kind === "smCentralized" &&
          agentScanResult.length > 0
        ) {
          // Move-from-agent flow: the candidates ARE the agent's skills.
          found = agentScanResult;
        } else {
          // Default: scan the chosen library location for anything already
          // there (idempotent re-runs, custom paths with prior data).
          found = await window.api.scanForExistingSkills(
            resolvedPaths.libraryPath,
          );
        }
        if (cancelled) return;
        setDetectedSkills(found);
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
  }, [step, resolvedPaths, libraryChoice, agentScanResult, setError]);

  // Keyboard shortcuts for the Agent step: a/b/c/d/e to select, Enter to
  // advance. Only active while the agent step is mounted, and ignored when
  // a text input has focus.
  useEffect(() => {
    if (step !== "agent") return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }
      const letterToIdx: Record<string, number> = {
        a: 0,
        b: 1,
        c: 2,
        d: 3,
      };
      const key = e.key.toLowerCase();
      if (key in letterToIdx) {
        const idx = letterToIdx[key];
        if (idx < agents.length) {
          e.preventDefault();
          setPrimaryAgent(agents[idx].id);
          setOtherSelected(false);
        }
      } else if (key === "e") {
        e.preventDefault();
        setOtherSelected(true);
      } else if (e.key === "Enter") {
        e.preventDefault();
        setStep("location");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [step, agents]);

  const canContinueLocation =
    libraryChoice !== null &&
    pathError === null &&
    resolvedPaths !== null;

  const onComplete = async () => {
    if (!resolvedPaths || !libraryChoice) return;
    setStep("running");
    setProgress(["Creating directories…"]);
    try {
      // Decide import mode from libraryChoice.
      const importMode: ImportMode =
        libraryChoice.kind === "smCentralized" &&
        agentScanResult.length > 0
          ? "move"
          : "copy";
      const importSkills = Array.from(selectedToImport).map((name) => {
        const detected = detectedSkills.find((d) => d.name === name);
        return {
          name,
          sourcePath: detected?.path ?? "",
          mode: importMode,
        };
      }).filter((s) => s.sourcePath !== "");

      // libraryRoot/customPath args mirror the LibraryChoice.
      let libraryRoot: LibraryRoot;
      let customArg: string | null = null;
      switch (libraryChoice.kind) {
        case "agentInPlace":
          if (libraryChoice.agentId === "claude") {
            libraryRoot = "claude";
          } else {
            libraryRoot = "custom";
            customArg = libraryChoice.libraryPath;
          }
          break;
        case "smCentralized":
          libraryRoot = "centralized";
          break;
        case "claudeDefault":
          libraryRoot = "claude";
          break;
        case "custom":
          libraryRoot = "custom";
          customArg = libraryChoice.path;
          break;
      }

      const args: CompleteSetupArgs = {
        libraryRoot,
        customPath: customArg,
        primaryAgent: otherSelected ? "claude" : primaryAgent,
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
      // Pre-load ImportFlow with skills.json entries if the user picked one.
      if (jsonEntries.length > 0) {
        setScreen({
          kind: "import",
          entries: jsonEntries.map((e) => ({
            name: e.name,
            url: e.url,
            commit: e.commit ?? null,
            description: e.description,
            alreadyInstalled: e.alreadyInstalled,
          })),
          sourcePath: jsonSourcePath,
          exportedAt: null,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("confirm");
    }
  };

  // Setup complete — App.tsx unmounts the overlay on next render.
  if (setup.completed) return null;

  const selectedAgent = agents.find((a) => a.id === primaryAgent);
  const skillsAtAgent = !otherSelected && agentScanResult.length > 0;

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
          WebkitAppRegion: "drag",
          height: 36,
          flexShrink: 0,
        } as React.CSSProperties}
      >
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
            <Welcome onNext={() => setStep("agent")} />
          )}
          {step === "agent" && (
            <AgentStep
              agents={agents}
              primaryAgent={primaryAgent}
              setPrimaryAgent={(id) => {
                setPrimaryAgent(id);
                setOtherSelected(false);
              }}
              otherSelected={otherSelected}
              setOtherSelected={setOtherSelected}
              onBack={() => setStep("welcome")}
              onNext={() => setStep("location")}
            />
          )}
          {step === "location" && (
            <LocationStep
              selectedAgent={selectedAgent ?? null}
              otherSelected={otherSelected}
              skillsAtAgent={skillsAtAgent}
              agentScanLoading={agentScanLoading}
              agentScanCount={agentScanResult.length}
              libraryChoice={libraryChoice}
              setLibraryChoice={setLibraryChoice}
              customPath={customPath}
              setCustomPath={setCustomPath}
              resolvedPaths={resolvedPaths}
              pathError={pathError}
              showMoreOptions={showMoreOptions}
              setShowMoreOptions={setShowMoreOptions}
              deployMode={deployMode}
              setDeployMode={setDeployMode}
              onBack={() => setStep("agent")}
              onNext={() => setStep("existing")}
              canContinue={canContinueLocation}
            />
          )}
          {step === "existing" && (
            <ExistingStep
              loading={scanLoading}
              detected={detectedSkills}
              selected={selectedToImport}
              setSelected={setSelectedToImport}
              libraryPath={resolvedPaths?.libraryPath ?? ""}
              moveMode={
                libraryChoice?.kind === "smCentralized" &&
                agentScanResult.length > 0
              }
              jsonEntries={jsonEntries}
              jsonSourcePath={jsonSourcePath}
              onScanFolder={async () => {
                const picked = await window.api.pickFolder();
                if (!picked) return;
                try {
                  const found =
                    await window.api.scanForExistingSkills(picked);
                  setDetectedSkills((prev) => {
                    const byName = new Map(prev.map((d) => [d.name, d]));
                    for (const f of found) byName.set(f.name, f);
                    return Array.from(byName.values()).sort((a, b) =>
                      a.name.localeCompare(b.name),
                    );
                  });
                  setSelectedToImport((prev) => {
                    const next = new Set(prev);
                    for (const f of found) next.add(f.name);
                    return next;
                  });
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
              onImportJson={async () => {
                try {
                  const picked = await window.api.readTextFile({
                    filterName: "Skill manifest",
                    extensions: ["json"],
                  });
                  if (!picked) return;
                  const result = await window.api.parseImportJson(
                    picked.content,
                  );
                  setJsonEntries(result.entries);
                  setJsonSourcePath(picked.path ?? null);
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
              onSkip={() => {
                setSelectedToImport(new Set());
                setJsonEntries([]);
                setJsonSourcePath(null);
                setStep("confirm");
              }}
              onBack={() => setStep("location")}
              onNext={() => setStep("confirm")}
            />
          )}
          {step === "confirm" && resolvedPaths && libraryChoice && (
            <ConfirmStep
              libraryChoice={libraryChoice}
              libraryPath={resolvedPaths.libraryPath}
              historyPath={resolvedPaths.historyPath}
              primaryAgent={primaryAgent}
              primaryAgentName={
                selectedAgent?.displayName ?? primaryAgent
              }
              deployMode={deployMode}
              importCount={selectedToImport.size}
              moveMode={
                libraryChoice.kind === "smCentralized" &&
                agentScanResult.length > 0
              }
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
        Let's set up your skill library. You'll pick your primary agent,
        where the library lives, and which existing skills to track.
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

function AgentStep({
  agents,
  primaryAgent,
  setPrimaryAgent,
  otherSelected,
  setOtherSelected,
  onBack,
  onNext,
}: {
  agents: AgentChoice[];
  primaryAgent: string;
  setPrimaryAgent: (id: string) => void;
  otherSelected: boolean;
  setOtherSelected: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 style={{ fontFamily: "var(--hand)", fontSize: 28, margin: 0 }}>
        Which agent do you use most?
      </h2>
      <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>
        We'll auto-scan its default skills folder and pre-select it for
        Deploy. Press the letter to pick, Enter to continue.
      </p>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginTop: 18,
        }}
      >
        {agents.map((a, i) => (
          <AgentCard
            key={a.id}
            letter={String.fromCharCode("a".charCodeAt(0) + i)}
            label={a.displayName}
            hint={a.skillsDir ?? "no global skills directory"}
            checked={!otherSelected && primaryAgent === a.id}
            onClick={() => setPrimaryAgent(a.id)}
          />
        ))}
        <AgentCard
          letter="e"
          label="Other / multiple agents"
          hint="Skip the agent default and pick a library location yourself."
          checked={otherSelected}
          onClick={() => setOtherSelected(true)}
        />
      </div>
      <Footer onBack={onBack} onNext={onNext} canContinue={true} />
    </div>
  );
}

function AgentCard({
  letter,
  label,
  hint,
  checked,
  onClick,
}: {
  letter: string;
  label: string;
  hint: string;
  checked: boolean;
  onClick: () => void;
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
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: 6,
          border: `1.5px solid ${checked ? "var(--accent)" : "var(--line)"}`,
          background: checked ? "var(--accent)" : "var(--paper-2)",
          color: checked ? "var(--on-accent)" : "var(--ink-soft)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--mono)",
          fontWeight: 700,
          fontSize: 13,
          flexShrink: 0,
        }}
      >
        {letter}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--mono)",
            color: "var(--ink-faint)",
          }}
        >
          {hint}
        </div>
      </div>
    </div>
  );
}

function LocationStep({
  selectedAgent,
  otherSelected,
  skillsAtAgent,
  agentScanLoading,
  agentScanCount,
  libraryChoice,
  setLibraryChoice,
  customPath,
  setCustomPath,
  resolvedPaths,
  pathError,
  showMoreOptions,
  setShowMoreOptions,
  deployMode,
  setDeployMode,
  onBack,
  onNext,
  canContinue,
}: {
  selectedAgent: AgentChoice | null;
  otherSelected: boolean;
  skillsAtAgent: boolean;
  agentScanLoading: boolean;
  agentScanCount: number;
  libraryChoice: LibraryChoice | null;
  setLibraryChoice: (c: LibraryChoice | null) => void;
  customPath: string;
  setCustomPath: (p: string) => void;
  resolvedPaths: { libraryPath: string; historyPath: string } | null;
  pathError: string | null;
  showMoreOptions: boolean;
  setShowMoreOptions: (v: boolean) => void;
  deployMode: DeployMode;
  setDeployMode: (m: DeployMode) => void;
  onBack: () => void;
  onNext: () => void;
  canContinue: boolean;
}) {
  const agent = selectedAgent;
  const agentDir = agent?.skillsDir ?? "";

  return (
    <div>
      <h2 style={{ fontFamily: "var(--hand)", fontSize: 28, margin: 0 }}>
        Where should your library live?
      </h2>
      <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>
        {otherSelected
          ? "Pick a centralized location."
          : skillsAtAgent
            ? `Found ${agentScanCount} skill${agentScanCount === 1 ? "" : "s"} in your ${agent?.displayName} folder. Pick one:`
            : agentScanLoading
              ? `Scanning ${agentDir}…`
              : `No skills found in your ${agent?.displayName} folder. We'll start fresh:`}
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginTop: 18,
        }}
      >
        {/* Branch on whether the agent already has skills. */}
        {!otherSelected && agent && skillsAtAgent && (
          <>
            <PrimaryCard
              checked={
                libraryChoice?.kind === "smCentralized"
              }
              onClick={() => setLibraryChoice({ kind: "smCentralized" })}
              title="Move to Skill Manager library"
              subtitle="~/.skill-stack/skills"
              hint={`Recommended. Moves the ${agentScanCount} found skill${agentScanCount === 1 ? "" : "s"} into the SM library and leaves a symlink at ${agentDir} so ${agent.displayName} keeps working. One source of truth across agents.`}
              recommended
            />
            <PrimaryCard
              checked={libraryChoice?.kind === "agentInPlace"}
              onClick={() =>
                setLibraryChoice({
                  kind: "agentInPlace",
                  agentId: agent.id,
                  libraryPath: agentDir,
                })
              }
              title={`Use ${agent.displayName}'s folder as the library`}
              subtitle={agentDir}
              hint="Best if you only use one agent. Skills stay where they are; nothing moves."
            />
          </>
        )}
        {!otherSelected && agent && !skillsAtAgent && !agentScanLoading && (
          <PrimaryCard
            checked={libraryChoice?.kind === "smCentralized"}
            onClick={() => setLibraryChoice({ kind: "smCentralized" })}
            title="Use Skill Manager default"
            subtitle="~/.skill-stack/skills"
            hint="Centralized location that works across agents. We'll create the directory if it doesn't exist."
            recommended
          />
        )}
        {otherSelected && (
          <PrimaryCard
            checked={libraryChoice?.kind === "smCentralized"}
            onClick={() => setLibraryChoice({ kind: "smCentralized" })}
            title="Use Skill Manager default"
            subtitle="~/.skill-stack/skills"
            hint="Agent-neutral location. Best for multi-agent workflows."
            recommended
          />
        )}
      </div>

      {/* Smaller folder-picker affordance below the primary cards. */}
      <div
        style={{
          marginTop: 14,
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="sk-btn sm ghost"
          onClick={async () => {
            const picked = await window.api.pickFolder();
            if (picked) {
              setCustomPath(picked);
              setLibraryChoice({ kind: "custom", path: picked });
            }
          }}
        >
          Choose a folder…
        </button>
        {libraryChoice?.kind === "custom" && (
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--ink-soft)",
            }}
          >
            {customPath}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="sk-btn sm ghost"
          onClick={() => setShowMoreOptions(!showMoreOptions)}
        >
          {showMoreOptions ? "Less options" : "More options"}
        </button>
      </div>

      {showMoreOptions && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            border: "1.5px dashed var(--line-soft)",
            borderRadius: 8,
            background: "var(--paper-2)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--hand)",
              fontSize: 18,
              marginBottom: 8,
            }}
          >
            Default deploy mode
          </div>
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
        </div>
      )}

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

function ExistingStep({
  loading,
  detected,
  selected,
  setSelected,
  libraryPath,
  moveMode,
  jsonEntries,
  jsonSourcePath,
  onScanFolder,
  onImportJson,
  onSkip,
  onBack,
  onNext,
}: {
  loading: boolean;
  detected: DetectedSkill[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  libraryPath: string;
  moveMode: boolean;
  jsonEntries: { name: string; url: string }[];
  jsonSourcePath: string | null;
  onScanFolder: () => void;
  onImportJson: () => void;
  onSkip: () => void;
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
            {moveMode
              ? `Found ${detected.length} skill${detected.length === 1 ? "" : "s"}. Selected ones will be moved to ${libraryPath} with symlinks left at the original location.`
              : `Found ${detected.length} skill${detected.length === 1 ? "" : "s"} at ${libraryPath}. Select which to track in your library.`}
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
                {s.viaContainer && (
                  <span
                    className="sk-tag"
                    style={{ fontSize: 9 }}
                    title={`found via ${s.viaContainer}/`}
                  >
                    via {s.viaContainer}/
                  </span>
                )}
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

      <div
        style={{
          marginTop: 14,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <button
          type="button"
          className="sk-btn sm ghost"
          onClick={onScanFolder}
        >
          + Scan another folder…
        </button>
        <button
          type="button"
          className="sk-btn sm ghost"
          onClick={onImportJson}
        >
          + Import skills.json…
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="sk-btn sm ghost"
          onClick={onSkip}
          title="Don't import anything during setup"
        >
          Skip imports
        </button>
      </div>
      {jsonEntries.length > 0 && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            background: "var(--paper-2)",
            borderRadius: 6,
            fontSize: 11,
            fontFamily: "var(--mono)",
            color: "var(--ink-soft)",
          }}
        >
          {jsonEntries.length} skill{jsonEntries.length === 1 ? "" : "s"} from
          JSON {jsonSourcePath ? `(${jsonSourcePath.split("/").pop()})` : ""}{" "}
          will install after setup.
        </div>
      )}
      <Footer onBack={onBack} onNext={onNext} canContinue={!loading} />
    </div>
  );
}

function ConfirmStep({
  libraryChoice,
  libraryPath,
  historyPath,
  primaryAgent,
  primaryAgentName,
  deployMode,
  importCount,
  moveMode,
  onBack,
  onComplete,
}: {
  libraryChoice: LibraryChoice;
  libraryPath: string;
  historyPath: string;
  primaryAgent: string;
  primaryAgentName: string;
  deployMode: DeployMode;
  importCount: number;
  moveMode: boolean;
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
        Confirm and we'll create directories and {moveMode
          ? "move selected skills with a symlink-back"
          : "import any selected skills"}.
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
          <span style={{ color: "var(--ink-faint)" }}>library:</span>{" "}
          {libraryChoiceLabel(libraryChoice)}
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
          <span style={{ color: "var(--ink-faint)" }}>
            {moveMode ? "move:" : "import:"}
          </span>{" "}
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
        <button type="button" className="sk-btn ghost" onClick={onBack}>
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

function libraryChoiceLabel(c: LibraryChoice): string {
  switch (c.kind) {
    case "agentInPlace":
      return `${c.agentId} (in place)`;
    case "smCentralized":
      return "Skill Manager (centralized)";
    case "claudeDefault":
      return "Claude home";
    case "custom":
      return `custom (${c.path})`;
  }
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
  const order: Step[] = ["welcome", "agent", "location", "existing", "confirm"];
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

function PrimaryCard({
  checked,
  onClick,
  title,
  subtitle,
  hint,
  recommended,
}: {
  checked: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  hint: string;
  recommended?: boolean;
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
        padding: 14,
        border: `1.5px solid ${checked ? "var(--accent)" : "var(--line-soft)"}`,
        borderRadius: 8,
        background: checked ? "var(--card-selected-bg)" : "var(--paper)",
        cursor: "pointer",
        position: "relative",
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
          <div
            style={{
              fontWeight: 700,
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {title}
            {recommended && (
              <span
                className="sk-tag"
                style={{ fontSize: 9, background: "var(--good)", color: "var(--on-accent)" }}
              >
                recommended
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--mono)",
              color: "var(--ink-soft)",
            }}
          >
            {subtitle}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 4 }}>
            {hint}
          </div>
        </div>
      </div>
    </div>
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

// Suppress unused-import warning.
void ({} as { _: typeof useMemo });
