import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { CONFIG_PATH, getLibraryPath } from "./paths";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type Deployment,
  type SkillManagerConfig,
  type SkillRecord,
  type SkillStack,
  type StackDeployment,
} from "./types";

export function nowIso(): string {
  // Drop milliseconds for compactness but KEEP the trailing Z. Without the
  // Z, JavaScript's Date parser treats the string as local time (per ECMA),
  // which made every snapshot's relative time read as "just now" because
  // a UTC stamp parsed-as-local lands in the future relative to Date.now().
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
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
  stacks?: SkillStack[];
  stackDeployments?: StackDeployment[];
}

function withDefaults(partial?: Partial<AppSettings>): AppSettings {
  return { ...DEFAULT_SETTINGS, ...(partial ?? {}) };
}

/**
 * Backfill `record.deployments` from the legacy `record.projects` list when
 * an older config (or one written by the previous TS app version) only has
 * the string-array form. Each synthesized entry defaults to claude/copy —
 * the safest interpretation, since that's what the app did before agents
 * and symlinks existed. The original projects array is left intact so any
 * downgrade path still reads the same.
 */
function migrateDeployments(
  skills: Record<string, SkillRecord>,
): Record<string, SkillRecord> {
  for (const record of Object.values(skills)) {
    if (record.deployments && record.deployments.length > 0) continue;
    if (!record.projects || record.projects.length === 0) {
      record.deployments = record.deployments ?? [];
      continue;
    }
    const synthesized: Deployment[] = record.projects.map((projectPath) => ({
      projectPath,
      agentId: "claude",
      deployMode: "copy",
      // Use the install/update time as the deploy timestamp — closer to
      // truth than nowIso() since we have no record of the actual deploy.
      deployedAt:
        record.updated_at ?? record.installed_at ?? nowIso(),
    }));
    record.deployments = synthesized;
  }
  return skills;
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
      skills: migrateDeployments(raw.skills),
      settings: withDefaults(raw.settings),
      stacks: raw.stacks ?? [],
      stackDeployments: raw.stackDeployments ?? [],
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
    stacks: raw.stacks ?? [],
    stackDeployments: raw.stackDeployments ?? [],
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

    // Stack meta-skills are staged in LIBRARY_PATH for symlink support, but
    // they are not regular skills — exclude them from the config.skills set.
    const stackIds = new Set((config.stacks ?? []).map((s) => s.id));

    let dirEntries: string[] = [];
    try {
      const entries = await fs.readdir(getLibraryPath(), { withFileTypes: true });
      dirEntries = entries
        .filter(
          (e) =>
            e.isDirectory() &&
            !e.name.startsWith(".") &&
            !stackIds.has(e.name),
        )
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
      if (record.deployments) {
        record.deployments = record.deployments.filter((d) =>
          alive.includes(d.projectPath),
        );
      }
    }

    const next: SkillManagerConfig = {
      last_project: config.last_project,
      skills,
      settings: config.settings,
      stacks: config.stacks ?? [],
      stackDeployments: config.stackDeployments ?? [],
    };
    await saveConfig(next);
    return next;
  });
}

export async function ensureLibraryDir(): Promise<void> {
  await fs.mkdir(getLibraryPath(), { recursive: true });
}
