import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { CONFIG_PATH, LIBRARY_PATH } from "./paths";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type SkillManagerConfig,
  type SkillRecord,
} from "./types";

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "");
}

function emptyRecord(): SkillRecord {
  return {
    url: null,
    commit: null,
    installed_at: nowIso(),
    updated_at: null,
    projects: [],
  };
}

interface RawConfig {
  last_project?: string;
  skills?: Record<string, SkillRecord>;
  installed_skills?: { name?: string; url?: string }[];
  settings?: Partial<AppSettings>;
}

function withDefaults(partial?: Partial<AppSettings>): AppSettings {
  return { ...DEFAULT_SETTINGS, ...(partial ?? {}) };
}

/**
 * Process-wide lock around the read-modify-write loop. Multiple parallel
 * config writes (auto-check + user click + reconcile, etc.) would otherwise
 * silently drop the loser's edits. The lock is a Promise chain — each caller
 * `await`s the previous and replaces the tail, so order is FIFO.
 */
let configMutex: Promise<unknown> = Promise.resolve();

export function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = configMutex.then(fn, fn);
  // `.catch(() => {})` keeps a single rejected operation from poisoning all
  // subsequent locks — they should still run regardless.
  configMutex = next.catch(() => undefined);
  return next;
}

/**
 * Load config, auto-migrating from the original Python app's older flat-list
 * format (`installed_skills[]`) to the current keyed map (`skills{}`), and
 * filling in any missing `settings` keys with defaults.
 *
 * If the file exists but is corrupt (invalid JSON), back it up to a sibling
 * `.corrupt-<timestamp>` and start with an empty config rather than crashing
 * the whole app on bootstrap.
 */
export async function loadConfig(): Promise<SkillManagerConfig> {
  let raw: RawConfig = {};
  try {
    const text = await fs.readFile(CONFIG_PATH, "utf8");
    try {
      raw = JSON.parse(text) as RawConfig;
    } catch (err) {
      // Corrupt file — preserve it so the user can recover anything they
      // care about, then proceed with a fresh config. Reconcile will
      // re-discover skills from `~/.claude/skills/` on disk.
      const backup = `${CONFIG_PATH}.corrupt-${Date.now()}`;
      try {
        await fs.rename(CONFIG_PATH, backup);
      } catch {
        // best effort; if rename fails we still recover from in-memory empty
      }
      console.warn(
        `[skill-manager] config was corrupt; backed up to ${backup}: ${err instanceof Error ? err.message : err}`,
      );
      raw = {};
    }
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw err;
    }
  }

  if (raw.skills) {
    return {
      last_project: raw.last_project ?? "",
      skills: raw.skills,
      settings: withDefaults(raw.settings),
    };
  }

  // Migrate: installed_skills[] → skills{}
  const skills: Record<string, SkillRecord> = {};
  for (const entry of raw.installed_skills ?? []) {
    if (!entry.name) continue;
    skills[entry.name] = {
      url: entry.url ?? null,
      commit: null,
      installed_at: nowIso(),
      updated_at: nowIso(),
      projects: [],
    };
  }
  return {
    last_project: raw.last_project ?? "",
    skills,
    settings: withDefaults(raw.settings),
  };
}

/**
 * Atomic config write: serialise to a sibling `.tmp` first, fsync-ish via
 * close, then rename onto the canonical path. Crashes mid-write leave the
 * existing config intact.
 */
export async function saveConfig(config: SkillManagerConfig): Promise<void> {
  await fs.mkdir(dirname(CONFIG_PATH), { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(config, null, 2), "utf8");
    await fs.rename(tmp, CONFIG_PATH);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Sync config with what's actually on disk. Add config entries for skills
 * that exist in the library but not config; remove config entries for skills
 * whose library directory has been deleted; prune project paths that no
 * longer resolve to a directory.
 */
export async function reconcileConfig(
  config: SkillManagerConfig,
): Promise<SkillManagerConfig> {
  return await withConfigLock(async () => {
    const skills = { ...config.skills };

    let dirEntries: string[] = [];
    try {
      const entries = await fs.readdir(LIBRARY_PATH, { withFileTypes: true });
      dirEntries = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name);
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        throw err;
      }
    }

    for (const name of dirEntries) {
      if (!skills[name]) skills[name] = emptyRecord();
    }

    for (const name of Object.keys(skills)) {
      if (!dirEntries.includes(name)) delete skills[name];
    }

    for (const record of Object.values(skills)) {
      const alive: string[] = [];
      for (const p of record.projects) {
        try {
          const stat = await fs.stat(p);
          if (stat.isDirectory()) alive.push(p);
        } catch {
          // skip
        }
      }
      record.projects = alive;
    }

    const next: SkillManagerConfig = {
      last_project: config.last_project,
      skills,
      settings: config.settings,
    };
    await saveConfig(next);
    return next;
  });
}

export async function ensureLibraryDir(): Promise<void> {
  await fs.mkdir(LIBRARY_PATH, { recursive: true });
}
