// Skill format detection + normalization. Pure deterministic parsing — no
// LLM, no fuzzy matching. Reads files from a directory, decides which of
// the supported coding-agent skill formats it is, and produces a uniform
// {name, description, content} struct that downstream code can persist as
// a standard SKILL.md or hand to a deploy adapter.
//
// Supported source formats:
//   - "standard"   → SKILL.md with YAML frontmatter (Claude / Codex / Continue / Cline)
//   - "agents-md"  → AGENTS.md only (no SKILL.md alongside it)
//   - "cursor-mdc" → at least one *.mdc file with YAML frontmatter
//   - "cursorrules" → a plain-text .cursorrules file
//   - "clinerules" → a plain-text .clinerules file
//   - "unknown"    → throws with a helpful message listing the supported set

import { promises as fs } from "node:fs";
import { basename, join } from "node:path";
import { parseSkillFrontmatter } from "./skills";

export type SkillFormat =
  | "standard"
  | "agents-md"
  | "cursor-mdc"
  | "cursorrules"
  | "clinerules"
  | "unknown";

/**
 * Detection-priority list shared across the codebase. Anything in the
 * library that matches one of these entries is a real skill. Order is
 * load-bearing: SKILL.md wins outright when multiple are present (see
 * detectFormat below).
 *
 *  - kind `file`: presence of the named file (exact match).
 *  - kind `ext`:  presence of any file with the given extension.
 */
export const FORMAT_PRIORITY: ReadonlyArray<
  | { kind: "file"; name: string; format: Exclude<SkillFormat, "unknown" | "cursor-mdc"> }
  | { kind: "ext"; ext: string; format: "cursor-mdc" }
> = [
  { kind: "file", name: "SKILL.md", format: "standard" },
  { kind: "file", name: "AGENTS.md", format: "agents-md" },
  { kind: "ext", ext: ".mdc", format: "cursor-mdc" },
  { kind: "file", name: ".cursorrules", format: "cursorrules" },
  { kind: "file", name: ".clinerules", format: "clinerules" },
] as const;

/** Files that, when present at the root of a directory, mean the directory
 *  IS a skill (regardless of which agent's preferred format it uses).
 *  Includes the canonical exact names; `.mdc` files are matched separately
 *  via FORMAT_PRIORITY. Library scanners use this to decide whether a
 *  directory is a top-level skill versus a passive folder. */
export const SKILL_IDENTIFIER_FILES: ReadonlyArray<string> = FORMAT_PRIORITY
  .filter((e): e is Extract<typeof e, { kind: "file" }> => e.kind === "file")
  .map((e) => e.name);

export interface NormalizedSkill {
  name: string;
  description: string;
  /** Body text — the instruction/skill content with frontmatter stripped. */
  content: string;
  /** Which source format the directory was detected as. */
  sourceFormat: SkillFormat;
  /** The on-disk file paths that fed the normalization (rooted at the
   *  directory passed in, expressed as relative names). */
  originalFiles: string[];
}

export class UnknownSkillFormatError extends Error {
  constructor(directory: string) {
    super(
      `No recognised skill files found in ${directory}. ` +
        `Expected one of: SKILL.md, AGENTS.md, *.mdc, .cursorrules, .clinerules.`,
    );
    this.name = "UnknownSkillFormatError";
  }
}

interface DirEntry {
  name: string;
  isFile: boolean;
}

async function safeReaddir(dir: string): Promise<DirEntry[]> {
  try {
    const items = await fs.readdir(dir, { withFileTypes: true });
    return items.map((d) => ({ name: d.name, isFile: d.isFile() }));
  } catch {
    return [];
  }
}

/**
 * Inspect a directory and decide which skill format it represents. The
 * detection order matters: SKILL.md wins outright (a directory containing
 * both SKILL.md and AGENTS.md is "standard", not "agents-md") because the
 * standard format is the lossless canonical form we want to preserve.
 */
export async function detectFormat(directory: string): Promise<SkillFormat> {
  const entries = await safeReaddir(directory);
  const names = new Set(entries.filter((e) => e.isFile).map((e) => e.name));
  for (const rule of FORMAT_PRIORITY) {
    if (rule.kind === "file" && names.has(rule.name)) return rule.format;
    if (
      rule.kind === "ext" &&
      entries.some((e) => e.isFile && e.name.endsWith(rule.ext))
    ) {
      return rule.format;
    }
  }
  return "unknown";
}

function fallbackNameFromDir(directory: string): string {
  // basename strips trailing / so "/a/b/" → "b". Empty dirname → fallback.
  const name = basename(directory.replace(/\/+$/, ""));
  return name || "skill";
}

function firstHeading(body: string): string | null {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("# ")) return line.slice(2).trim();
  }
  return null;
}

function firstParagraph(body: string): string {
  const lines = body.split(/\r?\n/);
  const collected: string[] = [];
  let started = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#")) continue; // skip headings
    if (line === "") {
      if (started) break;
      continue;
    }
    started = true;
    collected.push(line);
  }
  return collected.join(" ").trim();
}

function trimToShortDescription(s: string, max = 140): string {
  const collapsed = s.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

/** Read the body of a SKILL.md / AGENTS.md, with the YAML frontmatter
 *  block (`---\n…\n---\n`) sliced off if present. */
async function readBodyAfterFrontmatter(filePath: string): Promise<string> {
  const text = await fs.readFile(filePath, "utf8");
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("---", 3);
  if (end === -1) return text;
  return text.slice(end + 3).replace(/^\r?\n/, "");
}

async function parseStandard(
  directory: string,
): Promise<NormalizedSkill> {
  const file = join(directory, "SKILL.md");
  const front = await parseSkillFrontmatter(file);
  const body = await readBodyAfterFrontmatter(file);
  const name = front.name?.trim() || fallbackNameFromDir(directory);
  const description =
    front.description?.trim() || trimToShortDescription(firstParagraph(body));
  return {
    name,
    description,
    content: body,
    sourceFormat: "standard",
    originalFiles: ["SKILL.md"],
  };
}

async function parseAgentsMd(
  directory: string,
): Promise<NormalizedSkill> {
  const file = join(directory, "AGENTS.md");
  const text = await fs.readFile(file, "utf8");
  const heading = firstHeading(text);
  const name = heading || fallbackNameFromDir(directory);
  const description = trimToShortDescription(firstParagraph(text));
  return {
    name,
    description,
    content: text,
    sourceFormat: "agents-md",
    originalFiles: ["AGENTS.md"],
  };
}

interface McdFrontmatter {
  description?: string;
  globs?: string;
  alwaysApply?: string;
}

function parseMcdFrontmatter(text: string): {
  front: McdFrontmatter;
  body: string;
} {
  if (!text.startsWith("---")) return { front: {}, body: text };
  const end = text.indexOf("---", 3);
  if (end === -1) return { front: {}, body: text };
  const yamlText = text.slice(3, end).trim();
  const body = text.slice(end + 3).replace(/^\r?\n/, "");
  const front: McdFrontmatter = {};
  for (const raw of yamlText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "description") front.description = value;
    else if (key === "globs") front.globs = value;
    else if (key === "alwaysApply") front.alwaysApply = value;
  }
  return { front, body };
}

async function parseCursorMdc(
  directory: string,
): Promise<NormalizedSkill> {
  const entries = await safeReaddir(directory);
  const mdcFiles = entries
    .filter((e) => e.isFile && e.name.endsWith(".mdc"))
    .map((e) => e.name)
    .sort();
  if (mdcFiles.length === 0) {
    throw new UnknownSkillFormatError(directory);
  }
  // If there's exactly one .mdc, use it directly. If there are several, the
  // skill is multi-rule — concatenate all bodies, derive the description
  // from the first file's frontmatter, and name from the directory.
  const sections: string[] = [];
  let firstDescription = "";
  for (const file of mdcFiles) {
    const raw = await fs.readFile(join(directory, file), "utf8");
    const { front, body } = parseMcdFrontmatter(raw);
    if (!firstDescription && front.description) {
      firstDescription = front.description;
    }
    sections.push(`## ${file}\n\n${body.trim()}`);
  }
  const name =
    mdcFiles.length === 1
      ? mdcFiles[0].replace(/\.mdc$/, "")
      : fallbackNameFromDir(directory);
  const description =
    firstDescription || trimToShortDescription(firstParagraph(sections.join("\n\n")));
  return {
    name,
    description,
    content: sections.join("\n\n"),
    sourceFormat: "cursor-mdc",
    originalFiles: mdcFiles,
  };
}

async function parsePlainRules(
  directory: string,
  filename: ".cursorrules" | ".clinerules",
  format: "cursorrules" | "clinerules",
): Promise<NormalizedSkill> {
  const file = join(directory, filename);
  const text = await fs.readFile(file, "utf8");
  const heading = firstHeading(text);
  const name = heading || fallbackNameFromDir(directory);
  // Plain rules files don't have a structured description field — synthesize
  // one from the first non-empty line, capped to 100 chars per the spec.
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const description = trimToShortDescription(firstLine, 100);
  return {
    name,
    description,
    content: text,
    sourceFormat: format,
    originalFiles: [filename],
  };
}

/**
 * Detect the format of `directory` and return the normalized skill. Throws
 * UnknownSkillFormatError when no recognised file is present.
 */
export async function normalizeSkillDirectory(
  directory: string,
): Promise<NormalizedSkill> {
  const format = await detectFormat(directory);
  switch (format) {
    case "standard":
      return parseStandard(directory);
    case "agents-md":
      return parseAgentsMd(directory);
    case "cursor-mdc":
      return parseCursorMdc(directory);
    case "cursorrules":
      return parsePlainRules(directory, ".cursorrules", "cursorrules");
    case "clinerules":
      return parsePlainRules(directory, ".clinerules", "clinerules");
    case "unknown":
      throw new UnknownSkillFormatError(directory);
  }
}

/**
 * Render a NormalizedSkill back out as the canonical SKILL.md format so the
 * library has a uniform on-disk representation. Used when the user opts to
 * "convert this repo to standard SKILL.md" after install.
 */
export function renderStandardSkillMd(skill: NormalizedSkill): string {
  const escapedDesc = skill.description.replace(/"/g, '\\"');
  // Always emit a frontmatter block — even when fields are empty — so
  // downstream parsers that hard-require it stay happy.
  return [
    "---",
    `name: ${skill.name}`,
    `description: "${escapedDesc}"`,
    "---",
    "",
    skill.content.trimStart(),
  ].join("\n");
}
