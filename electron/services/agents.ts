import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentDefinition {
  id: string;
  displayName: string;
  /** Path template for the user-global skill location, or null if the agent
   *  has no global concept. `{name}` is the skill directory name. */
  globalSkillPath: string | null;
  /** Path template for the per-project skill location. `{name}` is the skill
   *  directory name (or, for cursor, the .mdc filename). */
  projectSkillPath: string;
  /** Filename of the entry document inside the skill directory. `{name}` is
   *  available for agents that name the entry file after the skill (cursor). */
  entryFile: string;
  supportsSymlinks: boolean;
  /** Single-file alternative location an agent supports as a fallback to
   *  per-skill directories (e.g. `AGENTS.md`, `.cursorrules`). null if none. */
  singleFileAlternative: string | null;
  /** Optional UI hint about format differences for this agent. */
  formatNotes: string | null;
}

export const AGENTS: Record<string, AgentDefinition> = {
  claude: {
    id: "claude",
    displayName: "Claude Code",
    globalSkillPath: "~/.claude/skills/{name}/",
    projectSkillPath: ".claude/skills/{name}/",
    entryFile: "SKILL.md",
    supportsSymlinks: true,
    singleFileAlternative: "CLAUDE.md",
    formatNotes: null,
  },
  codex: {
    id: "codex",
    displayName: "OpenAI Codex",
    globalSkillPath: "~/.codex/skills/{name}/",
    projectSkillPath: ".codex/skills/{name}/",
    entryFile: "SKILL.md",
    supportsSymlinks: true,
    singleFileAlternative: "AGENTS.md",
    formatNotes: null,
  },
  gemini: {
    id: "gemini",
    displayName: "Gemini CLI",
    globalSkillPath: "~/.gemini/skills/{name}/",
    projectSkillPath: ".gemini/skills/{name}/",
    entryFile: "SKILL.md",
    supportsSymlinks: true,
    singleFileAlternative: "GEMINI.md",
    formatNotes: null,
  },
  cursor: {
    id: "cursor",
    displayName: "Cursor",
    globalSkillPath: null,
    projectSkillPath: ".cursor/rules/",
    entryFile: "{name}.mdc",
    supportsSymlinks: true,
    singleFileAlternative: ".cursorrules",
    formatNotes:
      "Cursor uses .mdc files in .cursor/rules/ rather than a per-skill directory.",
  },
  continue: {
    id: "continue",
    displayName: "Continue.dev",
    globalSkillPath: "~/.continue/skills/{name}/",
    projectSkillPath: ".continue/skills/{name}/",
    entryFile: "SKILL.md",
    supportsSymlinks: true,
    singleFileAlternative: null,
    formatNotes: null,
  },
  cline: {
    id: "cline",
    displayName: "Cline",
    globalSkillPath: null,
    projectSkillPath: ".cline/skills/{name}/",
    entryFile: "SKILL.md",
    supportsSymlinks: true,
    singleFileAlternative: ".clinerules",
    formatNotes: null,
  },
};

export function getSupportedAgents(): AgentDefinition[] {
  return Object.values(AGENTS);
}

export function getAgentById(id: string): AgentDefinition | undefined {
  return AGENTS[id];
}

/** Expand `~` to the user's home dir and substitute `{name}` placeholders. */
function expand(template: string, skillName: string): string {
  let path = template.replace(/\{name\}/g, skillName);
  if (path.startsWith("~/")) {
    path = join(homedir(), path.slice(2));
  } else if (path === "~") {
    path = homedir();
  }
  // Strip any trailing separator so callers can build paths predictably.
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

export interface ResolvedAgentPaths {
  globalPath: string | null;
  projectPath: string | null;
  entryFile: string;
}

/**
 * Resolve an agent's templated paths to concrete filesystem paths for a given
 * skill. `projectPath` returns null when no `projectPath` argument was given.
 * `entryFile` is the filename of the skill's entry document inside the
 * resolved directory.
 */
export function resolveAgentPaths(
  agentId: string,
  skillName: string,
  projectPath?: string,
): ResolvedAgentPaths {
  const agent = AGENTS[agentId];
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);

  const globalPath = agent.globalSkillPath
    ? expand(agent.globalSkillPath, skillName)
    : null;

  let projectResolved: string | null = null;
  if (projectPath) {
    const relative = expand(agent.projectSkillPath, skillName);
    projectResolved = join(projectPath, relative);
  }

  const entryFile = agent.entryFile.replace(/\{name\}/g, skillName);

  return {
    globalPath,
    projectPath: projectResolved,
    entryFile,
  };
}
