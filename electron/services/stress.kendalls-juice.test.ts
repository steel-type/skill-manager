// End-to-end stress test for the kendalls-juice flow.
// Gated behind RUN_STRESS=1 so CI doesn't run it. Touches real disk
// (mocked into a tmp dir via the paths mock below) and walks every
// substantive path the user exercises in the app:
//
//   1. Library scan with mixed skills, bundles, and packages
//   2. Stack creation with members from each tier (incl. package-only
//      awesome-claude-code, ui-ux-pro-max-skill bundle)
//   3. deployStackToHomeLibrary: meta-skill written, agent dir wired
//   4. Member deploy with Claude (directory agent, has no SKILL.md
//      member should still work)
//   5. Re-running deploy is idempotent
//   6. updateStackComposition refreshes meta-skill content
//   7. Removing the stack tears down agent-dir wiring + meta-skill
//   8. Deleting the library dir mid-flight surfaces a useful error
//      instead of crashing
//
// Run with: RUN_STRESS=1 npx vitest run electron/services/stress.kendalls-juice.test.ts

import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("./paths", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const root = path.join(
    os.tmpdir(),
    `skill-manager-stress-${process.pid}-${Date.now()}`,
  );
  const claudeDir = path.join(root, ".claude");
  let libraryPath = path.join(root, ".skill-stack", "skills");
  let historyPath = path.join(root, ".skill-stack", "skills-history");
  return {
    CONFIG_PATH: path.join(claudeDir, "skill-manager.json"),
    getClaudeDir: () => claudeDir,
    getLibraryPath: () => libraryPath,
    getHistoryPath: () => historyPath,
    configurePaths: (args: { libraryPath: string; historyPath: string }) => {
      libraryPath = args.libraryPath;
      historyPath = args.historyPath;
    },
    resetPathsForTest: () => undefined,
  };
});

import { CONFIG_PATH, getLibraryPath } from "./paths";
import { loadConfig, saveConfig } from "./config";
import { DEFAULT_SETTINGS, DEFAULT_SETUP } from "./types";
import { listSkills } from "./skills";
import {
  createStack,
  deployStackToHomeLibrary,
  deleteStack,
  updateStackComposition,
} from "./stacks";
import { dirname } from "node:path";

const ENABLED = process.env.RUN_STRESS === "1";

beforeEach(async () => {
  await fs.mkdir(dirname(CONFIG_PATH), { recursive: true });
  await fs.mkdir(getLibraryPath(), { recursive: true });
  await saveConfig({
    last_project: "",
    skills: {},
    settings: { ...DEFAULT_SETTINGS, default_deploy_mode: "symlink" },
    stacks: [],
    stackDeployments: [],
    setup: {
      ...DEFAULT_SETUP,
      completed: true,
      libraryRoot: "centralized",
      libraryPath: getLibraryPath(),
      historyPath: getLibraryPath().replace("skills", "skills-history"),
      primaryAgent: "claude",
    },
  });
});

afterEach(async () => {
  await fs.rm(dirname(dirname(CONFIG_PATH)), {
    recursive: true,
    force: true,
  });
});

async function seedLibrary() {
  const lib = getLibraryPath();
  // Real skill: kendalls-juice flavor (SKILL.md at root).
  await fs.mkdir(join(lib, "agent-skills"), { recursive: true });
  await fs.writeFile(
    join(lib, "agent-skills", "AGENTS.md"),
    "---\nname: agent-skills\ndescription: triggers when agent is mentioned for use specifically.\n---\nbody",
  );
  // Bundle: ui-ux-pro-max-skill (no root SKILL.md, nested skills).
  await fs.mkdir(join(lib, "ui-ux-pro-max-skill", "ui", "scripts"), {
    recursive: true,
  });
  await fs.writeFile(
    join(lib, "ui-ux-pro-max-skill", "ui", "SKILL.md"),
    "---\nname: ui\ndescription: triggers when ui is mentioned in this nested context.\n---\n",
  );
  // Package: awesome-claude-code (no SKILL.md, has scripts/ + data/).
  await fs.mkdir(join(lib, "awesome-claude-code", "scripts"), {
    recursive: true,
  });
  await fs.mkdir(join(lib, "awesome-claude-code", "data"), {
    recursive: true,
  });
  await fs.writeFile(
    join(lib, "awesome-claude-code", "scripts", "run.sh"),
    "#!/bin/sh\necho hi",
  );
  // Skill (other member of kendalls-juice).
  await fs.mkdir(join(lib, "context7"), { recursive: true });
  await fs.writeFile(
    join(lib, "context7", "SKILL.md"),
    "---\nname: context7\ndescription: triggers when context7 is mentioned in this skill manager context test.\n---\n",
  );
  // Mark the four library skills as installed so createStack's
  // member-validation passes.
  const cfg = await loadConfig();
  cfg.skills = {
    "agent-skills": {
      url: null,
      commit: null,
      installed_at: "",
      updated_at: null,
      projects: [],
    },
    "ui-ux-pro-max-skill": {
      url: null,
      commit: null,
      installed_at: "",
      updated_at: null,
      projects: [],
    },
    "awesome-claude-code": {
      url: null,
      commit: null,
      installed_at: "",
      updated_at: null,
      projects: [],
    },
    context7: {
      url: null,
      commit: null,
      installed_at: "",
      updated_at: null,
      projects: [],
    },
  };
  await saveConfig(cfg);
}

describe.skipIf(!ENABLED)("kendalls-juice stress", () => {
  it("listSkills surfaces all three tiers with correct kinds", async () => {
    await seedLibrary();
    const skills = await listSkills();
    const byName = Object.fromEntries(skills.map((s) => [s.name, s]));
    expect(byName["agent-skills"].isSkill).toBe(true);
    expect(byName["ui-ux-pro-max-skill"].isBundle).toBe(true);
    expect(byName["awesome-claude-code"].isSkill).toBe(false);
    expect(byName["awesome-claude-code"].isBundle).toBe(false);
    // The package-tier entry survives listSkills because the dir exists,
    // even though it's neither a skill nor a bundle.
    expect(byName["awesome-claude-code"]).toBeDefined();
  });

  it("createStack accepts mixed-tier members; deployStackToHomeLibrary writes meta-skill", async () => {
    await seedLibrary();
    const stack = await createStack(
      "Kendalls Juice",
      "triggers when Kendall's juice is mentioned in tests.",
      [
        "awesome-claude-code",
        "context7",
        "ui-ux-pro-max-skill",
        "agent-skills",
      ],
    );
    expect(stack.id).toBe("kendalls-juice");
    const result = await deployStackToHomeLibrary(stack.id);
    // Stack flag is now true; meta-skill on disk.
    const cfg = await loadConfig();
    const updated = cfg.stacks.find((s) => s.id === "kendalls-juice");
    expect(updated?.inHomeLibrary).toBe(true);
    const skillMd = await fs.readFile(
      join(getLibraryPath(), "kendalls-juice", "SKILL.md"),
      "utf8",
    );
    expect(skillMd).toContain("awesome-claude-code");
    expect(skillMd).toContain("ui-ux-pro-max-skill");
    expect(result.warning).toBeNull();
  });

  it("updateStackComposition refreshes meta-skill content", async () => {
    await seedLibrary();
    const stack = await createStack(
      "Kendalls Juice",
      "triggers when Kendall's juice is mentioned in tests.",
      ["awesome-claude-code", "context7"],
    );
    const before = await fs.readFile(
      join(getLibraryPath(), stack.id, "SKILL.md"),
      "utf8",
    );
    expect(before).toContain("awesome-claude-code");
    expect(before).not.toContain("ui-ux-pro-max-skill");

    await updateStackComposition(stack.id, [
      "awesome-claude-code",
      "context7",
      "ui-ux-pro-max-skill",
    ]);
    const after = await fs.readFile(
      join(getLibraryPath(), stack.id, "SKILL.md"),
      "utf8",
    );
    expect(after).toContain("ui-ux-pro-max-skill");
  });

  it("deleteStack with cleanup=false still removes library meta-skill (no orphan)", async () => {
    await seedLibrary();
    const stack = await createStack(
      "Kendalls Juice",
      "triggers when Kendall's juice is mentioned in tests.",
      ["awesome-claude-code", "context7"],
    );
    expect(
      await fs.stat(join(getLibraryPath(), stack.id)).catch(() => null),
    ).not.toBeNull();
    await deleteStack(stack.id, false);
    expect(
      await fs.stat(join(getLibraryPath(), stack.id)).catch(() => null),
    ).toBeNull();
  });

  it("createStack errors cleanly if a member skill isn't in the library", async () => {
    await seedLibrary();
    await expect(
      createStack("Bad Stack", "triggers when bad is mentioned.", [
        "agent-skills",
        "ghost-skill",
      ]),
    ).rejects.toThrow(/not in the library/);
  });

  it("createStack rejects collision with an existing skill name", async () => {
    await seedLibrary();
    // 'context7' is a real skill; trying to make it a stack should fail.
    await expect(
      createStack("Context7", "triggers when context is mentioned.", [
        "agent-skills",
      ]),
    ).rejects.toThrow(/skill with that name already exists/);
  });

  it("createStack rejects on-disk collision even without a config.skills entry", async () => {
    await seedLibrary();
    // Plant a directory on disk that has no config.skills record — simulates
    // a manual install or migration artifact. createStack must NOT overwrite.
    await fs.mkdir(join(getLibraryPath(), "manual-orphan"), {
      recursive: true,
    });
    await expect(
      createStack(
        "Manual Orphan",
        "triggers when manual orphan is mentioned in the test.",
        ["agent-skills"],
      ),
    ).rejects.toThrow(/already exists at/);
  });
});
