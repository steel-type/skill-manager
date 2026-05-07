// Deploy view — list of every project where skills have been deployed.
// Add new projects via the native folder picker; remove via RemoveProjectFlow.

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../state/store";
import type { TrackedProject } from "../../electron/services/types";

interface AgentMeta {
  id: string;
  displayName: string;
  supportsSymlinks: boolean;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  // See CommandPalette.formatRelative — append Z so timestamps without a
  // timezone marker are parsed as UTC, not local.
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

export function DeployView() {
  const projects = useAppStore((s) => s.projects);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const openModal = useAppStore((s) => s.openModal);
  const [pendingPath, setPendingPath] = useState("");
  const [agents, setAgents] = useState<AgentMeta[]>([]);

  useEffect(() => {
    refreshProjects();
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
  }, [refreshProjects]);

  const agentLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.displayName);
    return map;
  }, [agents]);

  const handlePick = async () => {
    const picked = await window.api.pickFolder();
    if (picked) setPendingPath(picked);
  };

  // Adding a project here just records intent — actual tracking begins when
  // the user deploys a skill into it. So this UI lets the user "see" projects
  // they want to track, but only deploys create permanent entries.
  // For Stage 3 simplicity, "Add project" picks a folder then opens it in
  // Finder; the user deploys from the Library tab.
  const handleAdd = async () => {
    const target = pendingPath.trim();
    if (!target) return;
    await window.api.setLastProject(target);
    setActiveTab("library");
    setPendingPath("");
  };

  return (
    <div
      style={{
        flex: 1,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        overflow: "hidden",
      }}
    >
      <div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Tracked projects</div>
        <div className="hand" style={{ color: "var(--ink-soft)", fontSize: 14 }}>
          add or remove projects, manage their{" "}
          <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
            .claude/skills/
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          className="sk-input"
          style={{
            flex: 1,
            fontFamily: "var(--mono)",
            fontSize: 12,
          }}
          placeholder="~/code/new-project (or paste a path)"
          value={pendingPath}
          onChange={(e) => setPendingPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
        />
        <button className="sk-btn" onClick={handlePick}>
          Browse…
        </button>
        <button
          className="sk-btn primary"
          disabled={!pendingPath.trim()}
          onClick={handleAdd}
        >
          Set as active
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 4,
        }}
      >
        <div className="rail-section" style={{ padding: 0 }}>
          Tracked · {projects.length}
        </div>
        <div
          className="hand"
          style={{
            color: "var(--ink-faint)",
            fontSize: 12,
          }}
        >
          deploy a skill from the Library tab to track a new project
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {projects.length === 0 && (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              color: "var(--ink-faint)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            No projects tracked yet.
            <br />
            Deploy a skill from the Library tab to start tracking a project.
          </div>
        )}
        {projects.map((p) => (
          <ProjectRow
            key={p.path}
            project={p}
            agentLabels={agentLabels}
            onOpen={() => window.api.openInFinder(p.path)}
            onRemove={() =>
              openModal({ type: "removeProject", path: p.path })
            }
          />
        ))}
      </div>
    </div>
  );
}

function ProjectRow({
  project,
  agentLabels,
  onOpen,
  onRemove,
}: {
  project: TrackedProject;
  agentLabels: Map<string, string>;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="sk-box"
      style={{
        padding: 10,
        marginBottom: 8,
        background: project.exists ? "var(--paper)" : "var(--paper-2)",
        opacity: project.exists ? 1 : 0.7,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14 }}>📁</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={project.path}
          >
            {project.path.replace(/^\/Users\/[^/]+/, "~")}
            {!project.exists && (
              <span
                style={{
                  marginLeft: 6,
                  color: "var(--warn)",
                  fontFamily: "var(--read)",
                }}
              >
                (missing)
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "var(--ink-faint)",
            }}
          >
            {project.skillCount} skill{project.skillCount === 1 ? "" : "s"} ·
            updated {relativeTime(project.lastDeployedAt)}
            {project.skillCount > 0 &&
              ` · ${project.skillNames.slice(0, 3).join(", ")}${project.skillCount > 3 ? "…" : ""}`}
          </div>
          {(project.agentIds.length > 0 ||
            project.deployModes.length > 0) && (
            <div
              style={{
                marginTop: 4,
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
              }}
            >
              {project.agentIds.map((id) => (
                <span key={id} className="sk-tag" style={{ fontSize: 9 }}>
                  {agentLabels.get(id) ?? id}
                </span>
              ))}
              {project.deployModes.includes("symlink") && (
                <span
                  className="sk-tag"
                  style={{ fontSize: 9 }}
                  title="this project has at least one symlink deployment"
                >
                  ↗ symlink
                </span>
              )}
            </div>
          )}
        </div>
        <button
          className="sk-btn sm ghost"
          onClick={onOpen}
          disabled={!project.exists}
        >
          Open
        </button>
        <button
          className="sk-btn sm ghost"
          onClick={onRemove}
          style={{ color: "var(--warn)" }}
        >
          Remove…
        </button>
      </div>
    </div>
  );
}
