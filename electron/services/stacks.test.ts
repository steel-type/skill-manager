import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mirror config.test.ts / deploy.test.ts: redirect paths.* to a per-suite
// tmp dir so the user's real ~/.claude tree is never touched.
vi.mock("./paths", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const root = path.join(
    os.tmpdir(),
    `skill-manager-stacks-test-${process.pid}-${Date.now()}`,
  );
  return {
    CLAUDE_DIR: path.join(root, ".claude"),
    LIBRARY_PATH: path.join(root, ".claude", "skills"),
    CONFIG_PATH: path.join(root, ".claude", "skill-manager.json"),
  };
});

import { CONFIG_PATH, LIBRARY_PATH } from "./paths";
import { loadConfig, saveConfig } from "./config";
import { listSkills, parseSkillFrontmatter } from "./skills";
import {
  createStack,
  deleteStack,
  deployStack,
  generateMetaSkill,
  listStacks,
  removeMetaSkillFromLibrary,
  removeMetaSkillFromProject,
  updateStackComposition,
  writeMetaSkillToLibrary,
  writeMetaSkillToProject,
} from "./stacks";
import { DEFAULT_SETTINGS, type SkillStack } from "./types";
import { dirname } from "node:path";

async function writeSkill(name: string, files: Record<string, string>) {
  const root = join(LIBRARY_PATH, name);
  await fs.mkdir(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, rel);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

async function makeProject(): Promise<string> {
  const project = join(
    tmpdir(),
    `skill-manager-stacks-project-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(project, { recursive: true });
  return project;
}

function fixtureStack(overrides: Partial<SkillStack> = {}): SkillStack {
  return {
    id: "demo-stack",
    name: "Demo Stack",
    description: "A demo stack for tests.",
    skillIds: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(async () => {
  await fs.mkdir(LIBRARY_PATH, { recursive: true });
  await fs.mkdir(dirname(CONFIG_PATH), { recursive: true });
});

afterEach(async () => {
  // Clean both the faux .claude tree AND the per-suite library dir.
  await fs.rm(dirname(CONFIG_PATH), { recursive: true, force: true });
});

describe("generateMetaSkill", () => {
  it("emits valid YAML frontmatter that round-trips through parseSkillFrontmatter", async () => {
    const stack = fixtureStack({
      id: "round-trip",
      name: "Round Trip",
      description: "Describes the round-trip stack.",
      skillIds: ["alpha", "beta"],
    });
    const md = generateMetaSkill(stack, [
      { name: "alpha", description: "Alpha helper." },
      { name: "beta", description: "Beta helper." },
    ]);
    const tmpFile = join(tmpdir(), `meta-${Date.now()}.md`);
    await fs.writeFile(tmpFile, md, "utf8");
    try {
      const parsed = await parseSkillFrontmatter(tmpFile);
      expect(parsed.name).toBe("round-trip");
      expect(parsed.description).toBe("Describes the round-trip stack.");
    } finally {
      await fs.rm(tmpFile, { force: true });
    }
  });

  it("lists every member skill by name in the activate-list", () => {
    const stack = fixtureStack({ skillIds: ["a", "b", "c"] });
    const md = generateMetaSkill(stack, [
      { name: "a", description: "" },
      { name: "b", description: "" },
      { name: "c", description: "" },
    ]);
    expect(md).toMatch(/- a\n- b\n- c/);
  });

  it("falls back to a stable default when a member's description is missing", () => {
    const stack = fixtureStack({ skillIds: ["alpha", "beta"] });
    const md = generateMetaSkill(stack, [
      { name: "alpha", description: "" },
      { name: "beta", description: "Beta helper." },
    ]);
    expect(md).toContain("### alpha\nNo description provided.");
    expect(md).toContain("### beta\nBeta helper.");
  });

  it("falls back to a stable default when a member is absent from the input", () => {
    const stack = fixtureStack({ skillIds: ["ghost"] });
    const md = generateMetaSkill(stack, []);
    expect(md).toContain("### ghost\nNo description provided.");
  });

  it("emits a placeholder line when the stack has no members", () => {
    const stack = fixtureStack({ skillIds: [] });
    const md = generateMetaSkill(stack, []);
    expect(md).toContain("_(no skills configured)_");
    // Frontmatter still parses cleanly even with an empty body.
    expect(md).toMatch(/^---\nname: demo-stack/);
  });

  it("synthesises a description when the stack has none", () => {
    const stack = fixtureStack({ description: "" });
    const md = generateMetaSkill(stack, []);
    expect(md).toContain("description: Skill stack: Demo Stack");
  });

  it("quotes descriptions that would otherwise be parsed as a YAML literal", () => {
    const stack = fixtureStack({ description: "true" });
    const md = generateMetaSkill(stack, []);
    expect(md).toContain('description: "true"');
  });
});

describe("writeMetaSkillToProject / removeMetaSkillFromProject", () => {
  it("writes <project>/.claude/skills/<stack>/SKILL.md for the claude agent", async () => {
    const project = await makeProject();
    try {
      const dest = await writeMetaSkillToProject(
        "my-stack",
        "# stack body",
        project,
        "claude",
      );
      expect(dest).toBe(
        join(project, ".claude", "skills", "my-stack", "SKILL.md"),
      );
      expect(await fs.readFile(dest, "utf8")).toBe("# stack body");
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });

  it("writes <project>/.cursor/rules/<stack>.mdc for the cursor agent", async () => {
    const project = await makeProject();
    try {
      const dest = await writeMetaSkillToProject(
        "my-stack",
        "rule body",
        project,
        "cursor",
      );
      expect(dest).toBe(join(project, ".cursor", "rules", "my-stack.mdc"));
      expect(await fs.readFile(dest, "utf8")).toBe("rule body");
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });

  it("removes the meta-skill directory for directory-style agents", async () => {
    const project = await makeProject();
    try {
      await writeMetaSkillToProject("my-stack", "body", project, "claude");
      const dir = join(project, ".claude", "skills", "my-stack");
      await fs.access(dir); // exists
      await removeMetaSkillFromProject("my-stack", project, "claude");
      await expect(fs.stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });

  it("removes the meta-skill .mdc file for cursor", async () => {
    const project = await makeProject();
    try {
      await writeMetaSkillToProject("my-stack", "body", project, "cursor");
      const file = join(project, ".cursor", "rules", "my-stack.mdc");
      await fs.access(file);
      await removeMetaSkillFromProject("my-stack", project, "cursor");
      await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });
});

describe("createStack", () => {
  it("creates a stack and persists it in config", async () => {
    await fs.mkdir(`${LIBRARY_PATH}/alpha`, { recursive: true });
    await fs.mkdir(`${LIBRARY_PATH}/beta`, { recursive: true });
    await saveConfig({
      last_project: "",
      skills: {
        alpha: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
        beta: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
      },
      settings: DEFAULT_SETTINGS,
      stacks: [],
      stackDeployments: [],
    });
    const stack = await createStack("My Stack", "test", ["alpha", "beta"]);
    expect(stack.id).toBe("my-stack");
    expect(stack.skillIds).toEqual(["alpha", "beta"]);
    const all = await listStacks();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("my-stack");
  });

  it("rejects a duplicate stack id", async () => {
    await saveConfig({
      last_project: "",
      skills: {},
      settings: DEFAULT_SETTINGS,
      stacks: [
        {
          id: "my-stack",
          name: "My Stack",
          description: "",
          skillIds: [],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      stackDeployments: [],
    });
    await expect(createStack("My Stack", "", [])).rejects.toThrow(
      /already exists/,
    );
  });

  it("rejects a member skill that is not in the library", async () => {
    await saveConfig({
      last_project: "",
      skills: {},
      settings: DEFAULT_SETTINGS,
      stacks: [],
      stackDeployments: [],
    });
    await expect(
      createStack("My Stack", "", ["missing-skill"]),
    ).rejects.toThrow(/not in the library/);
  });
});

describe("deployStack", () => {
  it("deploys every member skill plus the meta-skill to the agent's project path", async () => {
    await writeSkill("alpha", { "SKILL.md": "alpha body" });
    await writeSkill("beta", { "SKILL.md": "beta body" });
    await saveConfig({
      last_project: "",
      skills: {
        alpha: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
        beta: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
      },
      settings: DEFAULT_SETTINGS,
      stacks: [
        {
          id: "demo",
          name: "Demo",
          description: "demo",
          skillIds: ["alpha", "beta"],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      stackDeployments: [],
    });
    const project = await makeProject();
    try {
      const result = await deployStack("demo", project, "claude", "copy");
      expect(result.deployed).toEqual(["alpha", "beta"]);
      expect(result.failed).toEqual([]);
      expect(
        await fs.readFile(
          join(project, ".claude", "skills", "alpha", "SKILL.md"),
          "utf8",
        ),
      ).toBe("alpha body");
      expect(
        await fs.readFile(
          join(project, ".claude", "skills", "beta", "SKILL.md"),
          "utf8",
        ),
      ).toBe("beta body");
      const metaText = await fs.readFile(result.metaSkillPath, "utf8");
      expect(metaText).toMatch(/^---\nname: demo/);
      expect(metaText).toMatch(/- alpha\n- beta/);
      // Config was updated with a StackDeployment + member SkillRecord deployments.
      const config = await loadConfig();
      expect(config.stackDeployments).toHaveLength(1);
      expect(config.stackDeployments[0]).toMatchObject({
        stackId: "demo",
        projectPath: project,
        agentId: "claude",
        deployMode: "copy",
        includedSkillIds: ["alpha", "beta"],
      });
      expect(config.skills.alpha.deployments?.[0]).toMatchObject({
        projectPath: project,
        agentId: "claude",
      });
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });

  it("re-uses an existing StackDeployment row instead of duplicating it", async () => {
    await writeSkill("alpha", { "SKILL.md": "a" });
    await saveConfig({
      last_project: "",
      skills: {
        alpha: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
      },
      settings: DEFAULT_SETTINGS,
      stacks: [
        {
          id: "demo",
          name: "Demo",
          description: "",
          skillIds: ["alpha"],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      stackDeployments: [],
    });
    const project = await makeProject();
    try {
      await deployStack("demo", project, "claude", "copy");
      await deployStack("demo", project, "claude", "copy");
      const config = await loadConfig();
      expect(config.stackDeployments).toHaveLength(1);
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });

  it("returns a per-skill failure entry when a member is missing from the library", async () => {
    await writeSkill("alpha", { "SKILL.md": "a" });
    await saveConfig({
      last_project: "",
      skills: {
        alpha: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
      },
      settings: DEFAULT_SETTINGS,
      stacks: [
        {
          id: "demo",
          name: "Demo",
          description: "",
          skillIds: ["alpha", "ghost"],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      stackDeployments: [],
    });
    const project = await makeProject();
    try {
      const result = await deployStack("demo", project, "claude", "copy");
      expect(result.deployed).toEqual(["alpha"]);
      expect(result.failed).toEqual([
        { skillId: "ghost", error: expect.stringMatching(/ghost/) },
      ]);
      // Meta-skill still lists the ghost name — agents will simply find the
      // referenced skill missing in their catalog and skip it.
      const metaText = await fs.readFile(result.metaSkillPath, "utf8");
      expect(metaText).toContain("- ghost");
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });
});

describe("updateStackComposition", () => {
  async function seedStackAndDeploy(): Promise<{ project: string }> {
    await writeSkill("alpha", { "SKILL.md": "alpha body" });
    await writeSkill("beta", { "SKILL.md": "beta body" });
    await writeSkill("gamma", { "SKILL.md": "gamma body" });
    await saveConfig({
      last_project: "",
      skills: {
        alpha: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
        beta: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
        gamma: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
      },
      settings: DEFAULT_SETTINGS,
      stacks: [
        {
          id: "demo",
          name: "Demo",
          description: "",
          skillIds: ["alpha", "beta"],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      stackDeployments: [],
    });
    const project = await makeProject();
    await deployStack("demo", project, "claude", "copy");
    return { project };
  }

  it("deploys newly-added skills to every existing deployment", async () => {
    const { project } = await seedStackAndDeploy();
    try {
      const result = await updateStackComposition("demo", [
        "alpha",
        "beta",
        "gamma",
      ]);
      expect(result.added).toEqual(["gamma"]);
      expect(result.removed).toEqual([]);
      // Newly-added skill is on disk under the project's claude path.
      expect(
        await fs.readFile(
          join(project, ".claude", "skills", "gamma", "SKILL.md"),
          "utf8",
        ),
      ).toBe("gamma body");
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });

  it("regenerates the meta-skill so removed members no longer appear in the body", async () => {
    const { project } = await seedStackAndDeploy();
    try {
      await updateStackComposition("demo", ["alpha"]);
      const meta = await fs.readFile(
        join(project, ".claude", "skills", "demo", "SKILL.md"),
        "utf8",
      );
      expect(meta).toContain("- alpha");
      expect(meta).not.toContain("- beta");
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });

  it("updates the StackDeployment.includedSkillIds snapshot", async () => {
    const { project } = await seedStackAndDeploy();
    try {
      await updateStackComposition("demo", ["alpha"]);
      const config = await loadConfig();
      const dep = config.stackDeployments.find((d) => d.stackId === "demo");
      expect(dep?.includedSkillIds).toEqual(["alpha"]);
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });
});

describe("deleteStack", () => {
  async function seedStackAndDeploy(): Promise<{ project: string }> {
    await writeSkill("alpha", { "SKILL.md": "a" });
    await saveConfig({
      last_project: "",
      skills: {
        alpha: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
      },
      settings: DEFAULT_SETTINGS,
      stacks: [
        {
          id: "demo",
          name: "Demo",
          description: "",
          skillIds: ["alpha"],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      stackDeployments: [],
    });
    const project = await makeProject();
    await deployStack("demo", project, "claude", "copy");
    return { project };
  }

  it("with cleanup, removes the meta-skill from each tracked project", async () => {
    const { project } = await seedStackAndDeploy();
    try {
      await deleteStack("demo", true);
      await expect(
        fs.stat(join(project, ".claude", "skills", "demo")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      // Member skill files are intentionally left in place — see docstring.
      expect(
        await fs.readFile(
          join(project, ".claude", "skills", "alpha", "SKILL.md"),
          "utf8",
        ),
      ).toBe("a");
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });

  it("without cleanup, leaves the meta-skill on disk and only clears config", async () => {
    const { project } = await seedStackAndDeploy();
    try {
      await deleteStack("demo", false);
      const metaPath = join(project, ".claude", "skills", "demo", "SKILL.md");
      const stat = await fs.stat(metaPath);
      expect(stat.isFile()).toBe(true);
      const config = await loadConfig();
      expect(config.stacks).toEqual([]);
      expect(config.stackDeployments).toEqual([]);
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });
});

// ── Phase 0A: stack meta-skills staged in the library ──────────────────────

describe("writeMetaSkillToLibrary / removeMetaSkillFromLibrary", () => {
  it("writes <LIBRARY>/<stackId>/SKILL.md and is idempotent", async () => {
    const path = await writeMetaSkillToLibrary("foo-stack", "first");
    expect(path).toBe(join(LIBRARY_PATH, "foo-stack", "SKILL.md"));
    expect(await fs.readFile(path, "utf8")).toBe("first");
    // Overwrite with new content — same path, fresh body.
    await writeMetaSkillToLibrary("foo-stack", "second");
    expect(await fs.readFile(path, "utf8")).toBe("second");
  });

  it("removes the library staging directory", async () => {
    const path = await writeMetaSkillToLibrary("gone-stack", "body");
    expect(await fs.readFile(path, "utf8")).toBe("body");
    await removeMetaSkillFromLibrary("gone-stack");
    await expect(fs.access(path)).rejects.toThrow();
  });
});

describe("createStack — library staging", () => {
  beforeEach(async () => {
    await writeSkill("alpha", { "SKILL.md": "alpha body" });
    await saveConfig({
      last_project: "",
      skills: {
        alpha: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
      },
      settings: DEFAULT_SETTINGS,
      stacks: [],
      stackDeployments: [],
    });
  });

  it("stages a generated SKILL.md in the library on create", async () => {
    const stack = await createStack("Phase Zero", "Triggers when user says zero", [
      "alpha",
    ]);
    const libPath = join(LIBRARY_PATH, stack.id, "SKILL.md");
    const content = await fs.readFile(libPath, "utf8");
    expect(content).toMatch(/^---\nname: phase-zero/);
    expect(content).toContain("Triggers when user says zero");
    expect(content).toContain("- alpha");
  });

  it("rejects creating a stack whose id collides with an existing skill", async () => {
    await expect(
      createStack("Alpha", "Triggers when user mentions alpha", ["alpha"]),
    ).rejects.toThrow(/already exists in the library/);
  });
});

describe("deployStack — symlink mode", () => {
  it("deploys the stack meta-skill as a symlink resolving to the library", async () => {
    await writeSkill("alpha", { "SKILL.md": "alpha body" });
    await writeSkill("beta", { "SKILL.md": "beta body" });
    await saveConfig({
      last_project: "",
      skills: {
        alpha: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
        beta: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
      },
      settings: DEFAULT_SETTINGS,
      stacks: [
        {
          id: "demo",
          name: "Demo",
          description: "Triggers when user says demo",
          skillIds: ["alpha", "beta"],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      stackDeployments: [],
    });
    // Pre-stage the library file (createStack would normally do this; this
    // test seeded the stack via saveConfig so we need to mimic).
    await writeMetaSkillToLibrary(
      "demo",
      "---\nname: demo\ndescription: stub\n---\n",
    );

    const project = await makeProject();
    try {
      const result = await deployStack("demo", project, "claude", "symlink");
      expect(result.deployMode).toBe("symlink");
      const stackDir = join(project, ".claude", "skills", "demo");
      const lstat = await fs.lstat(stackDir);
      expect(lstat.isSymbolicLink()).toBe(true);
      const target = await fs.realpath(stackDir);
      expect(target).toBe(await fs.realpath(join(LIBRARY_PATH, "demo")));
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });
});

describe("deleteStack — library cleanup", () => {
  it("with cleanup, removes the library staging directory", async () => {
    await writeSkill("alpha", { "SKILL.md": "alpha body" });
    await saveConfig({
      last_project: "",
      skills: {
        alpha: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
      },
      settings: DEFAULT_SETTINGS,
      stacks: [],
      stackDeployments: [],
    });
    const stack = await createStack("Demo", "Triggers when user says demo", [
      "alpha",
    ]);
    expect(
      await fs.readFile(join(LIBRARY_PATH, stack.id, "SKILL.md"), "utf8"),
    ).toContain(stack.id);
    await deleteStack(stack.id, true);
    await expect(
      fs.access(join(LIBRARY_PATH, stack.id, "SKILL.md")),
    ).rejects.toThrow();
  });
});

describe("listSkills excludes stack ids (Phase 0A)", () => {
  it("does not return stack meta-skills as library skills", async () => {
    await writeSkill("alpha", { "SKILL.md": "alpha body" });
    await saveConfig({
      last_project: "",
      skills: {
        alpha: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
      },
      settings: DEFAULT_SETTINGS,
      stacks: [],
      stackDeployments: [],
    });
    const stack = await createStack(
      "Phase Zero",
      "Triggers when user says zero",
      ["alpha"],
    );
    // Library now contains both alpha (regular skill) and the stack staging dir.
    const skills = await listSkills();
    const names = skills.map((s) => s.name);
    expect(names).toContain("alpha");
    expect(names).not.toContain(stack.id);
  });
});

describe("updateStackComposition — library refresh", () => {
  it("regenerates the library SKILL.md when the membership changes", async () => {
    await writeSkill("alpha", { "SKILL.md": "alpha body" });
    await writeSkill("beta", { "SKILL.md": "beta body" });
    await saveConfig({
      last_project: "",
      skills: {
        alpha: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
        beta: {
          url: null,
          commit: null,
          installed_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          projects: [],
        },
      },
      settings: DEFAULT_SETTINGS,
      stacks: [],
      stackDeployments: [],
    });
    const stack = await createStack("Demo", "Triggers when user says demo", [
      "alpha",
    ]);
    const libPath = join(LIBRARY_PATH, stack.id, "SKILL.md");
    expect(await fs.readFile(libPath, "utf8")).toMatch(/- alpha/);
    expect(await fs.readFile(libPath, "utf8")).not.toMatch(/- beta/);

    await updateStackComposition(stack.id, ["alpha", "beta"]);
    const after = await fs.readFile(libPath, "utf8");
    expect(after).toMatch(/- alpha\n- beta/);
  });
});
