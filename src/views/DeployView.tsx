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
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(
    new Set(["claude"]),
  );
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(
    new Set(),
  );
  const [pendingProjectPath, setPendingProjectPath] = useState("");
  const [deployMode, setDeployMode] = useState<DeployMode>(
    settings.default_deploy_mode,
  );
  const [picker, setPicker] = useState("");
  const [running, setRunning] = useState(false);

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
    const target = pendingProjectPath.trim();
    if (!target) {
      const picked = await window.api.pickFolder();
      if (!picked) return;
      setPendingProjectPath(picked);
      setSelectedProjects((prev) => new Set(prev).add(picked));
      return;
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
                text: `${deployQueue.id} → ${tildify(projectPath)} (${r.deployMode}, ${agentId})`,
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
                text: `stack ${deployQueue.id} → ${tildify(projectPath)} (${r.deployMode}, ${agentId}, ${r.deployed.length}/${r.deployed.length + r.failed.length} skills)`,
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
              text: `${deployQueue.id} → ${tildify(projectPath)} (${agentId}): ${
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
              {agents.map((a) => {
                const checked = selectedAgents.has(a.id);
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
                        }}
                      >
                        {a.displayName}
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
                  </label>
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
        <ModeToggle mode={deployMode} onChange={setDeployMode} />
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
}: {
  mode: DeployMode;
  onChange: (m: DeployMode) => void;
}) {
  // Segmented pill: outer track has fully-rounded ends, the active option
  // gets its own fully-rounded fill that hugs the track's inner padding so
  // both ends of the highlight read as a clean pill (not chopped at the
  // midline). Inactive options stay transparent.
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
      <ModeButton
        label="Symlink"
        active={mode === "symlink"}
        onClick={() => onChange("symlink")}
      />
      <ModeButton
        label="Copy"
        active={mode === "copy"}
        onClick={() => onChange("copy")}
      />
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
    openModal({
      type: "confirm",
      title: `Remove ${stackId}?`,
      body: `Remove the ${stackId} stack deployment from ${tildify(projectPath)}?\n\nThe meta-skill SKILL.md will be deleted from the project; member skill files stay on disk.`,
      confirmLabel: "Remove",
      destructive: true,
      onConfirm: async () => {
        try {
          await window.api.removeStackDeployment(
            stackId,
            projectPath,
            agentId,
            true,
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
                          <span>(no members)</span>
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
