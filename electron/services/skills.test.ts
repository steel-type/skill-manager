import { describe, expect, it } from "vitest";
import { extractSkillName, parseSkillFrontmatter } from "./skills";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("extractSkillName", () => {
  it("extracts the last path component from a GitHub URL", () => {
    expect(
      extractSkillName("https://github.com/anthropic/anthropic-skills"),
    ).toBe("anthropic-skills");
  });

  it("strips a trailing .git suffix", () => {
    expect(
      extractSkillName("https://github.com/anthropic/skills.git"),
    ).toBe("skills");
  });

  it("handles a trailing slash", () => {
    expect(
      extractSkillName("https://github.com/anthropic/skills/"),
    ).toBe("skills");
  });

  it("handles multiple trailing slashes", () => {
    expect(
      extractSkillName("https://github.com/anthropic/skills///"),
    ).toBe("skills");
  });

  it("handles trailing slash + .git", () => {
    expect(
      extractSkillName("https://github.com/anthropic/skills.git/"),
    ).toBe("skills");
  });

  it("returns the original string when there is no slash", () => {
    expect(extractSkillName("plain-name")).toBe("plain-name");
  });

  it("does not decode URL-encoded path segments (defense in depth)", () => {
    // URL-encoded slashes should NOT be decoded — they stay literal so
    // they can't traverse out of the library directory.
    const result = extractSkillName(
      "https://github.com/foo/..%2Fevil",
    );
    expect(result).not.toContain("/");
    expect(result).toBe("..%2Fevil");
  });
});

describe("parseSkillFrontmatter", () => {
  const testDir = join(tmpdir(), `skill-manager-test-${process.pid}`);

  async function writeFile(name: string, content: string): Promise<string> {
    await fs.mkdir(testDir, { recursive: true });
    const p = join(testDir, name);
    await fs.writeFile(p, content);
    return p;
  }

  it("returns {} when the file does not exist", async () => {
    const result = await parseSkillFrontmatter(
      join(testDir, "does-not-exist.md"),
    );
    expect(result).toEqual({});
  });

  it("returns {} when there is no frontmatter", async () => {
    const p = await writeFile("plain.md", "# Just a heading\n\nbody here");
    expect(await parseSkillFrontmatter(p)).toEqual({});
  });

  it("parses simple key: value frontmatter", async () => {
    const p = await writeFile(
      "simple.md",
      `---\nname: pdf-tools\ndescription: parse PDFs\n---\n\n# body`,
    );
    expect(await parseSkillFrontmatter(p)).toEqual({
      name: "pdf-tools",
      description: "parse PDFs",
    });
  });

  it("strips matching quotes from values", async () => {
    const p = await writeFile(
      "quoted.md",
      `---\nname: "pdf-tools"\ndescription: 'parse PDFs'\n---\n`,
    );
    expect(await parseSkillFrontmatter(p)).toEqual({
      name: "pdf-tools",
      description: "parse PDFs",
    });
  });

  it("ignores unknown keys", async () => {
    const p = await writeFile(
      "extra.md",
      `---\nname: x\nrandom: should-not-appear\nlicense: MIT\n---\n`,
    );
    expect(await parseSkillFrontmatter(p)).toEqual({
      name: "x",
      license: "MIT",
    });
  });

  it("supports multi-line continuation values (>- style)", async () => {
    const p = await writeFile(
      "multi.md",
      `---\nname: x\ndescription: >-\n  this is a long description\n  on multiple lines\n---\n`,
    );
    const result = await parseSkillFrontmatter(p);
    expect(result.description).toContain("this is a long description");
    expect(result.description).toContain("on multiple lines");
  });

  it("returns {} when frontmatter is truly unterminated", async () => {
    // No closing `---` anywhere → parser bails. (Note: a stray `---` in a
    // YAML comment will be treated as the close — that's permissive but
    // matches the original Python parser's behaviour.)
    const p = await writeFile(
      "unterminated.md",
      `---\nname: x\ndescription: y`,
    );
    expect(await parseSkillFrontmatter(p)).toEqual({});
  });

  it("does not OOM on a multi-MB file (reads only first chunk)", async () => {
    // Build a file that's frontmatter + a 5 MB body of garbage
    const front =
      "---\nname: huge\ndescription: only the front matters\n---\n";
    const body = "x".repeat(5 * 1024 * 1024);
    const p = await writeFile("huge.md", front + body);
    const result = await parseSkillFrontmatter(p);
    expect(result).toEqual({
      name: "huge",
      description: "only the front matters",
    });
  });
});
