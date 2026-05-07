import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectFormat,
  normalizeSkillDirectory,
  renderStandardSkillMd,
  UnknownSkillFormatError,
} from "./skillAdapter";

let testRoot: string;

beforeEach(async () => {
  testRoot = join(
    tmpdir(),
    `skill-adapter-test-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(testRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

async function plant(rel: string, content: string): Promise<void> {
  const target = join(testRoot, rel);
  await fs.mkdir(join(target, ".."), { recursive: true });
  await fs.writeFile(target, content);
}

describe("detectFormat", () => {
  it("detects standard from a SKILL.md", async () => {
    await plant("SKILL.md", "---\nname: x\n---\nbody");
    expect(await detectFormat(testRoot)).toBe("standard");
  });

  it("detects agents-md when only AGENTS.md is present", async () => {
    await plant("AGENTS.md", "# Hello\n\nbody");
    expect(await detectFormat(testRoot)).toBe("agents-md");
  });

  it("prefers SKILL.md when both SKILL.md and AGENTS.md exist", async () => {
    await plant("SKILL.md", "skill");
    await plant("AGENTS.md", "agents");
    expect(await detectFormat(testRoot)).toBe("standard");
  });

  it("detects cursor-mdc when at least one *.mdc file is present", async () => {
    await plant("rule.mdc", "---\ndescription: foo\n---\nbody");
    expect(await detectFormat(testRoot)).toBe("cursor-mdc");
  });

  it("detects cursorrules from a plain .cursorrules file", async () => {
    await plant(".cursorrules", "do the thing");
    expect(await detectFormat(testRoot)).toBe("cursorrules");
  });

  it("detects clinerules from a plain .clinerules file", async () => {
    await plant(".clinerules", "be cline");
    expect(await detectFormat(testRoot)).toBe("clinerules");
  });

  it("returns 'unknown' for an empty directory", async () => {
    expect(await detectFormat(testRoot)).toBe("unknown");
  });

  it("returns 'unknown' for a non-existent directory", async () => {
    expect(await detectFormat(join(testRoot, "nope"))).toBe("unknown");
  });
});

describe("normalizeSkillDirectory — standard", () => {
  it("extracts name + description from frontmatter and body content", async () => {
    await plant(
      "SKILL.md",
      `---\nname: pdf-tools\ndescription: parse and assemble PDFs\n---\n\n# PDF tools\n\nhelpful body.`,
    );
    const out = await normalizeSkillDirectory(testRoot);
    expect(out.name).toBe("pdf-tools");
    expect(out.description).toBe("parse and assemble PDFs");
    expect(out.content).toContain("# PDF tools");
    expect(out.sourceFormat).toBe("standard");
    expect(out.originalFiles).toEqual(["SKILL.md"]);
  });

  it("falls back to directory basename when frontmatter has no name", async () => {
    await plant("SKILL.md", "---\ndescription: hi\n---\n\nbody");
    const out = await normalizeSkillDirectory(testRoot);
    expect(out.name).toBe(join(testRoot).split("/").pop());
  });

  it("synthesizes a description from the first paragraph when frontmatter omits it", async () => {
    await plant(
      "SKILL.md",
      "---\nname: x\n---\n\nFirst sentence describes things.\n\nSecond paragraph follows.",
    );
    const out = await normalizeSkillDirectory(testRoot);
    expect(out.description).toBe("First sentence describes things.");
  });
});

describe("normalizeSkillDirectory — agents-md", () => {
  it("uses the first markdown heading as the name", async () => {
    await plant(
      "AGENTS.md",
      "# Codex Helper\n\nHelps run codex skills inside your editor.",
    );
    const out = await normalizeSkillDirectory(testRoot);
    expect(out.name).toBe("Codex Helper");
    expect(out.description).toBe(
      "Helps run codex skills inside your editor.",
    );
    expect(out.content).toContain("# Codex Helper");
    expect(out.sourceFormat).toBe("agents-md");
  });

  it("falls back to directory basename when no heading is present", async () => {
    await plant("AGENTS.md", "Just plain text with no heading.");
    const out = await normalizeSkillDirectory(testRoot);
    expect(out.name).toBe(testRoot.split("/").pop());
  });
});

describe("normalizeSkillDirectory — cursor-mdc", () => {
  it("parses .mdc frontmatter and uses description + body content", async () => {
    await plant(
      "rule.mdc",
      `---\ndescription: lint TS files\nglobs: *.ts\nalwaysApply: true\n---\n\nHere is the rule body.`,
    );
    const out = await normalizeSkillDirectory(testRoot);
    expect(out.description).toBe("lint TS files");
    expect(out.content).toContain("Here is the rule body");
    expect(out.sourceFormat).toBe("cursor-mdc");
    expect(out.originalFiles).toEqual(["rule.mdc"]);
    // Single .mdc → name from filename.
    expect(out.name).toBe("rule");
  });

  it("concatenates multiple .mdc files with a section header per file", async () => {
    await plant(
      "first.mdc",
      `---\ndescription: first rule\n---\nbody one`,
    );
    await plant("second.mdc", "no frontmatter, just body two");
    const out = await normalizeSkillDirectory(testRoot);
    expect(out.originalFiles.sort()).toEqual(["first.mdc", "second.mdc"]);
    expect(out.content).toContain("first.mdc");
    expect(out.content).toContain("second.mdc");
    expect(out.description).toBe("first rule");
    // Multi-mdc → name from directory.
    expect(out.name).toBe(testRoot.split("/").pop());
  });
});

describe("normalizeSkillDirectory — plain rules", () => {
  it("uses the first line as a 100-char description for .cursorrules", async () => {
    const longLine =
      "Always be polite, lint as you go, run typecheck before any commit, and keep imports sorted alphabetically forever.";
    await plant(".cursorrules", `${longLine}\n\nMore detail below.`);
    const out = await normalizeSkillDirectory(testRoot);
    expect(out.sourceFormat).toBe("cursorrules");
    expect(out.description.length).toBeLessThanOrEqual(100);
    // Truncated → ends with the ellipsis sentinel.
    expect(out.description.endsWith("…")).toBe(true);
  });

  it("uses the directory basename as the name for plain-text rule files", async () => {
    await plant(".clinerules", "Be helpful.");
    const out = await normalizeSkillDirectory(testRoot);
    expect(out.sourceFormat).toBe("clinerules");
    expect(out.name).toBe(testRoot.split("/").pop());
    expect(out.description).toBe("Be helpful.");
    expect(out.content).toBe("Be helpful.");
  });
});

describe("normalizeSkillDirectory — unknown", () => {
  it("throws UnknownSkillFormatError when no recognised file is present", async () => {
    await plant("README.md", "this is not a skill");
    await expect(normalizeSkillDirectory(testRoot)).rejects.toBeInstanceOf(
      UnknownSkillFormatError,
    );
  });

  it("error message lists the supported formats", async () => {
    await plant("notes.txt", "x");
    await expect(normalizeSkillDirectory(testRoot)).rejects.toThrow(
      /SKILL\.md.*AGENTS\.md.*\.mdc.*\.cursorrules.*\.clinerules/s,
    );
  });
});

describe("renderStandardSkillMd", () => {
  it("emits a SKILL.md with frontmatter that round-trips back through normalize", async () => {
    const original = {
      name: "round-trip",
      description: "a skill that exists to be re-parsed",
      content: "Real body text\nwith two lines.",
      sourceFormat: "standard" as const,
      originalFiles: ["SKILL.md"],
    };
    const md = renderStandardSkillMd(original);
    await fs.writeFile(join(testRoot, "SKILL.md"), md);
    const parsed = await normalizeSkillDirectory(testRoot);
    expect(parsed.name).toBe(original.name);
    expect(parsed.description).toBe(original.description);
    expect(parsed.content.trim()).toBe(original.content);
  });

  it("escapes quote characters in description so the YAML stays valid", () => {
    const md = renderStandardSkillMd({
      name: "x",
      description: 'has a "quote" inside',
      content: "body",
      sourceFormat: "standard",
      originalFiles: [],
    });
    // The raw YAML line must not break out of the quoted value early —
    // every embedded quote should be backslash-escaped.
    expect(md).toContain('description: "has a \\"quote\\" inside"');
  });
});
