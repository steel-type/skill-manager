import type { SkillManagerConfig } from "./types";

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
