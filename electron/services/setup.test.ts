import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./paths", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const root = path.join(
    os.tmpdir(),
    `skill-manager-setup-test-${process.pid}-${Date.now()}`,
  );
  return {
    CONFIG_PATH: path.join(root, ".claude", "skill-manager.json"),
    getClaudeDir: () => path.join(root, ".claude"),
    getLibraryPath: () => path.join(root, ".claude", "skills"),
    getHistoryPath: () => path.join(root, ".claude", "skills-history"),
    configurePaths: vi.fn(),
    resetPathsForTest: () => undefined,
  };
});

import { CONFIG_PATH } from "./paths";
import { loadConfig, saveConfig } from "./config";
import {
  completeSetup,
  resolveLibraryRoot,
  scanForExistingSkills,
  validateLibraryPath,
} from "./setup";
import { DEFAULT_SETTINGS, DEFAULT_SETUP } from "./types";
import { dirname } from "node:path";

beforeEach(async () => {
  await fs.mkdir(dirname(CONFIG_PATH), { recursive: true });
});

afterEach(async () => {
  await fs.rm(dirname(CONFIG_PATH), { recursive: true, force: true });
});

describe("resolveLibraryRoot", () => {
  it("claude → ~/.claude/skills + ~/.claude/skills-history", () => {
    const r = resolveLibraryRoot("claude", null);
    expect(r.libraryPath).toBe(join(homedir(), ".claude", "skills"));
    expect(r.historyPath).toBe(join(homedir(), ".claude", "skills-history"));
  });

  it("centralized → ~/.skill-stack/skills + ~/.skill-stack/skills-history", () => {
    const r = resolveLibraryRoot("centralized", null);
    expect(r.libraryPath).toBe(join(homedir(), ".skill-stack", "skills"));
    expect(r.historyPath).toBe(
      join(homedir(), ".skill-stack", "skills-history"),
    );
  });

  it("custom resolves history beside the custom library path", () => {
    const r = resolveLibraryRoot("custom", "/tmp/my-skills");
    expect(r.libraryPath).toBe("/tmp/my-skills");
    expect(r.historyPath).toBe("/tmp/my-skills-history");
  });

  it("custom rejects relative paths", () => {
    expect(() => resolveLibraryRoot("custom", "relative/path")).toThrow(
      /absolute/,
    );
  });

  it("custom rejects empty path", () => {
    expect(() => resolveLibraryRoot("custom", null)).toThrow(/customPath/);
  });
});

describe("validateLibraryPath", () => {
  it("rejects empty input", async () => {
    expect(await validateLibraryPath("")).toMatch(/required/i);
  });

  it("rejects relative paths", async () => {
    expect(await validateLibraryPath("relative/skills")).toMatch(/absolute/);
  });

  it("rejects forbidden roots", async () => {
    expect(await validateLibraryPath("/etc")).toMatch(/Refusing/);
    expect(await validateLibraryPath("/")).toMatch(/Refusing/);
  });

  it("accepts a deep path under an existing ancestor (mkdir -p will create it)", async () => {
    // `/Users` exists on macOS even if every level below it doesn't.
    // completeSetup uses fs.mkdir(recursive: true) to fill in the rest.
    expect(
      await validateLibraryPath("/Users/__nope__/deep/skills"),
    ).toBeNull();
  });

  it("accepts a path whose parent exists", async () => {
    expect(await validateLibraryPath(homedir())).toBeNull();
  });
});

describe("scanForExistingSkills", () => {
  it("returns nothing for a non-existent directory", async () => {
    const result = await scanForExistingSkills("/this/should/not/exist");
    expect(result).toEqual([]);
  });

  it("identifies skill-shaped subdirectories and skips non-skills", async () => {
    const root = join(dirname(CONFIG_PATH), "scan-fixture");
    await fs.mkdir(join(root, "alpha"), { recursive: true });
    await fs.writeFile(
      join(root, "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: alpha is a skill that triggers when the user asks about alpha.\n---\n",
    );
    await fs.mkdir(join(root, "not-a-skill"), { recursive: true });
    await fs.writeFile(join(root, "not-a-skill", "README.md"), "nope");
    await fs.mkdir(join(root, ".hidden"), { recursive: true });
    const result = await scanForExistingSkills(root);
    expect(result.map((s) => s.name)).toEqual(["alpha"]);
    expect(result[0].isSkill).toBe(true);
  });

  it("hard-excludes plugins/skills-history/agents/etc. by name", async () => {
    const root = join(dirname(CONFIG_PATH), "scan-excludes");
    // Make every excluded name look skill-shaped — the exclusion should
    // still drop them.
    for (const name of [
      "plugins",
      "skills-history",
      "agents",
      "commands",
      "hooks",
      "marketplaces",
    ]) {
      await fs.mkdir(join(root, name, "fake-skill"), { recursive: true });
      await fs.writeFile(join(root, name, "fake-skill", "SKILL.md"), "x");
    }
    // One real skill that should survive.
    await fs.mkdir(join(root, "kept"), { recursive: true });
    await fs.writeFile(join(root, "kept", "SKILL.md"), "y");
    const result = await scanForExistingSkills(root);
    expect(result.map((s) => s.name)).toEqual(["kept"]);
  });

  it("descends into a 'skills/' container and lists its children", async () => {
    // Mirrors the broken on-disk shape we hit on first-run: the user
    // pointed at ~/.skill-stack/skills/ but a buggy migration left the
    // real library at ~/.skill-stack/skills/skills/.
    const root = join(dirname(CONFIG_PATH), "scan-container");
    await fs.mkdir(join(root, "skills", "alpha"), { recursive: true });
    await fs.writeFile(join(root, "skills", "alpha", "SKILL.md"), "a");
    await fs.mkdir(join(root, "skills", "beta"), { recursive: true });
    await fs.writeFile(join(root, "skills", "beta", "AGENTS.md"), "b");
    await fs.mkdir(join(root, "skills-history"), { recursive: true });
    await fs.mkdir(join(root, "plugins", "fake"), { recursive: true });
    await fs.writeFile(join(root, "plugins", "fake", "SKILL.md"), "p");

    const result = await scanForExistingSkills(root);
    expect(result.map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(result[0].viaContainer).toBe("skills");
    expect(result[1].viaContainer).toBe("skills");
  });

  it("keeps a multi-skill bundle whole (no descend) when not a container name", async () => {
    // context7-style: a folder with nested skills that is NOT named
    // skills/library — should be one bundle entry, NOT exploded.
    const root = join(dirname(CONFIG_PATH), "scan-bundle");
    await fs.mkdir(join(root, "context7", "skill-a"), { recursive: true });
    await fs.writeFile(
      join(root, "context7", "skill-a", "SKILL.md"),
      "x",
    );
    await fs.mkdir(join(root, "context7", "skill-b"), { recursive: true });
    await fs.writeFile(
      join(root, "context7", "skill-b", "SKILL.md"),
      "y",
    );

    const result = await scanForExistingSkills(root);
    expect(result.map((s) => s.name)).toEqual(["context7"]);
    expect(result[0].isSkill).toBe(false);
    expect(result[0].isBundle).toBe(true);
    expect(result[0].nestedCount).toBe(2);
    expect(result[0].viaContainer).toBeUndefined();
  });

  it("dedupes by name when same skill appears at top level and inside container", async () => {
    const root = join(dirname(CONFIG_PATH), "scan-dedupe");
    await fs.mkdir(join(root, "alpha"), { recursive: true });
    await fs.writeFile(join(root, "alpha", "SKILL.md"), "top");
    await fs.mkdir(join(root, "skills", "alpha"), { recursive: true });
    await fs.writeFile(join(root, "skills", "alpha", "SKILL.md"), "nested");
    const result = await scanForExistingSkills(root);
    expect(result.map((s) => s.name)).toEqual(["alpha"]);
  });
});

describe("completeSetup", () => {
  beforeEach(async () => {
    // Seed an empty config so loadConfig/saveConfig have something to read.
    await saveConfig({
      last_project: "",
      skills: {},
      settings: DEFAULT_SETTINGS,
      stacks: [],
      stackDeployments: [],
      setup: DEFAULT_SETUP,
    });
  });

  it("creates the library + history dirs and persists setup", async () => {
    const tmpRoot = join(dirname(CONFIG_PATH), "setup-target");
    const libraryPath = join(tmpRoot, "skills");
    await fs.mkdir(tmpRoot, { recursive: true });

    const result = await completeSetup({
      libraryRoot: "custom",
      customPath: libraryPath,
      primaryAgent: "claude",
      defaultDeployMode: "symlink",
      importSkills: [],
    });

    expect(result.setup.completed).toBe(true);
    expect(result.setup.libraryPath).toBe(libraryPath);
    expect(result.setup.primaryAgent).toBe("claude");

    // Library and history both exist on disk.
    const libStat = await fs.stat(libraryPath);
    expect(libStat.isDirectory()).toBe(true);
    const histStat = await fs.stat(result.setup.historyPath);
    expect(histStat.isDirectory()).toBe(true);

    // Config persisted.
    const config = await loadConfig();
    expect(config.setup.completed).toBe(true);
    expect(config.setup.libraryPath).toBe(libraryPath);
    expect(config.settings.default_deploy_mode).toBe("symlink");
  });

  it("move mode: relocates source and leaves a symlink pointing back", async () => {
    const tmpRoot = join(dirname(CONFIG_PATH), "setup-move");
    const libraryPath = join(tmpRoot, "skills");
    const agentDir = join(tmpRoot, "agent-skills");
    await fs.mkdir(libraryPath, { recursive: true });
    await fs.mkdir(join(agentDir, "alpha"), { recursive: true });
    await fs.writeFile(join(agentDir, "alpha", "SKILL.md"), "alpha body");

    const result = await completeSetup({
      libraryRoot: "custom",
      customPath: libraryPath,
      primaryAgent: "claude",
      defaultDeployMode: "symlink",
      importSkills: [
        {
          name: "alpha",
          sourcePath: join(agentDir, "alpha"),
          mode: "move",
        },
      ],
    });

    expect(result.imported).toEqual(["alpha"]);
    expect(result.skipped).toEqual([]);
    // File now lives in the library.
    expect(
      await fs.readFile(join(libraryPath, "alpha", "SKILL.md"), "utf8"),
    ).toBe("alpha body");
    // Original agent path is now a symlink pointing into the library.
    const linkStat = await fs.lstat(join(agentDir, "alpha"));
    expect(linkStat.isSymbolicLink()).toBe(true);
    expect(await fs.readlink(join(agentDir, "alpha"))).toBe(
      join(libraryPath, "alpha"),
    );
    // Reading via the symlink still works.
    expect(
      await fs.readFile(join(agentDir, "alpha", "SKILL.md"), "utf8"),
    ).toBe("alpha body");
  });

  it("move mode: re-running onboarding on already-symlinked source is a no-op", async () => {
    const tmpRoot = join(dirname(CONFIG_PATH), "setup-move-rerun");
    const libraryPath = join(tmpRoot, "skills");
    const agentDir = join(tmpRoot, "agent-skills");
    await fs.mkdir(join(libraryPath, "alpha"), { recursive: true });
    await fs.writeFile(
      join(libraryPath, "alpha", "SKILL.md"),
      "library copy",
    );
    await fs.mkdir(agentDir, { recursive: true });
    await fs.symlink(join(libraryPath, "alpha"), join(agentDir, "alpha"));

    const result = await completeSetup({
      libraryRoot: "custom",
      customPath: libraryPath,
      primaryAgent: "claude",
      defaultDeployMode: "symlink",
      importSkills: [
        {
          name: "alpha",
          sourcePath: join(agentDir, "alpha"),
          mode: "move",
        },
      ],
    });
    expect(result.imported).toEqual(["alpha"]);
    expect(result.skipped).toEqual([]);
    // Library content untouched.
    expect(
      await fs.readFile(join(libraryPath, "alpha", "SKILL.md"), "utf8"),
    ).toBe("library copy");
  });

  it("imports selected skills and skips name conflicts", async () => {
    const tmpRoot = join(dirname(CONFIG_PATH), "setup-import");
    const libraryPath = join(tmpRoot, "skills");
    const sourceA = join(tmpRoot, "src-alpha");
    const sourceB = join(tmpRoot, "src-beta");
    await fs.mkdir(libraryPath, { recursive: true });
    await fs.mkdir(sourceA, { recursive: true });
    await fs.writeFile(join(sourceA, "SKILL.md"), "alpha body");
    await fs.mkdir(sourceB, { recursive: true });
    await fs.writeFile(join(sourceB, "SKILL.md"), "beta body");
    // Pre-stage alpha so it'll conflict and be skipped.
    await fs.mkdir(join(libraryPath, "alpha"), { recursive: true });
    await fs.writeFile(
      join(libraryPath, "alpha", "SKILL.md"),
      "preexisting alpha",
    );

    const result = await completeSetup({
      libraryRoot: "custom",
      customPath: libraryPath,
      primaryAgent: "claude",
      defaultDeployMode: "copy",
      importSkills: [
        { name: "alpha", sourcePath: sourceA },
        { name: "beta", sourcePath: sourceB },
      ],
    });

    expect(result.imported).toEqual(["beta"]);
    expect(result.skipped).toEqual([
      { name: "alpha", reason: expect.stringMatching(/Already exists/) },
    ]);
    // alpha was NOT overwritten.
    expect(
      await fs.readFile(join(libraryPath, "alpha", "SKILL.md"), "utf8"),
    ).toBe("preexisting alpha");
    // beta was imported.
    expect(
      await fs.readFile(join(libraryPath, "beta", "SKILL.md"), "utf8"),
    ).toBe("beta body");
  });
});
