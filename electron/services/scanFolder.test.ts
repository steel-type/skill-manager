import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultScanFolder,
  scanFolderForSkills,
} from "./scanFolder";

const made: string[] = [];
afterEach(async () => {
  while (made.length) await fs.rm(made.pop()!, { recursive: true, force: true });
});

async function mkTmp(prefix = "scan-test-"): Promise<string> {
  const d = await fs.mkdtemp(join(tmpdir(), prefix));
  made.push(d);
  return d;
}

async function writeSkillFolder(parent: string, name: string): Promise<string> {
  const dir = join(parent, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill ${name}. Use when running scanner tests.\n---\n\nbody`,
  );
  return dir;
}

async function writeArchive(parent: string, fileName: string): Promise<string> {
  const p = join(parent, fileName);
  // Contents don't matter for scan — it doesn't open archives. A few bytes
  // is enough to make stat() return a non-zero size.
  await fs.writeFile(p, "PK\x03\x04 fake-zip-contents");
  return p;
}

describe("defaultScanFolder", () => {
  it("returns an absolute path ending in Downloads", () => {
    const dir = defaultScanFolder();
    expect(dir.startsWith("/")).toBe(true);
    expect(dir.endsWith("/Downloads")).toBe(true);
  });
});

describe("scanFolderForSkills", () => {
  it("returns an empty list for an empty folder", async () => {
    const dir = await mkTmp();
    expect(await scanFolderForSkills(dir)).toEqual([]);
  });

  it("throws a friendly error when the folder is unreadable", async () => {
    await expect(
      scanFolderForSkills("/this/path/does/not/exist-skillbase-test"),
    ).rejects.toThrow(/Could not read folder/);
  });

  it("detects a folder containing SKILL.md at its root", async () => {
    const dir = await mkTmp();
    await writeSkillFolder(dir, "good-skill");
    const results = await scanFolderForSkills(dir);
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("folder");
    expect(results[0].displayName).toBe("good-skill");
    expect(results[0].sizeBytes).toBeGreaterThan(0);
  });

  it("detects a folder wrapping a single SKILL.md subfolder", async () => {
    // Common shape: someone unzipped a `.skill` and the inner folder is the
    // actual skill, one level down.
    const dir = await mkTmp();
    const outer = join(dir, "wrapper");
    await fs.mkdir(outer, { recursive: true });
    await writeSkillFolder(outer, "inner-skill");
    const results = await scanFolderForSkills(dir);
    expect(results).toHaveLength(1);
    expect(results[0].displayName).toBe("wrapper");
  });

  it("rejects a folder with two non-skill subfolders (not a wrapper shape)", async () => {
    const dir = await mkTmp();
    const outer = join(dir, "ambiguous");
    await fs.mkdir(join(outer, "alpha"), { recursive: true });
    await fs.mkdir(join(outer, "beta"), { recursive: true });
    expect(await scanFolderForSkills(dir)).toEqual([]);
  });

  it("detects .skill and .zip archives without extracting them", async () => {
    const dir = await mkTmp();
    await writeArchive(dir, "thing.skill");
    await writeArchive(dir, "other.zip");
    await fs.writeFile(join(dir, "unrelated.txt"), "hi");
    const results = await scanFolderForSkills(dir);
    expect(results).toHaveLength(2);
    const names = results.map((r) => r.displayName).sort();
    expect(names).toEqual(["other", "thing"]);
    expect(results.every((r) => r.kind === "archive")).toBe(true);
  });

  it("ignores dotfiles, __MACOSX, and partial-download suffixes", async () => {
    const dir = await mkTmp();
    await fs.mkdir(join(dir, ".hidden"), { recursive: true });
    await fs.mkdir(join(dir, "__MACOSX"), { recursive: true });
    await writeArchive(dir, "still-downloading.zip.crdownload");
    await writeArchive(dir, "firefox.zip.part");
    await writeArchive(dir, "real.skill");
    const results = await scanFolderForSkills(dir);
    expect(results).toHaveLength(1);
    expect(results[0].displayName).toBe("real");
  });

  it("returns mixed kinds and sorts newest first by mtime", async () => {
    const dir = await mkTmp();
    const folder = await writeSkillFolder(dir, "alpha-skill");
    const archive = await writeArchive(dir, "beta-skill.skill");
    // Backdate the folder so the archive is newer.
    const past = new Date(Date.now() - 86_400_000);
    await fs.utimes(folder, past, past);
    const results = await scanFolderForSkills(dir);
    expect(results.map((r) => r.displayName)).toEqual([
      "beta-skill",
      "alpha-skill",
    ]);
  });

  it("strips both .skill and .zip when deriving display name", async () => {
    const dir = await mkTmp();
    await writeArchive(dir, "mixed-case.SKILL");
    await writeArchive(dir, "another.ZIP");
    const results = await scanFolderForSkills(dir);
    const names = results.map((r) => r.displayName).sort();
    expect(names).toEqual(["another", "mixed-case"]);
  });
});
