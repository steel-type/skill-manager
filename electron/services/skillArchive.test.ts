import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARCHIVE_EXTENSIONS,
  cleanupExtraction,
  extractArchive,
  findSkillRoot,
  isArchivePath,
  nameFromArchivePath,
} from "./skillArchive";

const made: string[] = [];
afterEach(async () => {
  while (made.length) await fs.rm(made.pop()!, { recursive: true, force: true });
});

async function mkTmp(): Promise<string> {
  const d = await fs.mkdtemp(join(tmpdir(), "skillbase-test-"));
  made.push(d);
  return d;
}

describe("isArchivePath", () => {
  it("recognises .zip and .skill, case-insensitively", () => {
    expect(isArchivePath("/a/b/foo.zip")).toBe(true);
    expect(isArchivePath("/a/b/foo.skill")).toBe(true);
    expect(isArchivePath("/a/b/FOO.SKILL")).toBe(true);
    expect(isArchivePath("/a/b/foo")).toBe(false);
    expect(isArchivePath("/a/b/foo.tar.gz")).toBe(false);
  });
  it("exposes both extensions", () => {
    expect(ARCHIVE_EXTENSIONS).toContain(".zip");
    expect(ARCHIVE_EXTENSIONS).toContain(".skill");
  });
});

describe("nameFromArchivePath", () => {
  it("strips archive extensions but leaves plain folder names", () => {
    expect(nameFromArchivePath("/x/my-skill.zip")).toBe("my-skill");
    expect(nameFromArchivePath("/x/my-skill.skill")).toBe("my-skill");
    expect(nameFromArchivePath("/x/my-skill")).toBe("my-skill");
    expect(nameFromArchivePath("/x/my-skill/")).toBe("my-skill");
  });
});

describe("findSkillRoot", () => {
  it("finds SKILL.md at the root", async () => {
    const dir = await mkTmp();
    await fs.writeFile(join(dir, "SKILL.md"), "x");
    expect(await findSkillRoot(dir)).toBe(dir);
  });

  it("finds SKILL.md one folder deep (zip-wrapped case)", async () => {
    const dir = await mkTmp();
    const inner = join(dir, "my-skill");
    await fs.mkdir(inner);
    await fs.writeFile(join(inner, "SKILL.md"), "x");
    expect(await findSkillRoot(dir)).toBe(inner);
  });

  it("ignores __MACOSX noise and returns the real skill folder", async () => {
    const dir = await mkTmp();
    await fs.mkdir(join(dir, "__MACOSX"));
    const inner = join(dir, "real");
    await fs.mkdir(inner);
    await fs.writeFile(join(inner, "SKILL.md"), "x");
    expect(await findSkillRoot(dir)).toBe(inner);
  });

  it("returns null when there's no SKILL.md", async () => {
    const dir = await mkTmp();
    await fs.writeFile(join(dir, "README.md"), "x");
    expect(await findSkillRoot(dir)).toBeNull();
  });
});

describe("extractArchive round-trip", () => {
  it("extracts a real zip and locates the skill root", async () => {
    // Build a zip with the system `zip` if available; skip otherwise so CI
    // on a bare image doesn't fail spuriously.
    const { spawnSync } = await import("node:child_process");
    const hasZip = spawnSync("zip", ["--version"]).status === 0;
    if (!hasZip) return;

    const work = await mkTmp();
    const skillDir = join(work, "demo-skill");
    await fs.mkdir(skillDir);
    await fs.writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: demo-skill\ndescription: x\n---\n",
    );
    const zipPath = join(work, "demo.zip");
    const r = spawnSync("zip", ["-r", zipPath, "demo-skill"], { cwd: work });
    expect(r.status).toBe(0);

    const extracted = await extractArchive(zipPath);
    made.push(extracted);
    const root = await findSkillRoot(extracted);
    expect(root).not.toBeNull();
    const sk = await fs.readFile(join(root!, "SKILL.md"), "utf8");
    expect(sk).toContain("name: demo-skill");
    await cleanupExtraction(extracted);
  });
});
