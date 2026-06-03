// Deploy tab — single targeting surface for skills + stacks. Three-column
// layout: WHAT (queued skill or stack) → WHICH AGENTS → WHICH PROJECTS,
// with a deploy bar at the bottom and the active-deployments ledger below.
//
// Library and Stacks views never open a deploy modal of their own — they
// queue an item via queueSkillForDeploy / queueStackForDeploy and switch
// to this tab. From here the user picks agents + projects + mode, hits
// Deploy, and the run iterates agent × project × queue-item.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../state/store";
import type {
  DeployMode,
  DeployRequest,
  Skill,
  SkillStack,
  TrackedProject,
} from "../../electron/services/types";

interface AgentMeta {
  id: string;
  displayName: string;
  supportsSymlinks: boolean;
  formatNotes: string | null;
  /** Per-project skill path template (e.g. ".claude/skills/{name}/").
   *  Drives the deploy path preview rendered below the agent
   *  checkboxes. */
  projectSkillPath: string;
  /** Absolute path to the agent's global skills dir, or null if the agent
   *  has no global concept (cursor, cline). Drives the home-library ✓ pip
   *  and the "Send to checked globally" button's per-agent eligibility. */
  skillsDir: string | null;
}

interface DeployRunMessage {
  level: "info" | "warn" | "error" | "success";
  text: string;
}

function tildify(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~");
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const safe = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const t = new Date(safe).getTime();
  if (isNaN(t)) return "never";
  const diff = Date.now() - t;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const STACK_ICON_SMALL = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect x="2" y="2.5" width="10" height="2.5" rx="0.6" />
    <rect x="2" y="5.75" width="10" height="2.5" rx="0.6" />
    <rect x="2" y="9" width="10" height="2.5" rx="0.6" />
  </svg>
);

export function DeployView() {
  const skills = useAppStore((s) => s.skills);
  const stacks = useAppStore((s) => s.stacks);
  const stackDeployments = useAppStore((s) => s.stackDeployments);
  const projects = useAppStore((s) => s.projects);
  const settings = useAppStore((s) => s.settings);
  const setup = useAppStore((s) => s.setup);
  const deployQueue = useAppStore((s) => s.deployQueue);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const loadStacks = useAppStore((s) => s.loadStacks);
  const loadStackDeployments = useAppStore((s) => s.loadStackDeployments);
  const queueSkillForDeploy = useAppStore((s) => s.queueSkillForDeploy);
  const queueStackForDeploy = useAppStore((s) => s.queueStackForDeploy);
  const clearDeployQueue = useAppStore((s) => s.clearDeployQueue);
  const openModal = useAppStore((s) => s.openModal);
  const setError = useAppStore((s) => s.setError);

  const [agents, setAgents] = useState<AgentMeta[]>([]);
  // Pre-select the user's primary agent. The store's setup is always
  // populated by the time DeployView renders (App.tsx gates on
  // setup.completed before showing tabs).
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(
    new Set([setup.primaryAgent || "claude"]),
  );
  // Per-agent home-library status for the currently-queued item. Maps
  // agentId → "is the queued skill/stack already in this agent's global
  // dir?". Drives the ✓ pip on each agent row and disables the "Send
  // globally" button for agents that already have it.
  const [agentGlobalStatus, setAgentGlobalStatus] = useState<
    Record<string, boolean>
  >({});
  /** True while a global send is mid-flight — disables the button so a
   *  hammered click doesn't fire N parallel writes. */
  const [sendingGlobal, setSendingGlobal] = useState(false);
  /** Agent id whose per-row "Deploy to library" chip is mid-flight, or null.
   *  Drives the inline spinner and prevents double-fire on that one row while
   *  leaving the other rows live. */
  const [deployingAgent, setDeployingAgent] = useState<string | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(
    new Set(),
  );
  const [pendingProjectPath, setPendingProjectPath] = useState("");
  const [deployMode, setDeployMode] = useState<DeployMode>(
    settings.default_deploy_mode,
  );
  const [picker, setPicker] = useState("");
  const [running, setRunning] = useState(false);
  /** Guard against multi-clicks on the HomeLibraryPrompt's "Add" button —
   *  the underlying deployStackToHomeLibrary writes to disk + config and
   *  shouldn't fire concurrently from a hammered button. */
  const [addingToHomeLibrary, setAddingToHomeLibrary] = useState(false);

  useEffect(() => {
    refreshSkills();
    refreshProjects();
    loadStacks();
    loadStackDeployments();
    let cancelled = false;
    window.api
      .listAgents()
      .then((list) => {
        if (!cancelled) setAgents(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshSkills, refreshProjects, loadStacks, loadStackDeployments]);

  // Re-sync the deploy mode default whenever settings change. Lets the
  // toggle reflect a user setting flip without losing in-progress UI state.
  useEffect(() => {
    setDeployMode(settings.default_deploy_mode);
  }, [settings.default_deploy_mode]);

  // Refresh per-agent home-library status whenever the queued item
  // changes. Best-effort — if the IPC fails we just don't show the
  // indicator dots, which is harmless. The ledger also gets refreshed
  // after a global send completes (see sendToCheckedGlobally) so the
  // ✓ updates without a manual reload.
  useEffect(() => {
    if (!deployQueue) {
      setAgentGlobalStatus({});
      return;
    }
    let cancelled = false;
    const fetch =
      deployQueue.type === "skill"
        ? window.api.getSkillGlobalStatus(deployQueue.id)
        : window.api.getStackGlobalStatus(deployQueue.id);
    fetch
      .then((status) => {
        if (!cancelled) setAgentGlobalStatus(status);
      })
      .catch(() => {
        if (!cancelled) setAgentGlobalStatus({});
      });
    return () => {
      cancelled = true;
    };
  }, [deployQueue]);

  const refreshAgentGlobalStatus = async () => {
    if (!deployQueue) return;
    try {
      const status =
        deployQueue.type === "skill"
          ? await window.api.getSkillGlobalStatus(deployQueue.id)
          : await window.api.getStackGlobalStatus(deployQueue.id);
      setAgentGlobalStatus(status);
    } catch {
      // Best-effort; status stays whatever it was.
    }
  };

  const sendToCheckedGlobally = async () => {
    if (!deployQueue || sendingGlobal) return;
    // Only act on checked agents that (a) have a global skills dir and
    // (b) don't already have this skill/stack. Already-present agents (✓)
    // are skipped entirely — re-sending there is a no-op, so the button
    // never offers it. (The checkbox itself stays live because it's shared
    // with the project-deploy flow on the right.)
    const targets = agents.filter(
      (a) =>
        selectedAgents.has(a.id) &&
        a.skillsDir &&
        agentGlobalStatus[a.id] !== true,
    );
    if (targets.length === 0) return; // button is disabled in this state
    setSendingGlobal(true);
    const deployed: string[] = [];
    const failed: { agentId: string; error: string }[] = [];
    for (const a of targets) {
      try {
        // Both skill and stack land at <agentSkillsDir>/<id>/ — the stack's
        // meta-SKILL.md lives at <library>/<stackId>/ so the same global
        // send primitive works for both.
        await window.api.deploySkillGlobally(deployQueue.id, a.id, deployMode);
        deployed.push(a.displayName);
      } catch (err) {
        failed.push({
          agentId: a.displayName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await refreshAgentGlobalStatus();
    setSendingGlobal(false);
    openModal({
      type: "deployResult",
      itemKind: deployQueue.type,
      itemId: deployQueue.id,
      messages: [
        ...deployed.map((a) => ({
          level: "success" as const,
          text: `→ ${a} — linked (${deployMode})`,
        })),
        ...failed.map((f) => ({
          level: "error" as const,
          text: `✗ ${f.agentId}: ${f.error}`,
        })),
      ],
    });
  };

  /** Deploy the queued skill/stack into ONE agent's global skills dir,
   *  independent of that agent's checkbox. Backs the per-row "+ Deploy to
   *  library" chip — the discoverable replacement for the old "·" pip +
   *  batch button, which users couldn't find. Uses the current deployMode
   *  toggle (Symlink/Copy). */
  const deployOneGlobally = async (agentId: string) => {
    if (!deployQueue || deployingAgent) return;
    setDeployingAgent(agentId);
    try {
      await window.api.deploySkillGlobally(deployQueue.id, agentId, deployMode);
      await refreshAgentGlobalStatus();
    } catch (err) {
      const agent = agents.find((a) => a.id === agentId);
      openModal({
        type: "deployResult",
        itemKind: deployQueue.type,
        itemId: deployQueue.id,
        messages: [
          {
            level: "error",
            text: `✗ ${agent?.displayName ?? agentId}: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      });
    } finally {
      setDeployingAgent(null);
    }
  };

  // Pre-select last-used project when a queue lands and there's no current
  // selection. Keeps the "Send to Deploy from Library → click Deploy" path
  // one click shorter.
  useEffect(() => {
    if (!deployQueue || selectedProjects.size > 0) return;
    let cancelled = false;
    window.api
      .getLastProject()
      .then((p) => {
        if (cancelled || !p) return;
        if (projects.some((proj) => proj.path === p)) {
          setSelectedProjects(new Set([p]));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // selectedProjects intentionally omitted — we only want to seed once
    // per queue change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployQueue, projects]);

  const queuedSkill = useMemo<Skill | null>(() => {
    if (deployQueue?.type !== "skill") return null;
    return skills.find((s) => s.name === deployQueue.id) ?? null;
  }, [deployQueue, skills]);

  const queuedStack = useMemo<SkillStack | null>(() => {
    if (deployQueue?.type !== "stack") return null;
    return stacks.find((s) => s.id === deployQueue.id) ?? null;
  }, [deployQueue, stacks]);

  const pickerResults = useMemo(() => {
    const q = picker.trim().toLowerCase();
    if (!q && deployQueue) return [];
    const matches: { kind: "skill" | "stack"; name: string; id: string; description: string }[] = [];
    for (const s of skills) {
      if (
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.displayName.toLowerCase().includes(q)
      ) {
        matches.push({
          kind: "skill",
          id: s.name,
          name: s.displayName,
          description: s.description ?? "",
        });
      }
    }
    for (const st of stacks) {
      if (
        !q ||
        st.id.toLowerCase().includes(q) ||
        st.name.toLowerCase().includes(q)
      ) {
        matches.push({
          kind: "stack",
          id: st.id,
          name: st.name,
          description: `${st.skillIds.length} skill${st.skillIds.length === 1 ? "" : "s"}${st.description ? ` · ${st.description}` : ""}`,
        });
      }
    }
    return matches.slice(0, 30);
  }, [picker, skills, stacks, deployQueue]);

  const toggleAgent = (id: string) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleProject = (path: string) => {
    setSelectedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleAddProject = useCallback(async () => {
    const raw = pendingProjectPath.trim();
    if (!raw) {
      const picked = await window.api.pickFolder();
      if (!picked) return;
      setPendingProjectPath(picked);
      setSelectedProjects((prev) => new Set(prev).add(picked));
      return;
    }
    // Expand ~/ to the user's home dir — backend validateProjectPath
    // requires absolute paths and was rejecting tilde-prefixed input
    // with ValidationError.
    let target = raw;
    if (target === "~" || target.startsWith("~/")) {
      try {
        const env = await window.api.envInfo();
        target = target === "~" ? env.home : `${env.home}${target.slice(1)}`;
      } catch {
        // Fall through with the raw value; backend will surface a clear
        // error if it's still invalid.
      }
    }
    setSelectedProjects((prev) => new Set(prev).add(target));
    setPendingProjectPath("");
  }, [pendingProjectPath]);

  const performDeploy = async () => {
    if (!deployQueue) return;
    if (selectedAgents.size === 0 || selectedProjects.size === 0) return;
    setRunning(true);
    const messages: DeployRunMessage[] = [];
    let anyFailure = false;
    try {
      for (const projectPath of selectedProjects) {
        for (const agentId of selectedAgents) {
          try {
            if (deployQueue.type === "skill") {
              const r = await window.api.deploySkill(
                deployQueue.id,
                projectPath,
                { agentId, deployMode },
              );
              messages.push({
                level: "success",
                text: `→ ${tildify(projectPath)} (${r.deployMode}, ${agentId})`,
              });
              if (r.warning) {
                messages.push({ level: "warn", text: r.warning });
              }
            } else {
              const r = await window.api.deployStack(
                deployQueue.id,
                projectPath,
                agentId,
                deployMode,
              );
              messages.push({
                level: "success",
                text: `→ ${tildify(projectPath)} (${r.deployMode}, ${agentId}, ${r.deployed.length}/${r.deployed.length + r.failed.length} skills)`,
              });
              for (const f of r.failed) {
                anyFailure = true;
                messages.push({
                  level: "error",
                  text: `  ${f.skillId}: ${f.error}`,
                });
              }
              if (r.warning) {
                messages.push({ level: "warn", text: r.warning });
              }
            }
          } catch (err) {
            anyFailure = true;
            messages.push({
              level: "error",
              text: `→ ${tildify(projectPath)} (${agentId}): ${
                err instanceof Error ? err.message : String(err)
              }`,
            });
          }
        }
      }
      // Show the result as a real modal so it doesn't push the column
      // layout around the way an inline card did.
      if (messages.length > 0) {
        openModal({
          type: "deployResult",
          itemKind: deployQueue.type,
          itemId: deployQueue.id,
          messages,
        });
      }
      await refreshSkills();
      await refreshProjects();
      await loadStackDeployments();
      if (!anyFailure) {
        // Clear the queue so the user can stage a fresh deploy without
        // first hitting Clear. Selections persist for batch follow-ups.
        clearDeployQueue();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const canDeploy =
    !running &&
    !!deployQueue &&
    selectedAgents.size > 0 &&
    selectedProjects.size > 0;

  // Surface WHY the Deploy button is disabled so users don't stare at a
  // greyed-out button wondering what's missing. Order matches the user's
  // expected workflow: pick skill → pick agent(s) → pick project(s).
  const deployDisabledReason = !deployQueue
    ? "Pick a skill or stack on the left first."
    : selectedAgents.size === 0
      ? "Select at least one agent."
      : selectedProjects.size === 0
        ? "Select at least one project."
        : running
          ? "Deploy in progress…"
          : null;

  return (
    <div
      style={{
        flex: 1,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        overflow: "auto",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.1fr 1fr 1.3fr",
          gap: 12,
          minHeight: 200,
        }}
      >
        {/* WHAT */}
        <Column title="What">
          {deployQueue ? (
            <QueuedItemCard
              queue={deployQueue}
              skill={queuedSkill}
              stack={queuedStack}
              onClear={clearDeployQueue}
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                type="text"
                value={picker}
                onChange={(e) => setPicker(e.target.value)}
                placeholder="Search skills or stacks…"
                style={{
                  ...inputStyle,
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                }}
              />
              <div
                className="sk-box"
                style={{
                  padding: 0,
                  maxHeight: 220,
                  overflow: "auto",
                  background: "var(--paper-2)",
                }}
              >
                {pickerResults.length === 0 ? (
                  <div
                    style={{
                      padding: 20,
                      textAlign: "center",
                      fontSize: 12,
                      color: "var(--ink-faint)",
                    }}
                  >
                    {picker.trim()
                      ? `No matches for "${picker}".`
                      : "Type to search, or send something here from the Library or Stacks tab."}
                  </div>
                ) : (
                  pickerResults.map((m) => (
                    <button
                      key={`${m.kind}:${m.id}`}
                      type="button"
                      onClick={() =>
                        m.kind === "skill"
                          ? queueSkillForDeploy(m.id)
                          : queueStackForDeploy(m.id)
                      }
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "6px 10px",
                        background: "transparent",
                        border: "none",
                        borderBottom: "1px dashed var(--line-soft)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 16,
                          color:
                            m.kind === "stack"
                              ? "var(--accent)"
                              : "var(--ink-faint)",
                          display: "inline-flex",
                        }}
                      >
                        {m.kind === "stack" ? STACK_ICON_SMALL : "·"}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: "var(--read)",
                            fontSize: 12,
                            fontWeight: 600,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {m.name}
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 10,
                            color: "var(--ink-faint)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {m.description || m.id}
                        </div>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </Column>

        {/* AGENTS */}
        <Column
          title="Agents"
          rightSlot={
            <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>
              {selectedAgents.size} selected
            </span>
          }
        >
          {agents.length === 0 ? (
            <div
              style={{
                padding: 12,
                fontSize: 12,
                color: "var(--ink-faint)",
              }}
            >
              Loading agents…
            </div>
          ) : (
            <div
              className="sk-box"
              style={{
                padding: 6,
                background: "var(--paper-2)",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              {[...agents]
                .sort((a, b) => {
                  // Primary agent pinned to top; everything else preserves
                  // the registry order.
                  if (a.id === setup.primaryAgent) return -1;
                  if (b.id === setup.primaryAgent) return 1;
                  return 0;
                })
                .map((a) => {
                const checked = selectedAgents.has(a.id);
                const isPrimary = a.id === setup.primaryAgent;
                // Three home-library states:
                //   - inLibrary === true  → ✓, queued item is already in this
                //     agent's global dir
                //   - inLibrary === false → ·, agent has a global dir but the
                //     queued item isn't there yet
                //   - !a.skillsDir        → —, agent has no global concept
                //     (cursor, cline) — global-send is N/A
                const inLibrary = deployQueue
                  ? agentGlobalStatus[a.id] === true
                  : null;
                // Exact path the existence check ran against. Surfaced in
                // the tooltip so users can see at a glance why Claude
                // shows · while Codex shows ✓ — it's whichever agent dirs
                // physically contain the skill/stack id on disk.
                const checkedPath =
                  a.skillsDir && deployQueue
                    ? `${a.skillsDir}/${deployQueue.id}`
                    : null;
                return (
                  <label
                    key={a.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 8px",
                      cursor: "pointer",
                      borderRadius: 4,
                      background: checked ? "var(--card-selected-bg)" : "transparent",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAgent(a.id)}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "var(--read)",
                          fontSize: 12,
                          fontWeight: checked ? 600 : 400,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {a.displayName}
                        {isPrimary && (
                          <span
                            style={{
                              fontFamily: "var(--mono)",
                              fontSize: 9,
                              color: "var(--ink-faint)",
                            }}
                          >
                            · primary
                          </span>
                        )}
                      </div>
                      {!a.supportsSymlinks && (
                        <div
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 9,
                            color: "var(--ink-faint)",
                          }}
                        >
                          symlink → falls back to copy
                        </div>
                      )}
                    </span>
                    {/* Per-agent global-library affordance:
                        - in library  → dimmed "✓ in library" pill (no-op)
                        - not yet      → clickable "+ Deploy to library" chip
                          that links the queued item straight into THIS agent's
                          global dir (independent of the checkbox)
                        - no global dir (cursor/cline) → "—" project-only.
                        The chip lives inside the row's <label>, so its click
                        handler must stop the event from toggling the
                        checkbox. */}
                    {a.skillsDir ? (
                      inLibrary === true ? (
                        <span
                          title={`Found: ${checkedPath}`}
                          aria-label={`${a.displayName}: in global library`}
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 10,
                            padding: "2px 8px",
                            borderRadius: 10,
                            border: "1px solid var(--line)",
                            color: "var(--good)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          ✓ in library
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={!deployQueue || deployingAgent !== null}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void deployOneGlobally(a.id);
                          }}
                          title={
                            !deployQueue
                              ? "Pick a skill or stack first"
                              : `Deploy into ${checkedPath} (${deployMode})`
                          }
                          aria-label={`Deploy ${a.displayName} to global library`}
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 10,
                            padding: "2px 8px",
                            borderRadius: 10,
                            border: "1px dashed var(--accent)",
                            background: "transparent",
                            color: "var(--accent)",
                            cursor:
                              !deployQueue || deployingAgent !== null
                                ? "default"
                                : "pointer",
                            opacity: deployingAgent === a.id ? 0.6 : 1,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {deployingAgent === a.id
                            ? "Deploying…"
                            : "+ Deploy to library"}
                        </button>
                      )
                    ) : (
                      <span
                        title={`${a.displayName} has no global skills dir — deploy to a project instead`}
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          color: "var(--ink-faint)",
                          width: 16,
                          textAlign: "center",
                        }}
                      >
                        —
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
          {/* Status legend — explains the ✓ / · / — column so it isn't a
              mystery. Only shown once an item is queued (the pips only
              mean anything then). */}
          {deployQueue && (
            <div
              style={{
                marginTop: 6,
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                fontFamily: "var(--read)",
                fontSize: 10,
                color: "var(--ink-faint)",
              }}
            >
              <span>
                <b style={{ color: "var(--good)" }}>✓ in library</b> already
                deployed
              </span>
              <span>
                <b style={{ color: "var(--accent)" }}>+ Deploy to library</b>{" "}
                click to deploy into that agent
              </span>
              <span>
                <b>—</b> project-only agent (no global dir)
              </span>
            </div>
          )}

          {/* Global-send button — promotes the queued skill/stack into
              every checked agent's global skills dir (no project
              required). Sits below the checkboxes so the column title
              text isn't crowded. */}
          {deployQueue &&
            (() => {
              // Actionable = checked agents that have a global dir AND don't
              // already have it. Already-present (✓) and project-only (—)
              // agents are excluded, so the button never offers a no-op
              // send. The label/disabled state reflect that count exactly.
              const actionable = agents.filter(
                (a) =>
                  selectedAgents.has(a.id) &&
                  a.skillsDir &&
                  agentGlobalStatus[a.id] !== true,
              );
              const checkedWithGlobal = agents.filter(
                (a) => selectedAgents.has(a.id) && a.skillsDir,
              );
              const allAlreadyHaveIt =
                checkedWithGlobal.length > 0 && actionable.length === 0;
              const disabled = sendingGlobal || actionable.length === 0;
              const label = sendingGlobal
                ? "Sending…"
                : actionable.length > 0
                  ? `Send to ${actionable.length} agent${actionable.length === 1 ? "" : "s"} globally`
                  : allAlreadyHaveIt
                    ? "✓ All checked agents already have it"
                    : "Tick an agent that doesn't have it yet";
              return (
                <button
                  type="button"
                  className="sk-btn"
                  disabled={disabled}
                  onClick={sendToCheckedGlobally}
                  title={
                    actionable.length === 0
                      ? allAlreadyHaveIt
                        ? "Every checked agent already has this in its global skills dir — nothing to send"
                        : "Tick one or more agents that don't already have it (Cursor and Cline are project-only)"
                      : `Link the current skill or stack into the global skills dir of: ${actionable.map((a) => a.displayName).join(", ")}`
                  }
                  style={{
                    marginTop: 8,
                    width: "100%",
                    background: "var(--accent)",
                    color: "var(--on-accent)",
                    borderColor: "var(--accent)",
                    fontWeight: 600,
                    opacity: disabled ? 0.5 : 1,
                  }}
                >
                  {label}
                </button>
              );
            })()}

          {/* Path preview — shows exactly where files will land for each
              selected agent. Uses the queued item's id as the {name}
              substitution; falls back to {skill-name} placeholder when
              no item is queued yet. */}
          {selectedAgents.size > 0 && (
            <div
              className="sk-box dashed"
              style={{
                marginTop: 8,
                padding: 8,
                fontFamily: "var(--mono)",
                fontSize: 10,
                lineHeight: 1.5,
                color: "var(--ink-soft)",
                background: "var(--paper-2)",
              }}
              title="Where files will land in each selected agent's per-project skills dir"
            >
              {agents
                .filter((a) => selectedAgents.has(a.id))
                .map((a) => {
                  const sample = deployQueue?.id ?? "{skill-name}";
                  const path = a.projectSkillPath.replace(
                    /\{name\}/g,
                    sample,
                  );
                  return (
                    <div key={a.id}>
                      <span style={{ color: "var(--ink)" }}>
                        {a.displayName}
                      </span>{" "}
                      → {path}
                    </div>
                  );
                })}
            </div>
          )}
        </Column>

        {/* PROJECTS */}
        <Column
          title="Projects"
          rightSlot={
            <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>
              {selectedProjects.size} selected
            </span>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 4 }}>
              <input
                type="text"
                value={pendingProjectPath}
                onChange={(e) => setPendingProjectPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddProject();
                  }
                }}
                placeholder="Add project path…"
                style={{
                  ...inputStyle,
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  flex: 1,
                }}
              />
              <button className="sk-btn sm" onClick={handleAddProject}>
                {pendingProjectPath.trim() ? "Add" : "Browse…"}
              </button>
            </div>
            <div
              className="sk-box"
              style={{
                padding: 4,
                background: "var(--paper-2)",
                maxHeight: 220,
                overflow: "auto",
              }}
            >
              {projects.length === 0 ? (
                <div
                  style={{
                    padding: 12,
                    fontSize: 12,
                    color: "var(--ink-faint)",
                    textAlign: "center",
                  }}
                >
                  No tracked projects yet. Add one above.
                </div>
              ) : (
                projects.map((p) => {
                  const checked = selectedProjects.has(p.path);
                  return (
                    <label
                      key={p.path}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "5px 8px",
                        cursor: p.exists ? "pointer" : "not-allowed",
                        opacity: p.exists ? 1 : 0.6,
                        borderRadius: 4,
                        background: checked
                          ? "var(--card-selected-bg)"
                          : "transparent",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleProject(p.path)}
                        disabled={!p.exists}
                      />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 11,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={p.path}
                        >
                          {tildify(p.path)}
                          {!p.exists && (
                            <span
                              style={{
                                marginLeft: 6,
                                color: "var(--warn)",
                                fontFamily: "var(--read)",
                                fontSize: 10,
                              }}
                            >
                              (missing)
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: 9,
                            color: "var(--ink-faint)",
                          }}
                        >
                          {p.skillCount} skill
                          {p.skillCount === 1 ? "" : "s"} · last{" "}
                          {relativeTime(p.lastDeployedAt)}
                        </div>
                      </span>
                    </label>
                  );
                })
              )}
              {Array.from(selectedProjects).filter(
                (p) => !projects.some((proj) => proj.path === p),
              ).length > 0 && (
                <div
                  style={{
                    padding: "6px 8px",
                    borderTop: "1px dashed var(--line-soft)",
                    fontSize: 10,
                    color: "var(--ink-faint)",
                  }}
                >
                  + new path
                  {Array.from(selectedProjects)
                    .filter(
                      (p) => !projects.some((proj) => proj.path === p),
                    )
                    .map((p) => (
                      <div
                        key={p}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          color: "var(--ink)",
                        }}
                      >
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p}>
                          {tildify(p)}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${p} from selection`}
                          onClick={() =>
                            setSelectedProjects((prev) => {
                              const next = new Set(prev);
                              next.delete(p);
                              return next;
                            })
                          }
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--ink-faint)",
                            cursor: "pointer",
                            padding: "0 4px",
                            fontSize: 14,
                            lineHeight: 1,
                          }}
                          title="Remove this path"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </Column>
      </div>

      {/* Home-library prompt — appears between the 3-column grid and the
          Deploy bar. Nudges users toward populating their home library
          when a queued stack isn't there yet. Once deployed, the prompt
          flips to a non-interactive confirmation; we don't surface a
          remove path here because populating the library is the
          intended direction of travel. */}
      {queuedStack && (
        <HomeLibraryPrompt
          stack={queuedStack}
          onDeploy={async () => {
            if (addingToHomeLibrary) return;
            setAddingToHomeLibrary(true);
            try {
              await useAppStore.getState().deployStackToHomeLibrary(
                queuedStack.id,
              );
            } catch (err) {
              useAppStore
                .getState()
                .setError(err instanceof Error ? err.message : String(err));
            } finally {
              setAddingToHomeLibrary(false);
            }
          }}
        />
      )}

      {/* Deploy bar */}
      <div
        className="sk-box"
        style={{
          padding: 12,
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--paper-2)",
        }}
      >
        <ModeToggle
          mode={deployMode}
          onChange={setDeployMode}
          defaultMode={settings.default_deploy_mode}
        />
        {deployMode === "symlink" && (
          <span
            title="Symlinked deployments resolve back to the library copy. Edits in the project tree write to the library and propagate to every other project (and every agent) that symlinks the same skill."
            style={{
              fontFamily: "var(--read)",
              fontSize: 11,
              color: "var(--warn)",
              border: "1px dashed var(--warn)",
              padding: "3px 8px",
              borderRadius: 12,
              whiteSpace: "nowrap",
            }}
          >
            ⚠ edits sync everywhere
          </span>
        )}
        <div style={{ flex: 1 }}>
          {deployQueue ? (
            <span
              style={{
                fontFamily: "var(--read)",
                fontSize: 12,
                color: "var(--ink-soft)",
              }}
            >
              Will deploy <b>{deployQueue.id}</b> to{" "}
              <b>{selectedProjects.size}</b>{" "}
              project{selectedProjects.size === 1 ? "" : "s"} ×{" "}
              <b>{selectedAgents.size}</b>{" "}
              agent{selectedAgents.size === 1 ? "" : "s"}
            </span>
          ) : (
            <span
              style={{
                fontFamily: "var(--read)",
                fontSize: 12,
                color: "var(--ink-faint)",
              }}
            >
              Pick a skill or stack on the left to start.
            </span>
          )}
        </div>
        <button
          className="sk-btn"
          disabled={!canDeploy}
          onClick={performDeploy}
          title={deployDisabledReason ?? "Deploy now"}
          style={{
            background: canDeploy ? "var(--accent)" : "var(--paper-2)",
            color: canDeploy ? "var(--on-accent)" : "var(--ink-faint)",
            borderColor: canDeploy ? "var(--accent)" : "var(--line-soft)",
            fontWeight: 700,
          }}
        >
          {running ? "Deploying…" : "Deploy"}
        </button>
      </div>

      <ActiveDeploymentsLedger
        projects={projects}
        stacks={stacks}
        stackDeployments={stackDeployments}
        agents={agents}
        onRemoveProject={(path) =>
          openModal({ type: "removeProject", path })
        }
      />
    </div>
  );
}

function Column({
  title,
  rightSlot,
  children,
}: {
  title: string;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <div className="rail-section" style={{ padding: 0, fontSize: 11 }}>
          {title}
        </div>
        {rightSlot}
      </div>
      {children}
    </section>
  );
}

function QueuedItemCard({
  queue,
  skill,
  stack,
  onClear,
}: {
  queue: DeployRequest;
  skill: Skill | null;
  stack: SkillStack | null;
  onClear: () => void;
}) {
  return (
    <div
      className="sk-box"
      style={{
        padding: 12,
        background: "var(--card-selected-bg)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 18,
            height: 18,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: queue.type === "stack" ? "var(--accent)" : "var(--ink-soft)",
          }}
        >
          {queue.type === "stack" ? STACK_ICON_SMALL : "·"}
        </span>
        <span
          className="sk-tag"
          style={{
            fontSize: 9,
            background: queue.type === "stack" ? "var(--accent)" : "var(--paper-2)",
            color: queue.type === "stack" ? "var(--on-accent)" : "var(--ink)",
          }}
        >
          {queue.type}
        </span>
        <div
          style={{
            flex: 1,
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: "var(--ink)",
          }}
        >
          {queue.id}
        </div>
        <button className="sk-btn sm ghost" onClick={onClear}>
          Clear
        </button>
      </div>
      <div
        style={{
          fontFamily: "var(--read)",
          fontSize: 13,
          fontWeight: 700,
          color: "var(--ink)",
        }}
      >
        {queue.type === "stack"
          ? stack?.name ?? "(missing stack)"
          : skill?.displayName ?? "(missing skill)"}
      </div>
      {queue.type === "stack" && stack && (
        <div
          style={{
            fontFamily: "var(--read)",
            fontSize: 11,
            color: "var(--ink-soft)",
          }}
        >
          {stack.skillIds.length} member skill
          {stack.skillIds.length === 1 ? "" : "s"}: {stack.skillIds.join(", ")}
        </div>
      )}
      {queue.type === "skill" && skill?.description && (
        <div
          style={{
            fontFamily: "var(--read)",
            fontSize: 11,
            color: "var(--ink-soft)",
          }}
        >
          {skill.description}
        </div>
      )}
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
  defaultMode,
}: {
  mode: DeployMode;
  onChange: (m: DeployMode) => void;
  /** User's saved default. Drives the visual ordering of the segmented
   *  pill so the user's preferred mode sits on the left (primary
   *  position) regardless of which is currently selected for this
   *  deploy. Matches the spec: "default option always on left." */
  defaultMode: DeployMode;
}) {
  // Segmented pill: outer track has fully-rounded ends, the active option
  // gets its own fully-rounded fill that hugs the track's inner padding so
  // both ends of the highlight read as a clean pill (not chopped at the
  // midline). Inactive options stay transparent. Order = [default, other].
  const order: DeployMode[] =
    defaultMode === "copy" ? ["copy", "symlink"] : ["symlink", "copy"];
  return (
    <div
      role="radiogroup"
      aria-label="Deploy mode"
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        border: "1.5px solid var(--line)",
        borderRadius: 999,
        background: "var(--paper-2)",
      }}
    >
      {order.map((m) => (
        <ModeButton
          key={m}
          label={m === "symlink" ? "Symlink" : "Copy"}
          active={mode === m}
          onClick={() => onChange(m)}
        />
      ))}
    </div>
  );
}

function ModeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      style={{
        padding: "4px 14px",
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        fontFamily: "var(--read)",
        background: active ? "var(--accent)" : "transparent",
        color: active ? "var(--on-accent)" : "var(--ink-soft)",
        border: "none",
        borderRadius: 999,
        cursor: "pointer",
        transition: "background 0.15s",
      }}
    >
      {label}
    </button>
  );
}

interface ActiveDeploymentsLedgerProps {
  projects: TrackedProject[];
  stacks: SkillStack[];
  stackDeployments: import("../../electron/services/types").StackDeployment[];
  agents: AgentMeta[];
  onRemoveProject: (path: string) => void;
}

function ActiveDeploymentsLedger({
  projects,
  stacks,
  stackDeployments,
  agents,
  onRemoveProject,
}: ActiveDeploymentsLedgerProps) {
  const loadStackDeployments = useAppStore((s) => s.loadStackDeployments);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const setError = useAppStore((s) => s.setError);
  const openModal = useAppStore((s) => s.openModal);
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());

  const stacksById = useMemo(
    () => new Map(stacks.map((s) => [s.id, s] as const)),
    [stacks],
  );
  const agentLabel = useCallback(
    (id: string) => agents.find((a) => a.id === id)?.displayName ?? id,
    [agents],
  );

  // Group all deployments by project. Skill rows come from
  // SkillRecord.deployments; stack rows come from StackDeployment[].
  type Row =
    | {
        kind: "skill";
        projectPath: string;
        agentId: string;
        deployMode: DeployMode;
        skillName: string;
        deployedAt: string;
      }
    | {
        kind: "stack";
        projectPath: string;
        agentId: string;
        deployMode: DeployMode;
        stackId: string;
        timestamp: string;
        includedSkillIds: string[];
      };

  // Group all deployments by project. Skill rows come from
  // TrackedProject.skillNames (one row per skill in that project, tagged
  // with the project's primary agent/mode aggregate — Skill[] from
  // listSkills doesn't carry per-(skill, agent) deployments[] on the
  // wire today). Stack rows come from StackDeployment[] which is
  // per-(stack, project, agent).
  const rowsByProject = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const project of projects) {
      const list: Row[] = [];
      for (const name of project.skillNames) {
        list.push({
          kind: "skill",
          projectPath: project.path,
          agentId: project.agentIds[0] ?? "claude",
          deployMode: project.deployModes[0] ?? "copy",
          skillName: name,
          deployedAt: project.lastDeployedAt ?? "",
        });
      }
      for (const dep of stackDeployments) {
        if (dep.projectPath !== project.path) continue;
        list.push({
          kind: "stack",
          projectPath: dep.projectPath,
          agentId: dep.agentId,
          deployMode: dep.deployMode,
          stackId: dep.stackId,
          timestamp: dep.timestamp,
          includedSkillIds: [...dep.includedSkillIds],
        });
      }
      map.set(project.path, list);
    }
    // Surface stack deployments whose project isn't in the tracked-projects
    // list (e.g. stack-only paths). Add them under their own bucket.
    for (const dep of stackDeployments) {
      if (!map.has(dep.projectPath)) {
        map.set(dep.projectPath, [
          {
            kind: "stack",
            projectPath: dep.projectPath,
            agentId: dep.agentId,
            deployMode: dep.deployMode,
            stackId: dep.stackId,
            timestamp: dep.timestamp,
            includedSkillIds: [...dep.includedSkillIds],
          },
        ]);
      }
    }
    return map;
  }, [projects, stackDeployments]);

  const projectPaths = Array.from(rowsByProject.keys());

  const toggleExpanded = (key: string) => {
    setExpandedStacks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const removeStack = (
    stackId: string,
    projectPath: string,
    agentId: string,
  ) => {
    // Look up which members were deployed via this row + which are still
    // claimed by another deployed stack (safe to keep).
    const row = stackDeployments.find(
      (d) =>
        d.stackId === stackId &&
        d.projectPath === projectPath &&
        d.agentId === agentId,
    );
    const members = row?.includedSkillIds ?? [];
    const stillOwnedByOther = members.filter((m) =>
      stackDeployments.some(
        (d) =>
          !(d.stackId === stackId && d.agentId === agentId) &&
          d.projectPath === projectPath &&
          d.includedSkillIds.includes(m),
      ),
    );
    const toRemove = members.filter(
      (m) => !stillOwnedByOther.includes(m),
    );
    const bodyLines: string[] = [
      `Remove the ${stackId} stack deployment from ${tildify(projectPath)}?`,
      "",
      "Will delete the meta-skill SKILL.md from the project.",
    ];
    if (toRemove.length > 0) {
      bodyLines.push(
        "",
        `Will also remove ${toRemove.length} member file${toRemove.length === 1 ? "" : "s"} from the project:`,
      );
      for (const m of toRemove) bodyLines.push(`  · ${m}`);
    }
    if (stillOwnedByOther.length > 0) {
      bodyLines.push(
        "",
        `Keeping ${stillOwnedByOther.length} member${stillOwnedByOther.length === 1 ? "" : "s"} (still claimed by another deployed stack at this project):`,
      );
      for (const m of stillOwnedByOther) bodyLines.push(`  · ${m}`);
    }
    openModal({
      type: "confirm",
      title: `Remove ${stackId}?`,
      body: bodyLines.join("\n"),
      confirmLabel: "Remove",
      destructive: true,
      onConfirm: async () => {
        try {
          await window.api.removeStackDeployment(
            stackId,
            projectPath,
            agentId,
            true,
            { cascadeMembers: true },
          );
          await loadStackDeployments();
          await refreshSkills();
          await refreshProjects();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      },
    });
  };

  if (projectPaths.length === 0) {
    return (
      <div
        className="sk-box"
        style={{
          padding: 14,
          textAlign: "center",
          fontSize: 12,
          color: "var(--ink-faint)",
        }}
      >
        No active deployments yet. Pick something on the left, choose agents
        and projects, then Deploy.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="rail-section" style={{ padding: 0, fontSize: 11 }}>
        Active deployments · {projectPaths.length} project
        {projectPaths.length === 1 ? "" : "s"}
      </div>
      {projectPaths.map((path) => {
        const rows = rowsByProject.get(path) ?? [];
        return (
          <div
            key={path}
            className="sk-box"
            style={{ padding: 0, overflow: "hidden" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                background: "var(--paper-2)",
              }}
            >
              <div
                style={{
                  flex: 1,
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={path}
              >
                {tildify(path)}
              </div>
              <button
                className="sk-btn sm ghost"
                onClick={() =>
                  void window.api.openInFinder(path).catch(() => undefined)
                }
              >
                Open
              </button>
              <button
                className="sk-btn sm ghost"
                onClick={() => onRemoveProject(path)}
                style={{ color: "var(--warn)" }}
              >
                Remove project…
              </button>
            </div>
            {rows.length === 0 && (
              <div
                style={{
                  padding: "8px 12px",
                  fontSize: 11,
                  color: "var(--ink-faint)",
                }}
              >
                No deployments
              </div>
            )}
            {rows.map((row, i) => {
              const key =
                row.kind === "stack"
                  ? `stack:${row.stackId}:${row.agentId}`
                  : `skill:${row.skillName}:${row.agentId}`;
              const isLast = i === rows.length - 1;
              if (row.kind === "stack") {
                const stack = stacksById.get(row.stackId);
                const expanded = expandedStacks.has(`${row.projectPath}|${key}`);
                const drift =
                  stack !== undefined &&
                  (row.includedSkillIds.length !== stack.skillIds.length ||
                    row.includedSkillIds.some(
                      (id, idx) => id !== stack.skillIds[idx],
                    ));
                return (
                  <div
                    key={key}
                    style={{
                      borderBottom: isLast
                        ? "none"
                        : "1px dashed var(--line-soft)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 12px",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          toggleExpanded(`${row.projectPath}|${key}`)
                        }
                        style={{
                          width: 18,
                          height: 18,
                          padding: 0,
                          background: "transparent",
                          border: "none",
                          color: "var(--ink-soft)",
                          cursor: "pointer",
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                        }}
                        aria-label={expanded ? "Collapse" : "Expand"}
                      >
                        {expanded ? "▾" : "▸"}
                      </button>
                      <span
                        aria-hidden
                        style={{
                          color: "var(--accent)",
                          display: "inline-flex",
                        }}
                      >
                        {STACK_ICON_SMALL}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--read)",
                          fontSize: 12,
                          fontWeight: 600,
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {stack?.name ?? row.stackId}
                      </span>
                      <span className="sk-tag" style={{ fontSize: 9 }}>
                        {agentLabel(row.agentId)}
                      </span>
                      <span className="sk-tag" style={{ fontSize: 9 }}>
                        {row.deployMode}
                      </span>
                      {drift && (
                        <span
                          className="sk-tag"
                          style={{
                            fontSize: 9,
                            color: "var(--warn)",
                            borderColor: "var(--warn)",
                          }}
                          title="Stack composition has changed since this deployment. Re-deploy to refresh the meta-skill."
                        >
                          drift
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 10,
                          color: "var(--ink-faint)",
                          fontFamily: "var(--mono)",
                        }}
                      >
                        {relativeTime(row.timestamp)}
                      </span>
                      <button
                        className="sk-btn sm ghost"
                        onClick={() =>
                          removeStack(row.stackId, row.projectPath, row.agentId)
                        }
                        style={{ color: "var(--warn)" }}
                      >
                        Remove
                      </button>
                    </div>
                    {expanded && (
                      <div
                        style={{
                          padding: "4px 12px 8px 44px",
                          fontSize: 10,
                          color: "var(--ink-faint)",
                          fontFamily: "var(--mono)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 2,
                        }}
                      >
                        {row.includedSkillIds.length === 0 ? (
                          <span>(no skills)</span>
                        ) : (
                          row.includedSkillIds.map((id) => (
                            <span key={id}>· {id}</span>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              }
              return (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 12px 6px 36px",
                    borderBottom: isLast
                      ? "none"
                      : "1px dashed var(--line-soft)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--read)",
                      fontSize: 12,
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.skillName}
                  </span>
                  <span className="sk-tag" style={{ fontSize: 9 }}>
                    {agentLabel(row.agentId)}
                  </span>
                  <span className="sk-tag" style={{ fontSize: 9 }}>
                    {row.deployMode}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--ink-faint)",
                      fontFamily: "var(--mono)",
                    }}
                  >
                    {relativeTime(row.deployedAt)}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  fontSize: 13,
  fontFamily: "var(--read)",
  color: "var(--ink)",
  background: "var(--paper)",
  border: "1.5px solid var(--line)",
  borderRadius: 6,
  outline: "none",
  boxSizing: "border-box",
};

function HomeLibraryPrompt({
  stack,
  onDeploy,
}: {
  stack: SkillStack;
  onDeploy: () => Promise<void> | void;
}) {
  // After a successful click, hold a transient "deployed!" state for a
  // beat so the user gets feedback even though the underlying
  // inHomeLibrary flag flips immediately and would otherwise hide the
  // prompt. The state collapses to the "in library" rest state once the
  // store refresh lands.
  if (stack.inHomeLibrary === true) {
    return (
      <div
        className="sk-box"
        style={{
          padding: "8px 12px",
          background: "var(--paper-2)",
          borderColor: "var(--good)",
          fontSize: 12,
          fontFamily: "var(--read)",
          color: "var(--ink-soft)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ color: "var(--good)", fontWeight: 700 }}>✓</span>
        <span>
          <b>{stack.name}</b> is in your home library — discoverable from
          any project.
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void onDeploy()}
      className="sk-box"
      style={{
        padding: "8px 12px",
        background: "var(--paper-2)",
        borderColor: "var(--warn)",
        borderStyle: "dashed",
        fontSize: 12,
        fontFamily: "var(--read)",
        color: "var(--ink)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
      title="Promote this stack into your home library so it's invokable from any project"
    >
      <span style={{ color: "var(--warn)", fontSize: 14 }}>⚠</span>
      <span style={{ flex: 1 }}>
        <b>{stack.name}</b> isn't in your home library yet. Click to add
        it — recommended before deploying to projects.
      </span>
      <span
        className="sk-tag"
        style={{ fontSize: 10, color: "var(--accent)" }}
      >
        Add now →
      </span>
    </button>
  );
}
