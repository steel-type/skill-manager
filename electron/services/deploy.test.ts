import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Redirect LIBRARY_PATH onto a tmp dir per-suite so tests never touch the
// user's real ~/.claude/skills tree. The factory body has to compute the
// path itself — vitest hoists vi.mock above local const declarations.
vi.mock("./paths", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const root = path.join(
    os.tmpdir(),
    `skill-manager-deploy-test-${process.pid}-${Date.now()}`,
  );
  return {
    CLAUDE_DIR: path.join(root, ".claude"),
    LIBRARY_PATH: path.join(root, ".claude", "skills"),
    CONFIG_PATH: path.join(root, ".claude", "skill-manager.json"),
  };
});

import { LIBRARY_PATH } from "./paths";
import { cascadeToProjects, copyToProject } from "./deploy";

const TEST_LIBRARY = LIBRARY_PATH;

async function writeSkill(name: string, files: Record<string, string>) {
  const root = join(TEST_LIBRARY, name);
  await fs.mkdir(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, rel);
    await fs.mkdir(join(target, ".."), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

async function makeProject(): Promise<string> {
  const project = join(
    tmpdir(),
    `skill-manager-deploy-project-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(project, { recursive: true });
  return project;
}

beforeEach(async () => {
  await fs.mkdir(TEST_LIBRARY, { recursive: true });
});

afterEach(async () => {
  await fs.rm(TEST_LIBRARY, { recursive: true, force: true });
});

describe("copyToProject", () => {
  it("copies the skill into <project>/.claude/skills/<name>/", async () => {
    await writeSkill("alpha", { "SKILL.md": "# alpha\nhello" });
    const project = await makeProject();
    try {
      await copyToProject("alpha", project);
      const skillPath = join(project, ".claude", "skills", "alpha", "SKILL.md");
      expect(await fs.readFile(skillPath, "utf8")).toBe("# alpha\nhello");
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });

  it("creates .claude/skills/ when it does not exist", async () => {
    await writeSkill("beta", { "SKILL.md": "body" });
    const project = await makeProject();
    try {
      // Project starts with no .claude dir at all.
      const before = await fs
        .stat(join(project, ".claude"))
        .catch(() => null);
      expect(before).toBeNull();
      await copyToProject("beta", project);
      const after = await fs.stat(join(project, ".claude", "skills", "beta"));
      expect(after.isDirectory()).toBe(true);
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });

  it("overwrites an existing deployment cleanly", async () => {
    await writeSkill("gamma", { "SKILL.md": "v2", "new-file.md": "added" });
    const project = await makeProject();
    try {
      // Pre-seed an old deployment with stale files.
      const dest = join(project, ".claude", "skills", "gamma");
      await fs.mkdir(dest, { recursive: true });
      await fs.writeFile(join(dest, "SKILL.md"), "v1");
      await fs.writeFile(join(dest, "stale.md"), "should be removed");

      await copyToProject("gamma", project);

      expect(await fs.readFile(join(dest, "SKILL.md"), "utf8")).toBe("v2");
      expect(await fs.readFile(join(dest, "new-file.md"), "utf8")).toBe(
        "added",
      );
      // The stale file from the previous deployment must be gone.
      await expect(fs.stat(join(dest, "stale.md"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });

  it("copies nested directories recursively", async () => {
    await writeSkill("delta", {
      "SKILL.md": "main",
      "scripts/run.sh": "#!/bin/sh",
      "references/notes.md": "ref",
    });
    const project = await makeProject();
    try {
      await copyToProject("delta", project);
      const dest = join(project, ".claude", "skills", "delta");
      expect(await fs.readFile(join(dest, "scripts/run.sh"), "utf8")).toBe(
        "#!/bin/sh",
      );
      expect(
        await fs.readFile(join(dest, "references/notes.md"), "utf8"),
      ).toBe("ref");
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });

  it("throws a clear error when the skill is not in the library", async () => {
    const project = await makeProject();
    try {
      await expect(copyToProject("missing", project)).rejects.toThrow(
        /missing.*not in library/,
      );
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });

  it("throws when the skill path exists but is a file, not a directory", async () => {
    // Plant a file at LIBRARY_PATH/<name> so the stat says exists-but-not-dir.
    await fs.writeFile(join(TEST_LIBRARY, "regular-file"), "oops");
    const project = await makeProject();
    try {
      await expect(
        copyToProject("regular-file", project),
      ).rejects.toThrow(/not in library/);
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });
});

describe("cascadeToProjects", () => {
  it("returns updated and failed lists from a mixed batch", async () => {
    await writeSkill("kappa", { "SKILL.md": "k" });
    const projectOk = await makeProject();
    const projectMissing = join(tmpdir(), `nonexistent-${Date.now()}`);
    try {
      const result = await cascadeToProjects("kappa", [
        projectOk,
        projectMissing,
      ]);
      expect(result.updated).toEqual([projectOk]);
      expect(result.failed).toEqual([projectMissing]);
    } finally {
      await fs.rm(projectOk, { recursive: true, force: true });
    }
  });

  it("treats a path that resolves to a regular file (not a directory) as failed", async () => {
    await writeSkill("lambda", { "SKILL.md": "l" });
    const filePath = join(tmpdir(), `not-a-dir-${Date.now()}.txt`);
    await fs.writeFile(filePath, "i am a file");
    try {
      const result = await cascadeToProjects("lambda", [filePath]);
      expect(result.updated).toEqual([]);
      expect(result.failed).toEqual([filePath]);
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it("returns empty lists for an empty input", async () => {
    expect(await cascadeToProjects("anything", [])).toEqual({
      updated: [],
      failed: [],
    });
  });
});
