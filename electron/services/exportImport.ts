import type { Skill, SkillManagerConfig } from "./types";

export interface SkillJsonEntry {
  name: string;
  url: string;
  commit?: string | null;
  description?: string;
}

export interface SkillJsonDoc {
  version: 1;
  exported_at: string;
  skills: SkillJsonEntry[];
}

/**
 * Build a structured JSON snapshot of the library for sharing. Local-only
 * skills (no `url`) are skipped — they can't be re-installed by a recipient.
 * Description comes from disk-detected metadata when available so receivers
 * can preview what they're importing without cloning.
 */
export function exportSkillJson(
  config: SkillManagerConfig,
  skillsOnDisk: Skill[] = [],
): SkillJsonDoc {
  const descByName = new Map<string, string>();
  for (const s of skillsOnDisk) {
    if (s.description) descByName.set(s.name, s.description);
  }
  const records = config.skills ?? {};
  const entries: SkillJsonEntry[] = Object.keys(records)
    .sort((a, b) => a.localeCompare(b))
    .filter((name) => !!records[name].url)
    .map((name) => {
      const record = records[name];
      const description = descByName.get(name);
      return {
        name,
        url: record.url!,
        commit: record.commit ?? null,
        ...(description ? { description } : {}),
      };
    });
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    skills: entries,
  };
}

/**
 * Parse a structured JSON skill list back into entries. Tolerant of two
 * shapes: the v1 doc `{ version, skills: [...] }` and a bare array of
 * entries, since hand-edited shares sometimes drop the wrapper. Entries
 * without a usable `url` are skipped.
 */
export function parseSkillJson(text: string): SkillJsonEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON");
  }
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { skills?: unknown }).skills)
      ? ((raw as { skills: unknown[] }).skills)
      : [];
  if (list.length === 0 && !Array.isArray(raw)) {
    throw new Error("Missing 'skills' array");
  }
  const out: SkillJsonEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    const url = typeof obj.url === "string" ? obj.url.trim() : "";
    if (!name || !url) continue;
    const entry: SkillJsonEntry = { name, url };
    if (typeof obj.commit === "string" && obj.commit.trim()) {
      entry.commit = obj.commit.trim();
    }
    if (typeof obj.description === "string" && obj.description.trim()) {
      entry.description = obj.description.trim();
    }
    out.push(entry);
  }
  return out;
}

/**
 * Generate a shareable markdown bullet list of the user's library. Skills
 * with a source URL render as `[name](url)`; local-only skills render as
 * `name *(local)*`.
 */
export function exportSkillList(config: SkillManagerConfig): string {
  const skills = config.skills ?? {};
  const names = Object.keys(skills).sort((a, b) => a.localeCompare(b));
  const lines: string[] = ["# My Claude Skills", ""];
  for (const name of names) {
    const url = skills[name].url;
    if (url) lines.push(`- [${name}](${url})`);
    else lines.push(`- ${name} *(local)*`);
  }
  lines.push("");
  const today = new Date().toISOString().slice(0, 10);
  const count = names.length;
  lines.push(
    `*Exported ${today} — ${count} skill${count === 1 ? "" : "s"}*`,
  );
  lines.push("");
  return lines.join("\n");
}

/**
 * Parse a markdown skill list back into entries. Matches markdown links of
 * the form `[name](url)`. Skills without a URL (the `*(local)*` form) are
 * skipped — they cannot be re-installed without a source.
 */
export function parseSkillList(
  text: string,
): { name: string; url: string }[] {
  const results: { name: string; url: string }[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const name = match[1].trim();
    const url = match[2].trim();
    if (url) results.push({ name, url });
  }
  return results;
}
