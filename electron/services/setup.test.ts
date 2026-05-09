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
  compareSkillDirs,
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

  it("tags content-only folders as 'package' with marker reason", async () => {
    const root = join(dirname(CONFIG_PATH), "scan-package");
    // awesome-claude-code shape: scripts/ + data/, no SKILL.md.
    await fs.mkdir(join(root, "awesome-claude-code", "scripts"), {
      recursive: true,
    });
    await fs.mkdir(join(root, "awesome-claude-code", "data"), {
      recursive: true,
    });
    // get-shit-done shape: commands/ + agents/ + hooks/.
    await fs.mkdir(join(root, "get-shit-done", "commands"), {
      recursive: true,
    });
    await fs.mkdir(join(root, "get-shit-done", "agents"), {
      recursive: true,
    });
    await fs.mkdir(join(root, "get-shit-done", "hooks"), {
      recursive: true,
    });
    // n8n-mcp shape: package.json + CLAUDE.md.
    await fs.mkdir(join(root, "n8n-mcp"), { recursive: true });
    await fs.writeFile(join(root, "n8n-mcp", "package.json"), "{}");
    await fs.writeFile(join(root, "n8n-mcp", "CLAUDE.md"), "docs");
    // empty-junk shape: no markers at all → should NOT be picked up.
    await fs.mkdir(join(root, "empty-junk"), { recursive: true });
    await fs.writeFile(join(root, "empty-junk", "notes.txt"), "x");
    // skill-with-id: should land as skill not package.
    await fs.mkdir(join(root, "real-skill"), { recursive: true });
    await fs.writeFile(join(root, "real-skill", "SKILL.md"), "y");

    const result = await scanForExistingSkills(root);
    const byName = Object.fromEntries(result.map((r) => [r.name, r]));
    expect(Object.keys(byName).sort()).toEqual([
      "awesome-claude-code",
      "get-shit-done",
      "n8n-mcp",
      "real-skill",
    ]);
    expect(byName["real-skill"].kind).toBe("skill");
    expect(byName["awesome-claude-code"].kind).toBe("package");
    expect(byName["awesome-claude-code"].reason).toBe("scripts/, data/");
    expect(byName["get-shit-done"].kind).toBe("package");
    // hooks/ comes after agents/ in PACKAGE_DIR_MARKERS order, so
    // first 3 are commands/, agents/, hooks/.
    expect(byName["get-shit-done"].reason).toBe(
      "commands/, agents/, hooks/",
    );
    expect(byName["n8n-mcp"].kind).toBe("package");
    // n8n-mcp has no dir markers (only package.json + CLAUDE.md files).
    expect(byName["n8n-mcp"].reason).toBe("package.json, CLAUDE.md");
  });

  it("packages also surface when descended into via skills/ container", async () => {
    const root = join(dirname(CONFIG_PATH), "scan-package-via");
    await fs.mkdir(join(root, "skills", "awesome", "scripts"), {
      recursive: true,
    });
    const result = await scanForExistingSkills(root);
    expect(result.map((s) => s.name)).toEqual(["awesome"]);
    expect(result[0].kind).toBe("package");
    expect(result[0].viaContainer).toBe("skills");
  });

  it("detects symlinked dirs (the move+symlink-back agent dir state)", async () => {
    // Mirrors the on-disk shape after onboarding's symlink mode:
    // ~/.claude/skills/foo is a symlink to ~/.skill-stack/skills/foo.
    // Without the symlink-aware resolvesAsDir helper, the scanner
    // would skip these and report "no skills found" on re-run.
    const root = join(dirname(CONFIG_PATH), "scan-symlinks");
    const lib = join(root, "lib");
    const agent = join(root, "agent");
    await fs.mkdir(join(lib, "alpha"), { recursive: true });
    await fs.writeFile(join(lib, "alpha", "SKILL.md"), "a");
    await fs.mkdir(join(lib, "beta"), { recursive: true });
    await fs.writeFile(join(lib, "beta", "AGENTS.md"), "b");
    await fs.mkdir(agent, { recursive: true });
    await fs.symlink(join(lib, "alpha"), join(agent, "alpha"));
    await fs.symlink(join(lib, "beta"), join(agent, "beta"));
    // Broken symlink — should be ignored, not crash the scan.
    await fs.symlink(join(root, "ghost"), join(agent, "missing"));

    const result = await scanForExistingSkills(agent);
    expect(result.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
    expect(result[0].isSkill).toBe(true);
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

describe("compareSkillDirs", () => {
  it("returns 'missing' when one side doesn't exist", async () => {
    const root = join(dirname(CONFIG_PATH), "compare-missing");
    await fs.mkdir(root, { recursive: true });
    expect(
      await compareSkillDirs(join(root, "a"), join(root, "b")),
    ).toBe("missing");
  });

  it("returns 'identical' for byte-equal trees", async () => {
    const root = join(dirname(CONFIG_PATH), "compare-identical");
    for (const name of ["a", "b"]) {
      await fs.mkdir(join(root, name, "sub"), { recursive: true });
      await fs.writeFile(join(root, name, "SKILL.md"), "same\n");
      await fs.writeFile(join(root, name, "sub", "x.txt"), "hello");
    }
    expect(
      await compareSkillDirs(join(root, "a"), join(root, "b")),
    ).toBe("identical");
  });

  it("returns 'differs' for any content mismatch", async () => {
    const root = join(dirname(CONFIG_PATH), "compare-differs");
    await fs.mkdir(join(root, "a"), { recursive: true });
    await fs.writeFile(join(root, "a", "SKILL.md"), "one");
    await fs.mkdir(join(root, "b"), { recursive: true });
    await fs.writeFile(join(root, "b", "SKILL.md"), "two");
    expect(
      await compareSkillDirs(join(root, "a"), join(root, "b")),
    ).toBe("differs");
  });

  it("ignores .git/.DS_Store/node_modules in comparison", async () => {
    const root = join(dirname(CONFIG_PATH), "compare-skip");
    await fs.mkdir(join(root, "a", ".git"), { recursive: true });
    await fs.writeFile(join(root, "a", ".git", "HEAD"), "ref:");
    await fs.writeFile(join(root, "a", "SKILL.md"), "core");
    await fs.mkdir(join(root, "b"), { recursive: true });
    await fs.writeFile(join(root, "b", ".DS_Store"), "noise");
    await fs.writeFile(join(root, "b", "SKILL.md"), "core");
    expect(
      await compareSkillDirs(join(root, "a"), join(root, "b")),
    ).toBe("identical");
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

  it("move + identical: drops agent dir, leaves symlink to library", async () => {
    const tmpRoot = join(dirname(CONFIG_PATH), "setup-resolve-identical");
    const lib = join(tmpRoot, "skills");
    const agent = join(tmpRoot, "agent");
    await fs.mkdir(join(lib, "alpha"), { recursive: true });
    await fs.writeFile(join(lib, "alpha", "SKILL.md"), "same body");
    await fs.mkdir(join(agent, "alpha"), { recursive: true });
    await fs.writeFile(join(agent, "alpha", "SKILL.md"), "same body");

    const result = await completeSetup({
      libraryRoot: "custom",
      customPath: lib,
      primaryAgent: "claude",
      defaultDeployMode: "symlink",
      importSkills: [
        {
          name: "alpha",
          sourcePath: join(agent, "alpha"),
          mode: "move",
          resolution: "identical",
        },
      ],
    });
    expect(result.imported).toEqual(["alpha"]);
    expect(result.skipped).toEqual([]);
    // Agent path is now a symlink to lib/alpha.
    const agentStat = await fs.lstat(join(agent, "alpha"));
    expect(agentStat.isSymbolicLink()).toBe(true);
    expect(await fs.readlink(join(agent, "alpha"))).toBe(
      join(lib, "alpha"),
    );
  });

  it("move + keep-agent: overwrites library with agent version, symlinks back", async () => {
    const tmpRoot = join(dirname(CONFIG_PATH), "setup-resolve-keep-agent");
    const lib = join(tmpRoot, "skills");
    const agent = join(tmpRoot, "agent");
    await fs.mkdir(join(lib, "alpha"), { recursive: true });
    await fs.writeFile(join(lib, "alpha", "SKILL.md"), "old library");
    await fs.mkdir(join(agent, "alpha"), { recursive: true });
    await fs.writeFile(join(agent, "alpha", "SKILL.md"), "new agent");

    await completeSetup({
      libraryRoot: "custom",
      customPath: lib,
      primaryAgent: "claude",
      defaultDeployMode: "symlink",
      importSkills: [
        {
          name: "alpha",
          sourcePath: join(agent, "alpha"),
          mode: "move",
          resolution: "keep-agent",
        },
      ],
    });
    // Library now has the agent's version.
    expect(
      await fs.readFile(join(lib, "alpha", "SKILL.md"), "utf8"),
    ).toBe("new agent");
    // Agent path is now a symlink.
    expect((await fs.lstat(join(agent, "alpha"))).isSymbolicLink()).toBe(
      true,
    );
  });

  it("move + keep-library: drops agent, symlinks to (older) library copy", async () => {
    const tmpRoot = join(
      dirname(CONFIG_PATH),
      "setup-resolve-keep-library",
    );
    const lib = join(tmpRoot, "skills");
    const agent = join(tmpRoot, "agent");
    await fs.mkdir(join(lib, "alpha"), { recursive: true });
    await fs.writeFile(join(lib, "alpha", "SKILL.md"), "library wins");
    await fs.mkdir(join(agent, "alpha"), { recursive: true });
    await fs.writeFile(join(agent, "alpha", "SKILL.md"), "agent loses");

    await completeSetup({
      libraryRoot: "custom",
      customPath: lib,
      primaryAgent: "claude",
      defaultDeployMode: "symlink",
      importSkills: [
        {
          name: "alpha",
          sourcePath: join(agent, "alpha"),
          mode: "move",
          resolution: "keep-library",
        },
      ],
    });
    // Library untouched.
    expect(
      await fs.readFile(join(lib, "alpha", "SKILL.md"), "utf8"),
    ).toBe("library wins");
    // Agent now a symlink to library.
    expect((await fs.lstat(join(agent, "alpha"))).isSymbolicLink()).toBe(
      true,
    );
    // Reading via symlink returns library content.
    expect(
      await fs.readFile(join(agent, "alpha", "SKILL.md"), "utf8"),
    ).toBe("library wins");
  });

  it("skip resolution leaves both untouched", async () => {
    const tmpRoot = join(dirname(CONFIG_PATH), "setup-resolve-skip");
    const lib = join(tmpRoot, "skills");
    const agent = join(tmpRoot, "agent");
    await fs.mkdir(join(lib, "alpha"), { recursive: true });
    await fs.writeFile(join(lib, "alpha", "SKILL.md"), "library");
    await fs.mkdir(join(agent, "alpha"), { recursive: true });
    await fs.writeFile(join(agent, "alpha", "SKILL.md"), "agent");

    const result = await completeSetup({
      libraryRoot: "custom",
      customPath: lib,
      primaryAgent: "claude",
      defaultDeployMode: "symlink",
      importSkills: [
        {
          name: "alpha",
          sourcePath: join(agent, "alpha"),
          mode: "move",
          resolution: "skip",
        },
      ],
    });
    expect(result.imported).toEqual([]);
    expect(result.skipped).toEqual([
      { name: "alpha", reason: "skipped by user" },
    ]);
    // Both still regular dirs with original contents.
    expect(
      await fs.readFile(join(lib, "alpha", "SKILL.md"), "utf8"),
    ).toBe("library");
    expect(
      await fs.readFile(join(agent, "alpha", "SKILL.md"), "utf8"),
    ).toBe("agent");
    expect((await fs.lstat(join(agent, "alpha"))).isDirectory()).toBe(
      true,
    );
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
      {
        name: "alpha",
        reason: expect.stringMatching(/Library entry exists/),
      },
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
