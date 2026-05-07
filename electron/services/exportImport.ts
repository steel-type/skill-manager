import type { Skill, SkillManagerConfig } from "./types";

/** Result type for the flexible importer. Some shapes carry only a URL,
 *  others (codex skill config) carry only a local path. Callers decide
 *  what to do with each kind. */
export interface ImportedSkill {
  name: string;
  /** Source URL when known. Null for local-path-only entries. */
  url: string | null;
  /** Filesystem path when the source was a local-skill config (codex). */
  localPath?: string;
  description?: string;
  commit?: string | null;
  /** Optional agent hint preserved from the source if present. */
  agent?: string;
  tags?: string[];
  enabled?: boolean;
}

export interface ImportParseResult {
  skills: ImportedSkill[];
  /** Lines (for plain-text input) or entries (for malformed JSON shapes)
   *  that were skipped, so the UI can report "imported X, skipped Y". */
  skipped: number;
  /** Which detection branch matched — handy for telling the user what was
   *  recognised when a paste doesn't import as expected. */
  detectedFormat:
    | "native"
    | "bare-array"
    | "codex-config"
    | "skills-array"
    | "url-map"
    | "url-lines"
    | "unknown";
}

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

const SUPPORTED_FORMATS_HELP = [
  "supported import shapes:",
  "  • native: { version: 1, skills: [{ name, url }, ...] }",
  "  • bare array: [{ name, url }, ...]",
  "  • codex config: { skills: { config: [{ path, enabled }, ...] } }",
  "  • skills array w/ metadata: { skills: [{ name, url, description, agent, tags }, ...] }",
  "  • url map: { \"skill-name\": \"https://github.com/...\", ... }",
  "  • plain text: one GitHub URL per line",
].join("\n");

const URL_LINE_RE = /^https?:\/\/\S+$/;

function nameFromUrl(url: string): string {
  // Strip query/fragment, then take the last meaningful path segment with
  // any .git suffix removed. Falls back to the URL itself for weird inputs.
  const cleaned = url.split(/[?#]/)[0].replace(/\/+$/, "");
  const segments = cleaned.split("/");
  const last = segments[segments.length - 1] ?? "";
  return last.replace(/\.git$/i, "") || url;
}

function nameFromPath(path: string): string {
  const cleaned = path.replace(/\/+$/, "");
  const segments = cleaned.split("/");
  return segments[segments.length - 1] || path;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function pickStringArray(
  obj: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const v = obj[key];
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length > 0 ? out : undefined;
}

function fromGenericSkillEntry(item: unknown): ImportedSkill | null {
  if (!isPlainObject(item)) return null;
  const name = pickString(item, "name");
  const url = pickString(item, "url");
  // Both are required for installable entries — we drop entries that have
  // neither rather than fabricate placeholder names.
  if (!name || !url) return null;
  const out: ImportedSkill = { name, url };
  const description = pickString(item, "description");
  if (description) out.description = description;
  const commit = pickString(item, "commit");
  if (commit) out.commit = commit;
  const agent = pickString(item, "agent");
  if (agent) out.agent = agent;
  const tags = pickStringArray(item, "tags");
  if (tags) out.tags = tags;
  if (typeof item.enabled === "boolean") out.enabled = item.enabled;
  return out;
}

function fromUrlMap(
  obj: Record<string, unknown>,
): { skills: ImportedSkill[]; skipped: number } {
  const skills: ImportedSkill[] = [];
  let skipped = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== "string" || !URL_LINE_RE.test(value.trim())) {
      skipped += 1;
      continue;
    }
    const trimmedKey = key.trim();
    skills.push({
      name: trimmedKey || nameFromUrl(value.trim()),
      url: value.trim(),
    });
  }
  return { skills, skipped };
}

function fromCodexConfig(items: unknown[]): {
  skills: ImportedSkill[];
  skipped: number;
} {
  const skills: ImportedSkill[] = [];
  let skipped = 0;
  for (const raw of items) {
    if (!isPlainObject(raw)) {
      skipped += 1;
      continue;
    }
    const path = pickString(raw, "path");
    if (!path) {
      skipped += 1;
      continue;
    }
    const out: ImportedSkill = {
      name: nameFromPath(path),
      url: null,
      localPath: path,
    };
    if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
    skills.push(out);
  }
  return { skills, skipped };
}

function isUrlMap(obj: Record<string, unknown>): boolean {
  // Treat as a URL map when every value is a string that looks like a URL.
  // Empty objects don't count — they're ambiguous and we want a clearer
  // error when the user pastes nothing useful.
  const values = Object.values(obj);
  if (values.length === 0) return false;
  return values.every(
    (v) => typeof v === "string" && URL_LINE_RE.test(v.trim()),
  );
}

/**
 * Detect the shape of `raw` (a string the user pasted into the importer)
 * and extract installable skill entries. Returns the detected format plus
 * a count of skipped/malformed entries so the UI can report
 * "imported X, skipped Y".
 *
 * Recognised shapes (in detection order):
 *   1. JSON.parse succeeds:
 *      a. bare array              → "bare-array"
 *      b. { version, skills[] }   → "native"
 *      c. { skills: { config[] } } → "codex-config"
 *      d. { skills: [...] }        → "skills-array"
 *      e. { "name": "url", ... }   → "url-map"
 *   2. JSON.parse fails: each non-empty line that starts with http(s)://
 *      is taken as a plain URL → "url-lines"
 *   3. Nothing matches            → throws with a help string
 */
export function parseFlexibleImport(raw: string): ImportParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`Empty input.\n${SUPPORTED_FORMATS_HELP}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    parsed = undefined;
  }

  if (parsed !== undefined) {
    // Bare array of {name, url} entries.
    if (Array.isArray(parsed)) {
      const skills: ImportedSkill[] = [];
      let skipped = 0;
      for (const item of parsed) {
        const entry = fromGenericSkillEntry(item);
        if (entry) skills.push(entry);
        else skipped += 1;
      }
      return { skills, skipped, detectedFormat: "bare-array" };
    }

    if (isPlainObject(parsed)) {
      // Native v1 export: { version, skills: [...] }
      if (
        parsed.version === 1 &&
        Array.isArray(parsed.skills)
      ) {
        const skills: ImportedSkill[] = [];
        let skipped = 0;
        for (const item of parsed.skills) {
          const entry = fromGenericSkillEntry(item);
          if (entry) skills.push(entry);
          else skipped += 1;
        }
        return { skills, skipped, detectedFormat: "native" };
      }

      // Codex skill config: { skills: { config: [{ path, enabled }] } }
      const skillsField = parsed.skills;
      if (isPlainObject(skillsField) && Array.isArray(skillsField.config)) {
        const result = fromCodexConfig(skillsField.config);
        return { ...result, detectedFormat: "codex-config" };
      }

      // Generic { skills: [...] } with metadata fields.
      if (Array.isArray(skillsField)) {
        const skills: ImportedSkill[] = [];
        let skipped = 0;
        for (const item of skillsField) {
          const entry = fromGenericSkillEntry(item);
          if (entry) skills.push(entry);
          else skipped += 1;
        }
        return { skills, skipped, detectedFormat: "skills-array" };
      }

      // URL map: every value is a URL string.
      if (isUrlMap(parsed)) {
        const result = fromUrlMap(parsed);
        return { ...result, detectedFormat: "url-map" };
      }
    }

    // JSON parsed but didn't match any known shape — fall through to the
    // unknown-format error so the user sees the supported list.
    throw new Error(
      `Unrecognised JSON shape.\n${SUPPORTED_FORMATS_HELP}`,
    );
  }

  // Plain text fallback: one URL per line. Mixed valid/invalid lines are
  // tolerated — invalid lines counted as `skipped`.
  const lines = trimmed.split(/\r?\n/);
  const skills: ImportedSkill[] = [];
  let skipped = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!URL_LINE_RE.test(line)) {
      skipped += 1;
      continue;
    }
    skills.push({
      name: nameFromUrl(line),
      url: line,
    });
  }
  if (skills.length === 0) {
    throw new Error(
      `No GitHub URLs detected. Paste valid JSON or one URL per line.\n${SUPPORTED_FORMATS_HELP}`,
    );
  }
  return { skills, skipped, detectedFormat: "url-lines" };
}
