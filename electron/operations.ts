// High-level skill manager operations — composed from the services layer.
// Each function is the implementation behind an IPC handler.
//
// Two invariants enforced here:
//   1. Every user-supplied string passes through services/validators.ts
//      before it touches the filesystem or git. Defense-in-depth even though
//      the renderer is currently trusted.
//   2. Every read-modify-write of the config goes through `withConfigLock`
//      so parallel operations can't lose each other's edits.

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { LIBRARY_PATH } from "./services/paths";
import {
  loadConfig,
  saveConfig,
  reconcileConfig,
  ensureLibraryDir,
  nowIso,
  withConfigLock,
} from "./services/config";
import {
  listSkills as listSkillsFromDisk,
  extractSkillName,
  getSkillTree as getSkillTreeFromDisk,
} from "./services/skills";
import {
  cloneToLibrary,
  checkRemoteSha,
  CancelledError,
  type LogHandler,
} from "./services/git";

export { CancelledError } from "./services/git";

export interface OpOptions {
  onLog?: LogHandler;
  signal?: AbortSignal;
}
import {
  cascadeToDeployments,
  cascadeToProjects,
  copyToProject,
  deployToProject,
} from "./services/deploy";
import type { Deployment, DeployMode } from "./services/types";
import {
  exportSkillJson,
  exportSkillList,
  parseFlexibleImport,
  parseSkillList,
  type ImportParseResult,
  type SkillJsonDoc,
  type SkillJsonEntry,
} from "./services/exportImport";
import {
  archiveSkillVersion,
  clearHistory,
  listHistory,
  pruneHistory,
  reconcileHistory,
  restoreSnapshot,
  totalHistorySize,
} from "./services/history";
import {
  validateCommitToken,
  validateProjectPath,
  validateSkillName,
  validateUrl,
} from "./services/validators";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type ExportPayload,
  type HistoryEntry,
  type ImportEntry,
  type ImportSummary,
  type InstallResult,
  type RollbackResult,
  type Skill,
  type TrackedProject,
  type UpdateInfo,
  type UpdateResult,
} from "./services/types";

export async function bootstrap(): Promise<void> {
  await ensureLibraryDir();
  const config = await loadConfig();
  const reconciled = await reconcileConfig(config);

  // Drop snapshot directories that no skill in config references — these
  // accumulate when a skill is uninstalled outside the app or when retention
  // changes from N→0 mid-flight. Best-effort; never blocks bootstrap.
  try {
    const referenced = new Map<string, Set<string>>();
    for (const [name, record] of Object.entries(reconciled.skills)) {
      const set = new Set<string>();
      for (const snap of record.history ?? []) set.add(snap.commit);
      referenced.set(name, set);
    }
    const result = await reconcileHistory(referenced);
    if (result.removedDirs > 0) {
      console.log(
        `[skill-manager] reconciled history: dropped ${result.removedDirs} dir(s), freed ${(result.freedBytes / 1024 / 1024).toFixed(1)} MB`,
      );
    }
  } catch (err) {
    console.warn("[skill-manager] history reconcile failed:", err);
  }
}

export async function getHistorySize(): Promise<number> {
  return await totalHistorySize();
}

export async function getSkillTree(rawName: string) {
  const name = (await import("./services/validators")).validateSkillName(rawName);
  return await getSkillTreeFromDisk(name);
}

/**
 * Wipe every snapshot directory and clear the in-config history fields.
 * Returns the number of snapshots dropped (sum across all skills) and bytes
 * freed, for the toast/confirmation UI to display.
 */
export async function clearAllHistory(): Promise<{
  snapshotsCleared: number;
  freedBytes: number;
}> {
  const sizeBefore = await totalHistorySize();
  let snapshotsCleared = 0;

  await withConfigLock(async () => {
    const config = await loadConfig();
    for (const record of Object.values(config.skills)) {
      if (record.history?.length) snapshotsCleared += record.history.length;
      record.history = undefined;
    }
    await saveConfig(config);
  });

  // Recursively wipe the history tree. Done outside the config lock —
  // we've already detached the references, the disk delete is independent.
  await fs.rm(
    join(LIBRARY_PATH, "..", "skills-history"),
    { recursive: true, force: true },
  );

  return { snapshotsCleared, freedBytes: sizeBefore };
}

export async function listSkills(): Promise<Skill[]> {
  return await listSkillsFromDisk();
}

export async function installFromUrl(
  rawUrl: string,
  options: OpOptions = {},
): Promise<InstallResult> {
  const { onLog, signal } = options;
  const url = validateUrl(rawUrl);
  const repoNameRaw = extractSkillName(url);
  if (!repoNameRaw) {
    throw new Error(`Could not derive skill name from URL: ${url}`);
  }
  const repoName = validateSkillName(repoNameRaw);

  if (signal?.aborted) throw new CancelledError();

  // Pre-archive: snapshot the prior version if one exists. Done outside the
  // mutex so the long-running clone doesn't block other reads — only the
  // small RMW step at the end needs serialisation.
  const preConfig = await loadConfig();
  const retention = preConfig.settings.update_history_retention;
  const existing = preConfig.skills[repoName];
  let trimmedHistory = existing?.history ?? [];
  if (retention > 0 && existing) {
    const snapshot = await archiveSkillVersion(repoName, existing.commit);
    if (snapshot) {
      trimmedHistory = await pruneHistory(
        repoName,
        [...(existing.history ?? []), snapshot],
        retention,
      );
    }
  }

  onLog?.(`Installing ${repoName}…`);
  const { commit } = await cloneToLibrary(url, repoName, { onLog, signal });

  await withConfigLock(async () => {
    const config = await loadConfig();
    config.skills[repoName] = {
      url,
      commit,
      installed_at: existing?.installed_at ?? nowIso(),
      updated_at: nowIso(),
      projects: existing?.projects ?? [],
      history: trimmedHistory.length > 0 ? trimmedHistory : undefined,
    };
    await saveConfig(config);
  });

  // Detect bundle-ness for the modal preview
  const skills = await listSkillsFromDisk();
  const me = skills.find((s) => s.name === repoName);
  return {
    name: repoName,
    commit,
    isBundle: me?.isBundle ?? false,
    bundleSize: me?.bundleSize ?? 0,
  };
}

export async function checkUpdates(): Promise<Record<string, UpdateInfo>> {
  const config = await loadConfig();
  const entries = Object.entries(config.skills).filter(([_, r]) => !!r.url);
  const results = await Promise.all(
    entries.map(async ([name, record]) => {
      const remote = await checkRemoteSha(record.url!);
      return { name, current: record.commit, remote };
    }),
  );
  const out: Record<string, UpdateInfo> = {};
  for (const r of results) {
    if (!r.remote) continue;
    out[r.name] = {
      current: r.current,
      remote: r.remote,
      hasUpdate: r.remote !== r.current,
    };
  }
  return out;
}

export async function updateSkill(
  rawName: string,
  options: OpOptions = {},
): Promise<UpdateResult> {
  const { onLog, signal } = options;
  const name = validateSkillName(rawName);
  if (signal?.aborted) throw new CancelledError();
  const config = await loadConfig();
  const record = config.skills[name];
  if (!record) throw new Error(`Unknown skill: ${name}`);
  if (!record.url) {
    throw new Error(`${name} is local — no source URL to update from`);
  }
  const url = validateUrl(record.url);

  // Archive current version before clone overwrites it. Honours the
  // update_history_retention setting; a value of 0 skips archiving entirely.
  const retention = config.settings.update_history_retention;
  let trimmedHistory = record.history ?? [];
  if (retention > 0) {
    onLog?.(
      `Archiving current version (${record.commit ?? "unknown commit"})…`,
    );
    const snapshot = await archiveSkillVersion(name, record.commit);
    if (snapshot) {
      trimmedHistory = await pruneHistory(
        name,
        [...(record.history ?? []), snapshot],
        retention,
      );
    }
  }

  onLog?.(`Updating ${name}…`);
  const { commit } = await cloneToLibrary(url, name, { onLog, signal });

  let updated: string[] = [];
  let failed: string[] = [];
  if (config.settings.cascade_updates) {
    const deployments = record.deployments ?? [];
    onLog?.(`Cascading update to ${deployments.length} deployment(s)…`);
    const cascade = await cascadeToDeployments(name, deployments);
    updated = cascade.updated;
    failed = cascade.failed;
    for (const p of updated) onLog?.(`  ✓ ${p}`);
    for (const p of cascade.skipped)
      onLog?.(`  ⤵ ${p} (symlink — picks up update via library)`);
    for (const p of failed) onLog?.(`  ✗ ${p} (skipped)`);
  } else {
    onLog?.(`Cascade disabled in settings — projects not re-deployed`);
  }

  await withConfigLock(async () => {
    const fresh = await loadConfig();
    const r = fresh.skills[name];
    if (r) {
      r.commit = commit;
      r.updated_at = nowIso();
      r.history = trimmedHistory.length > 0 ? trimmedHistory : undefined;
    }
    await saveConfig(fresh);
  });

  return { name, commit, cascadedTo: updated, failedProjects: failed };
}

export async function listSkillHistory(rawName: string): Promise<HistoryEntry[]> {
  const name = validateSkillName(rawName);
  const config = await loadConfig();
  const record = config.skills[name];
  if (!record) return [];
  return await listHistory(name, record.history);
}

export async function rollbackSkill(
  rawName: string,
  rawCommit: string,
  opts: { cascade: boolean },
  options: OpOptions = {},
): Promise<RollbackResult> {
  const { onLog, signal } = options;
  const name = validateSkillName(rawName);
  const commit = validateCommitToken(rawCommit);
  if (!commit) throw new Error("Commit token is empty");
  if (signal?.aborted) throw new CancelledError();

  const config = await loadConfig();
  const record = config.skills[name];
  if (!record) throw new Error(`Unknown skill: ${name}`);
  const history = record.history ?? [];
  const target = history.find((h) => h.commit === commit);
  if (!target) {
    throw new Error(`Snapshot not found in history: ${commit}`);
  }

  const retention = config.settings.update_history_retention;
  let nextHistory = history.filter((h) => h.commit !== commit);
  if (retention > 0) {
    onLog?.(
      `Archiving current version (${record.commit ?? "unknown commit"})…`,
    );
    const snapshot = await archiveSkillVersion(name, record.commit);
    if (snapshot) {
      nextHistory = await pruneHistory(name, [...nextHistory, snapshot], retention);
    }
  }

  onLog?.(`Restoring ${name} @ ${commit}…`);
  await restoreSnapshot(name, commit);

  let updated: string[] = [];
  let failed: string[] = [];
  if (opts.cascade) {
    const deployments = record.deployments ?? [];
    onLog?.(`Cascading rollback to ${deployments.length} deployment(s)…`);
    const cascade = await cascadeToDeployments(name, deployments);
    updated = cascade.updated;
    failed = cascade.failed;
    for (const p of updated) onLog?.(`  ✓ ${p}`);
    for (const p of cascade.skipped)
      onLog?.(`  ⤵ ${p} (symlink — already on rolled-back version)`);
    for (const p of failed) onLog?.(`  ✗ ${p} (skipped)`);
  }

  await withConfigLock(async () => {
    const fresh = await loadConfig();
    const r = fresh.skills[name];
    if (r) {
      r.commit = commit;
      r.updated_at = nowIso();
      r.history = nextHistory.length > 0 ? nextHistory : undefined;
    }
    await saveConfig(fresh);
  });

  return { name, commit, cascadedTo: updated, failedProjects: failed };
}

export interface DeploySkillOptions {
  agentId?: string;
  deployMode?: DeployMode;
}

export interface DeploySkillResult {
  agentId: string;
  deployMode: DeployMode;
  warning: string | null;
  /** Concrete on-disk destination so the renderer can report exactly where
   *  the skill landed instead of a generic ".claude/skills/" string. */
  destPath: string;
}

export async function deploySkill(
  rawName: string,
  rawProjectPath: string,
  opts: DeploySkillOptions = {},
): Promise<DeploySkillResult> {
  const name = validateSkillName(rawName);
  const projectPath = validateProjectPath(rawProjectPath);
  const agentId = opts.agentId ?? "claude";
  const requestedMode: DeployMode = opts.deployMode ?? "copy";

  const result = await deployToProject(name, projectPath, {
    agentId,
    deployMode: requestedMode,
  });

  await withConfigLock(async () => {
    const config = await loadConfig();
    const record = config.skills[name];
    if (record) {
      if (!record.projects.includes(projectPath)) {
        record.projects.push(projectPath);
      }
      const deployments = record.deployments ?? [];
      const existing = deployments.findIndex(
        (d) => d.projectPath === projectPath && d.agentId === agentId,
      );
      const entry: Deployment = {
        projectPath,
        agentId,
        deployMode: result.deployMode,
        deployedAt: nowIso(),
      };
      if (existing >= 0) deployments[existing] = entry;
      else deployments.push(entry);
      record.deployments = deployments;
    }
    config.last_project = projectPath;
    await saveConfig(config);
  });

  return {
    agentId,
    deployMode: result.deployMode,
    warning: result.warning,
    destPath: result.destPath,
  };
}

export async function removeSkill(
  rawName: string,
  opts: { cascade: boolean },
): Promise<{ removedFromProjects: string[] }> {
  const name = validateSkillName(rawName);
  const removedFromProjects: string[] = [];

  const projectsToClean = await withConfigLock(async () => {
    const config = await loadConfig();
    const record = config.skills[name];
    const projects = record?.projects ?? [];
    delete config.skills[name];
    await saveConfig(config);
    return opts.cascade ? projects : [];
  });

  // FS deletion happens outside the lock — these are independent paths
  // unrelated to the config and shouldn't block other config writes.
  for (const project of projectsToClean) {
    try {
      await fs.rm(join(project, ".claude", "skills", name), {
        recursive: true,
        force: true,
      });
      removedFromProjects.push(project);
    } catch {
      // skip — project unreachable, keep going
    }
  }
  await fs.rm(join(LIBRARY_PATH, name), { recursive: true, force: true });
  await clearHistory(name);
  return { removedFromProjects };
}

export async function listTrackedProjects(): Promise<TrackedProject[]> {
  const config = await loadConfig();
  const map = new Map<
    string,
    {
      skillNames: string[];
      latest: string | null;
      agents: Set<string>;
      modes: Set<DeployMode>;
    }
  >();
  for (const [name, record] of Object.entries(config.skills)) {
    const deployments = record.deployments ?? [];
    // Use the deployment list as the source of truth so agent + mode info
    // surfaces correctly. Fall back to record.projects only if deployments
    // is empty (paranoia for an in-flight migration on a partially-updated
    // config).
    const seen = new Set<string>();
    const sources: { path: string; agentId: string; mode: DeployMode; ts: string | null }[] = [];
    for (const d of deployments) {
      sources.push({
        path: d.projectPath,
        agentId: d.agentId,
        mode: d.deployMode,
        ts: d.deployedAt,
      });
      seen.add(d.projectPath);
    }
    for (const p of record.projects) {
      if (seen.has(p)) continue;
      sources.push({
        path: p,
        agentId: "claude",
        mode: "copy",
        ts: record.updated_at ?? record.installed_at,
      });
    }
    for (const s of sources) {
      const entry =
        map.get(s.path) ??
        {
          skillNames: [],
          latest: null,
          agents: new Set<string>(),
          modes: new Set<DeployMode>(),
        };
      if (!entry.skillNames.includes(name)) entry.skillNames.push(name);
      entry.agents.add(s.agentId);
      entry.modes.add(s.mode);
      if (s.ts && (!entry.latest || s.ts > entry.latest)) entry.latest = s.ts;
      map.set(s.path, entry);
    }
  }
  const projects: TrackedProject[] = [];
  for (const [path, info] of map) {
    let exists = false;
    try {
      const stat = await fs.stat(path);
      exists = stat.isDirectory();
    } catch {
      // exists stays false
    }
    projects.push({
      path,
      skillCount: info.skillNames.length,
      skillNames: [...info.skillNames].sort(),
      lastDeployedAt: info.latest,
      exists,
      agentIds: [...info.agents].sort(),
      deployModes: [...info.modes],
    });
  }
  return projects.sort((a, b) => a.path.localeCompare(b.path));
}

export async function removeProjectTracking(
  rawProjectPath: string,
  opts: { cleanFiles: boolean },
): Promise<{ skillsCleaned: string[] }> {
  const projectPath = validateProjectPath(rawProjectPath);
  const skillsCleaned: string[] = [];

  // Pre-collect under lock; do the FS deletes outside the lock so a slow
  // disk doesn't block other config writers.
  const namesToClean = await withConfigLock(async () => {
    const config = await loadConfig();
    const collected: string[] = [];
    for (const [name, record] of Object.entries(config.skills)) {
      if (record.projects.includes(projectPath)) {
        record.projects = record.projects.filter((p) => p !== projectPath);
        if (opts.cleanFiles) collected.push(name);
      }
      if (record.deployments) {
        record.deployments = record.deployments.filter(
          (d) => d.projectPath !== projectPath,
        );
      }
    }
    if (config.last_project === projectPath) config.last_project = "";
    await saveConfig(config);
    return collected;
  });

  for (const name of namesToClean) {
    try {
      await fs.rm(join(projectPath, ".claude", "skills", name), {
        recursive: true,
        force: true,
      });
      skillsCleaned.push(name);
    } catch {
      // skip
    }
  }
  return { skillsCleaned };
}

export async function exportMarkdown(): Promise<ExportPayload> {
  const config = await loadConfig();
  const markdown = exportSkillList(config);
  const count = Object.keys(config.skills).length;
  return { markdown, count };
}

export async function exportJson(): Promise<{ json: string; count: number }> {
  const config = await loadConfig();
  const skillsOnDisk = await listSkillsFromDisk();
  const doc = exportSkillJson(config, skillsOnDisk);
  const json = JSON.stringify(doc, null, 2) + "\n";
  return { json, count: doc.skills.length };
}

export interface ParsedImportEntry extends SkillJsonEntry {
  /** True if this name is already installed in the user's library. */
  alreadyInstalled: boolean;
}

export interface ParsedImportSummary {
  entries: ParsedImportEntry[];
  doc: SkillJsonDoc | null;
  /** Which input shape was detected — surfaced so the importer UI can show
   *  "Detected: codex config — converted 3 paths" style status. */
  detectedFormat: ImportParseResult["detectedFormat"];
  /** Count of malformed entries dropped during parsing. */
  skipped: number;
  /** Count of local-only entries (e.g. codex `path` references) that the
   *  installer can't pull because they have no URL. Surfaced separately so
   *  the user understands they were intentionally skipped, not malformed. */
  localOnlySkipped: number;
}

/**
 * Parse any of the supported import shapes (native v1 / bare array / codex
 * skill config / generic skills array / url-map / line-delimited URLs) and
 * tag entries the user already has installed so the import-review UI can
 * default those checkboxes to off.
 *
 * Local-only entries (codex paths with no URL) are dropped from the
 * installable list — the import flow only handles URL-sourced installs —
 * but their count is reported separately so the UI can mention them.
 */
export async function parseImportJson(
  text: string,
): Promise<ParsedImportSummary> {
  if (typeof text !== "string") throw new Error("Body must be a string");
  if (text.length > 1_000_000) throw new Error("Import body too large (>1 MB)");

  const flexible = parseFlexibleImport(text);
  const config = await loadConfig();
  const installed = new Set(Object.keys(config.skills));
  let localOnlySkipped = 0;
  const entries: ParsedImportEntry[] = [];
  for (const entry of flexible.skills) {
    if (!entry.url) {
      localOnlySkipped += 1;
      continue;
    }
    const tagged: ParsedImportEntry = {
      name: entry.name,
      url: entry.url,
      alreadyInstalled: installed.has(entry.name),
    };
    if (entry.commit) tagged.commit = entry.commit;
    if (entry.description) tagged.description = entry.description;
    entries.push(tagged);
  }

  // Best-effort: also parse the wrapper out so callers can show metadata
  // (export date) without re-parsing. Only the native v1 shape carries it.
  let doc: SkillJsonDoc | null = null;
  if (flexible.detectedFormat === "native") {
    try {
      const raw = JSON.parse(text);
      if (
        raw &&
        typeof raw === "object" &&
        raw.version === 1 &&
        Array.isArray(raw.skills)
      ) {
        doc = raw as SkillJsonDoc;
      }
    } catch {
      // ignore — entries already populated
    }
  }

  return {
    entries,
    doc,
    detectedFormat: flexible.detectedFormat,
    skipped: flexible.skipped,
    localOnlySkipped,
  };
}

export interface SkillUrlValidation {
  url: string;
  ok: boolean;
  remoteCommit: string | null;
  error?: string;
}

/**
 * Validate a single skill URL by asking the upstream `git ls-remote`. A
 * non-null SHA proves the repo exists and is reachable; a null result
 * means the URL is broken (typo, deleted repo, network down). Caller
 * decides how strict to be — `validateUrl` first guards against
 * malformed inputs so a junk URL fails fast without a network round-trip.
 */
export async function validateSkillUrl(
  rawUrl: string,
): Promise<SkillUrlValidation> {
  const url = (() => {
    try {
      return validateUrl(rawUrl);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) } as const;
    }
  })();
  if (typeof url !== "string") {
    return { url: rawUrl, ok: false, remoteCommit: null, error: url.error };
  }
  const sha = await checkRemoteSha(url);
  if (!sha) {
    return {
      url,
      ok: false,
      remoteCommit: null,
      error: "Could not reach repo (URL invalid or network down)",
    };
  }
  return { url, ok: true, remoteCommit: sha };
}

export async function importMarkdown(
  text: string,
  options: OpOptions = {},
): Promise<ImportSummary> {
  const { onLog, signal } = options;
  if (typeof text !== "string") throw new Error("Markdown body must be a string");
  if (text.length > 1_000_000) {
    throw new Error("Markdown body too large (>1 MB)");
  }
  const entries = parseSkillList(text);
  const installed: ImportEntry[] = [];
  const failed: { entry: ImportEntry; error: string }[] = [];
  for (const entry of entries) {
    if (signal?.aborted) {
      onLog?.("Cancelled — stopping import");
      break;
    }
    try {
      onLog?.(`Installing ${entry.name} from ${entry.url}…`);
      await installFromUrl(entry.url, { onLog, signal });
      installed.push(entry);
    } catch (err) {
      if (err instanceof CancelledError) break;
      const message = err instanceof Error ? err.message : String(err);
      onLog?.(`  ✗ ${entry.name}: ${message}`);
      failed.push({ entry, error: message });
    }
  }
  return { installed, failed };
}

export async function getLastProject(): Promise<string> {
  const config = await loadConfig();
  return config.last_project ?? "";
}

export async function setLastProject(rawPath: string): Promise<void> {
  // Empty string clears the last-project; otherwise must be a valid path.
  const path = rawPath === "" ? "" : validateProjectPath(rawPath);
  await withConfigLock(async () => {
    const config = await loadConfig();
    config.last_project = path;
    await saveConfig(config);
  });
}

export async function getSettings(): Promise<AppSettings> {
  const config = await loadConfig();
  return config.settings;
}

export async function setSettings(
  partial: Partial<AppSettings>,
): Promise<AppSettings> {
  if (!partial || typeof partial !== "object") {
    throw new Error("Settings payload must be an object");
  }
  return await withConfigLock(async () => {
    const config = await loadConfig();
    config.settings = { ...config.settings, ...partial };
    await saveConfig(config);
    return config.settings;
  });
}

export async function resetConfig(): Promise<void> {
  await withConfigLock(async () => {
    const config = await loadConfig();
    config.last_project = "";
    config.settings = { ...DEFAULT_SETTINGS };
    await saveConfig(config);
  });
}
