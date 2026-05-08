import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./paths", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const root = path.join(
    os.tmpdir(),
    `skill-manager-migration-test-${process.pid}-${Date.now()}`,
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
import { planMigration, runMigration } from "./migration";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SETUP,
  type Deployment,
  type SkillManagerConfig,
} from "./types";

async function makeTmp(prefix: string): Promise<string> {
  const p = join(
    tmpdir(),
    `${prefix}-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(p, { recursive: true });
  return p;
}

async function plantSkill(library: string, name: string, body = "body"): Promise<void> {
  await fs.mkdir(join(library, name), { recursive: true });
  await fs.writeFile(join(library, name, "SKILL.md"), body);
}

beforeEach(async () => {
  await fs.mkdir(dirname(CONFIG_PATH), { recursive: true });
});

afterEach(async () => {
  await fs.rm(dirname(CONFIG_PATH), { recursive: true, force: true });
});

describe("planMigration", () => {
  it("lists every top-level entry with size and detects conflicts", async () => {
    const from = await makeTmp("mig-from");
    const to = await makeTmp("mig-to");
    try {
      await plantSkill(from, "alpha", "alpha body");
      await plantSkill(from, "beta", "beta body");
      // Pre-stage alpha at the destination → conflict.
      await plantSkill(to, "alpha", "preexisting");

      // Seed an empty config so loadConfig has something to read.
      await saveConfig({
        last_project: "",
        skills: {},
        settings: DEFAULT_SETTINGS,
        stacks: [],
        stackDeployments: [],
        setup: DEFAULT_SETUP,
      });

      const plan = await planMigration({
        fromLibrary: from,
        toLibrary: to,
        moveHistory: false,
      });
      expect(plan.entries.map((e) => e.name).sort()).toEqual(["alpha", "beta"]);
      expect(plan.conflicts).toEqual(["alpha"]);
      expect(plan.entries.find((e) => e.name === "alpha")?.sizeBytes).toBeGreaterThan(0);
      expect(plan.toHistory).toBeNull();
    } finally {
      await fs.rm(from, { recursive: true, force: true });
      await fs.rm(to, { recursive: true, force: true });
    }
  });

  it("emits one symlink rewrite per symlink deployment", async () => {
    const from = await makeTmp("mig-from-syms");
    const to = await makeTmp("mig-to-syms");
    try {
      await plantSkill(from, "alpha");
      const project = await makeTmp("mig-project");
      const symlinkDep: Deployment = {
        projectPath: project,
        agentId: "claude",
        deployMode: "symlink",
        deployedAt: "2026-01-01T00:00:00Z",
      };
      const copyDep: Deployment = {
        ...symlinkDep,
        agentId: "codex",
        deployMode: "copy",
      };
      const config: SkillManagerConfig = {
        last_project: "",
        skills: {
          alpha: {
            url: null,
            commit: null,
            installed_at: "2026-01-01T00:00:00Z",
            updated_at: null,
            projects: [project],
            deployments: [symlinkDep, copyDep],
          },
        },
        settings: DEFAULT_SETTINGS,
        stacks: [],
        stackDeployments: [],
        setup: DEFAULT_SETUP,
      };
      await saveConfig(config);

      const plan = await planMigration({
        fromLibrary: from,
        toLibrary: to,
        moveHistory: false,
      });
      // Only the symlink deployment is in the rewrite list.
      expect(plan.symlinkRewrites).toHaveLength(1);
      expect(plan.symlinkRewrites[0].entryName).toBe("alpha");
      expect(plan.symlinkRewrites[0].agentId).toBe("claude");
      expect(plan.symlinkRewrites[0].oldTarget).toBe(join(from, "alpha"));
      expect(plan.symlinkRewrites[0].newTarget).toBe(join(to, "alpha"));
      await fs.rm(project, { recursive: true, force: true });
    } finally {
      await fs.rm(from, { recursive: true, force: true });
      await fs.rm(to, { recursive: true, force: true });
    }
  });
});

describe("runMigration", () => {
  it("moves skills, leaves source empty, target populated", async () => {
    const from = await makeTmp("mig-run-from");
    const to = await makeTmp("mig-run-to");
    try {
      await plantSkill(from, "alpha", "alpha body");
      await plantSkill(from, "beta", "beta body");
      await saveConfig({
        last_project: "",
        skills: {},
        settings: DEFAULT_SETTINGS,
        stacks: [],
        stackDeployments: [],
        setup: { ...DEFAULT_SETUP, completed: true, libraryPath: from, historyPath: from + "-history" },
      });
      const plan = await planMigration({
        fromLibrary: from,
        toLibrary: to,
        moveHistory: false,
      });
      const result = await runMigration(plan);
      expect(result.movedEntries.sort()).toEqual(["alpha", "beta"]);
      expect(result.skippedEntries).toEqual([]);
      // Target has both skills with content intact.
      expect(await fs.readFile(join(to, "alpha", "SKILL.md"), "utf8")).toBe(
        "alpha body",
      );
      expect(await fs.readFile(join(to, "beta", "SKILL.md"), "utf8")).toBe(
        "beta body",
      );
      // Source dirs gone.
      await expect(fs.access(join(from, "alpha"))).rejects.toThrow();
      await expect(fs.access(join(from, "beta"))).rejects.toThrow();
      // Config updated.
      const config = await loadConfig();
      expect(config.setup.libraryPath).toBe(to);
    } finally {
      await fs.rm(from, { recursive: true, force: true });
      await fs.rm(to, { recursive: true, force: true });
    }
  });

  it("skips conflicts and leaves both copies intact", async () => {
    const from = await makeTmp("mig-conf-from");
    const to = await makeTmp("mig-conf-to");
    try {
      await plantSkill(from, "alpha", "from body");
      await plantSkill(to, "alpha", "preexisting body");
      await saveConfig({
        last_project: "",
        skills: {},
        settings: DEFAULT_SETTINGS,
        stacks: [],
        stackDeployments: [],
        setup: { ...DEFAULT_SETUP, completed: true, libraryPath: from, historyPath: from + "-history" },
      });
      const plan = await planMigration({
        fromLibrary: from,
        toLibrary: to,
        moveHistory: false,
      });
      const result = await runMigration(plan);
      expect(result.movedEntries).toEqual([]);
      expect(result.skippedEntries).toHaveLength(1);
      expect(result.skippedEntries[0].name).toBe("alpha");
      // Both versions still present.
      expect(await fs.readFile(join(from, "alpha", "SKILL.md"), "utf8")).toBe(
        "from body",
      );
      expect(await fs.readFile(join(to, "alpha", "SKILL.md"), "utf8")).toBe(
        "preexisting body",
      );
    } finally {
      await fs.rm(from, { recursive: true, force: true });
      await fs.rm(to, { recursive: true, force: true });
    }
  });

  it("rewrites a symlink deployment so it resolves to the new library", async () => {
    const from = await makeTmp("mig-sym-from");
    const to = await makeTmp("mig-sym-to");
    const project = await makeTmp("mig-sym-project");
    try {
      await plantSkill(from, "alpha", "alpha body");
      // Deploy as a symlink the way deploy.ts would, manually so we don't
      // depend on agent path resolution here.
      const projectAgentDir = join(project, ".claude", "skills");
      await fs.mkdir(projectAgentDir, { recursive: true });
      await fs.symlink(join(from, "alpha"), join(projectAgentDir, "alpha"));

      await saveConfig({
        last_project: "",
        skills: {
          alpha: {
            url: null,
            commit: null,
            installed_at: "2026-01-01T00:00:00Z",
            updated_at: null,
            projects: [project],
            deployments: [
              {
                projectPath: project,
                agentId: "claude",
                deployMode: "symlink",
                deployedAt: "2026-01-01T00:00:00Z",
              },
            ],
          },
        },
        settings: DEFAULT_SETTINGS,
        stacks: [],
        stackDeployments: [],
        setup: { ...DEFAULT_SETUP, completed: true, libraryPath: from, historyPath: from + "-history" },
      });

      const plan = await planMigration({
        fromLibrary: from,
        toLibrary: to,
        moveHistory: false,
      });
      const result = await runMigration(plan);
      expect(result.movedEntries).toEqual(["alpha"]);
      expect(result.rewrittenSymlinks).toBe(1);
      // The project's symlink now resolves into toLibrary.
      const real = await fs.realpath(join(projectAgentDir, "alpha"));
      expect(real).toBe(await fs.realpath(join(to, "alpha")));
    } finally {
      await fs.rm(from, { recursive: true, force: true });
      await fs.rm(to, { recursive: true, force: true });
      await fs.rm(project, { recursive: true, force: true });
    }
  });

  it("moves history when moveHistory is true", async () => {
    const from = await makeTmp("mig-hist-from");
    const to = await makeTmp("mig-hist-to");
    const fromHistory = `${from}-history`;
    const toHistory = `${to}-history`;
    try {
      await plantSkill(from, "alpha");
      await fs.mkdir(join(fromHistory, "alpha", "abc123"), { recursive: true });
      await fs.writeFile(
        join(fromHistory, "alpha", "abc123", "SKILL.md"),
        "snapshot",
      );

      await saveConfig({
        last_project: "",
        skills: {},
        settings: DEFAULT_SETTINGS,
        stacks: [],
        stackDeployments: [],
        setup: { ...DEFAULT_SETUP, completed: true, libraryPath: from, historyPath: fromHistory },
      });

      const plan = await planMigration({
        fromLibrary: from,
        toLibrary: to,
        moveHistory: true,
        fromHistory,
        toHistory,
      });
      const result = await runMigration(plan);
      expect(result.movedHistory).toBe(true);
      expect(
        await fs.readFile(
          join(toHistory, "alpha", "abc123", "SKILL.md"),
          "utf8",
        ),
      ).toBe("snapshot");
      await expect(fs.access(fromHistory)).rejects.toThrow();
      const config = await loadConfig();
      expect(config.setup.historyPath).toBe(toHistory);
    } finally {
      await fs.rm(from, { recursive: true, force: true });
      await fs.rm(to, { recursive: true, force: true });
      await fs.rm(fromHistory, { recursive: true, force: true });
      await fs.rm(toHistory, { recursive: true, force: true });
    }
  });

  it("leaves history alone when moveHistory is false", async () => {
    const from = await makeTmp("mig-hkeep-from");
    const to = await makeTmp("mig-hkeep-to");
    const fromHistory = `${from}-history`;
    try {
      await plantSkill(from, "alpha");
      await fs.mkdir(fromHistory, { recursive: true });
      await fs.writeFile(join(fromHistory, "marker"), "stay");

      await saveConfig({
        last_project: "",
        skills: {},
        settings: DEFAULT_SETTINGS,
        stacks: [],
        stackDeployments: [],
        setup: { ...DEFAULT_SETUP, completed: true, libraryPath: from, historyPath: fromHistory },
      });
      const plan = await planMigration({
        fromLibrary: from,
        toLibrary: to,
        moveHistory: false,
        fromHistory,
      });
      const result = await runMigration(plan);
      expect(result.movedHistory).toBe(false);
      expect(await fs.readFile(join(fromHistory, "marker"), "utf8")).toBe(
        "stay",
      );
      const config = await loadConfig();
      // historyPath stays at the source.
      expect(config.setup.historyPath).toBe(fromHistory);
    } finally {
      await fs.rm(from, { recursive: true, force: true });
      await fs.rm(to, { recursive: true, force: true });
      await fs.rm(fromHistory, { recursive: true, force: true });
    }
  });

  it("re-running on partial state skips already-moved entries", async () => {
    const from = await makeTmp("mig-rerun-from");
    const to = await makeTmp("mig-rerun-to");
    try {
      await plantSkill(from, "alpha");
      await plantSkill(from, "beta");
      // Pretend a previous run already moved alpha — present at to, missing from.
      await plantSkill(to, "alpha");
      await fs.rm(join(from, "alpha"), { recursive: true });

      await saveConfig({
        last_project: "",
        skills: {},
        settings: DEFAULT_SETTINGS,
        stacks: [],
        stackDeployments: [],
        setup: { ...DEFAULT_SETUP, completed: true, libraryPath: from, historyPath: from + "-history" },
      });
      const plan = await planMigration({
        fromLibrary: from,
        toLibrary: to,
        moveHistory: false,
      });
      // Plan only sees beta (alpha is already gone from source).
      expect(plan.entries.map((e) => e.name)).toEqual(["beta"]);
      const result = await runMigration(plan);
      expect(result.movedEntries).toEqual(["beta"]);
    } finally {
      await fs.rm(from, { recursive: true, force: true });
      await fs.rm(to, { recursive: true, force: true });
    }
  });
});
