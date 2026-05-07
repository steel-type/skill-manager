import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  AGENTS,
  getAgentById,
  getSupportedAgents,
  resolveAgentPaths,
} from "./agents";

describe("AGENTS map", () => {
  it("includes all six expected agents", () => {
    expect(Object.keys(AGENTS).sort()).toEqual(
      ["claude", "cline", "codex", "continue", "cursor", "gemini"].sort(),
    );
  });

  it("every agent has a non-empty displayName and projectSkillPath", () => {
    for (const agent of Object.values(AGENTS)) {
      expect(agent.displayName.length).toBeGreaterThan(0);
      expect(agent.projectSkillPath.length).toBeGreaterThan(0);
    }
  });
});

describe("getSupportedAgents", () => {
  it("returns all six agents", () => {
    expect(getSupportedAgents()).toHaveLength(6);
  });

  it("returned agents share identity with AGENTS map", () => {
    for (const agent of getSupportedAgents()) {
      expect(AGENTS[agent.id]).toBe(agent);
    }
  });
});

describe("getAgentById", () => {
  it("returns the matching agent for a valid id", () => {
    expect(getAgentById("claude")?.displayName).toBe("Claude Code");
    expect(getAgentById("cursor")?.displayName).toBe("Cursor");
  });

  it("returns undefined for an unknown id", () => {
    expect(getAgentById("does-not-exist")).toBeUndefined();
    expect(getAgentById("")).toBeUndefined();
  });
});

describe("resolveAgentPaths", () => {
  it("expands {name} for claude global and project paths", () => {
    const result = resolveAgentPaths("claude", "my-skill", "/tmp/proj");
    expect(result.globalPath).toBe(`${homedir()}/.claude/skills/my-skill`);
    expect(result.projectPath).toBe("/tmp/proj/.claude/skills/my-skill");
    expect(result.entryFile).toBe("SKILL.md");
  });

  it("expands ~ to the actual home directory", () => {
    const result = resolveAgentPaths("codex", "alpha");
    expect(result.globalPath).toContain(homedir());
    expect(result.globalPath?.startsWith("~")).toBe(false);
  });

  it("uses {name}.mdc as the entry file for cursor", () => {
    const result = resolveAgentPaths("cursor", "my-rule", "/tmp/proj");
    expect(result.entryFile).toBe("my-rule.mdc");
    expect(result.projectPath).toBe("/tmp/proj/.cursor/rules");
  });

  it("returns null globalPath for agents with no global location", () => {
    expect(resolveAgentPaths("cursor", "x", "/tmp/p").globalPath).toBeNull();
    expect(resolveAgentPaths("cline", "x", "/tmp/p").globalPath).toBeNull();
  });

  it("returns null projectPath when no projectPath arg is given", () => {
    expect(resolveAgentPaths("claude", "x").projectPath).toBeNull();
  });

  it("substitutes {name} in entryFile for non-cursor agents (no-op)", () => {
    expect(resolveAgentPaths("gemini", "anything").entryFile).toBe("SKILL.md");
  });

  it("throws for an unknown agent id", () => {
    expect(() => resolveAgentPaths("nope", "x", "/p")).toThrow(/Unknown agent/);
  });
});
