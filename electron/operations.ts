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
import { getHistoryPath, getLibraryPath } from "./services/paths";
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
  // Pull setup state first so we can configure runtime paths BEFORE any
  // disk operations land in the wrong place. If setup is incomplete, skip
  // ensureLibraryDir + reconcile — the SetupFlow will run completeSetup
  // which handles directory creation explicitly.
  const initialConfig = await loadConfig();
  if (initialConfig.setup.completed) {
    const { configurePaths } = await import("./services/paths");
    try {
      configurePaths({
        libraryPath: initialConfig.setup.libraryPath,
        historyPath: initialConfig.setup.historyPath,
      });
    } catch (err) {
      // A bad setup state (e.g. blank paths somehow persisted) shouldn't
      // brick boot. Fall through with default paths.
      console.warn(
        "[skill-manager] setup paths invalid; falling back to defaults:",
        err,
      );
    }
  } else {
    // Pre-setup boot: don't touch disk. The renderer will show SetupFlow,
    // which calls completeSetup and triggers a refresh.
    return;
  }

  await ensureLibraryDir();
  const config = await loadConfig();
  const reconciled = await reconcileConfig(config);

  // Backfill stack meta-skills into the library. Stacks created before this
  // model existed have no library SKILL.md, so symlink deploys would fail
  // and migration logic would skip them. Idempotent: skips stacks whose
  // file already exists. Best-effort — failures don't block bootstrap.
  try {
    const { generateMetaSkill, loadStackMembers, writeMetaSkillToLibrary } =
      await import("./services/stacks");
    for (const stack of reconciled.stacks) {
      const path = join(getLibraryPath(), stack.id, "SKILL.md");
      try {
        await fs.access(path);
        continue;
      } catch {
        // Missing — fall through to backfill.
      }
      try {
        const members = await loadStackMembers(stack.skillIds);
        const content = generateMetaSkill(stack, members);
        await writeMetaSkillToLibrary(stack.id, content);
      } catch (err) {
        console.warn(
          `[skill-manager] backfill failed for stack '${stack.id}':`,
          err,
        );
      }
    }
  } catch (err) {
    console.warn("[skill-manager] stack backfill failed:", err);
  }

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
  await fs.rm(getHistoryPath(), { recursive: true, force: true });

  return { snapshotsCleared, freedBytes: sizeBefore };
}

export async function listSkills(): Promise<Skill[]> {
  return await listSkillsFromDisk();
}

/**
 * Install a skill from a local source directory (no git clone). Used by
 * the importer for codex skill-config entries that reference paths the
 * user already has on disk, and by any future "install from folder" flow.
 *
 * Copies the source into ~/.claude/skills/<name>/ (filtering out symlinks
 * and noisy build artifacts the same way cloneToLibrary does), then
 * registers a config record with `url: null` so the skill shows up in the
 * library as "local" — it has no remote to update from.
 */
export async function installLocalSkill(
  rawName: string,
  rawSourcePath: string,
): Promise<InstallResult> {
  const name = validateSkillName(rawName);
  // Reuse the same path validator URLs / project paths use — must be
  // absolute, no null bytes, sane length. Local skill sources live in the
  // user's filesystem; we don't need a separate abuse path.
  const sourcePath = validateProjectPath(rawSourcePath);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(sourcePath);
  } catch {
    throw new Error(`Source path does not exist: ${sourcePath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Source path is not a directory: ${sourcePath}`);
  }

  await ensureLibraryDir();
  const dest = join(getLibraryPath(), name);
  await fs.rm(dest, { recursive: true, force: true });
  // Same filter rules as cloneToLibrary's post-clone copy: skip .git /
  // node_modules / __pycache__ noise and refuse to follow symlinks (a
  // malicious source could otherwise smuggle /etc/passwd into the library).
  await fs.cp(sourcePath, dest, {
    recursive: true,
    verbatimSymlinks: false,
    filter: async (source) => {
      const segments = source.split("/");
      if (
        segments.some((seg) =>
          [".git", "node_modules", "__pycache__"].includes(seg),
        )
      ) {
        return false;
      }
      try {
        const lst = await fs.lstat(source);
        if (lst.isSymbolicLink()) return false;
      } catch {
        return false;
      }
      return true;
    },
  });

  await withConfigLock(async () => {
    const config = await loadConfig();
    const existing = config.skills[name];
    config.skills[name] = {
      url: null,
      commit: null,
      installed_at: existing?.installed_at ?? nowIso(),
      updated_at: nowIso(),
      projects: existing?.projects ?? [],
      deployments: existing?.deployments ?? [],
      history: existing?.history,
    };
    await saveConfig(config);
  });

  const skills = await listSkillsFromDisk();
  const me = skills.find((s) => s.name === name);
  return {
    name,
    commit: null,
    isBundle: me?.isBundle ?? false,
    bundleSize: me?.bundleSize ?? 0,
  };
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
  await fs.rm(join(getLibraryPath(), name), { recursive: true, force: true });
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
): Promise<{ skillsCleaned: string[]; stacksCleaned: string[] }> {
  const projectPath = validateProjectPath(rawProjectPath);
  const skillsCleaned: string[] = [];
  const stacksCleaned: string[] = [];

  // Pre-collect under lock; do the FS deletes outside the lock so a slow
  // disk doesn't block other config writers. Track skills AND stacks at
  // this project so cleanup hits both — earlier behavior leaked stack
  // meta-skills into the project tree even when 'clean directory' was
  // checked.
  type Cleanup = {
    // Each skill cleanup entry pairs name + agentId so the FS pass below can
    // resolve the correct project path (.claude/skills, .codex/skills, etc).
    // A single skill deployed to multiple agents at the same project shows
    // up multiple times.
    skills: { name: string; agentId: string }[];
    stacks: { id: string; agentId: string }[];
  };
  const toClean = await withConfigLock(async () => {
    const config = await loadConfig();
    const skillEntries: { name: string; agentId: string }[] = [];
    for (const [name, record] of Object.entries(config.skills)) {
      // Pull every (skill, agent) pair at this project so cleanup can target
      // the right agent dir. Older records that only have `projects[]` (no
      // deployments[]) fall back to the default "claude" agent.
      if (opts.cleanFiles) {
        const seen = new Set<string>();
        for (const dep of record.deployments ?? []) {
          if (dep.projectPath === projectPath) {
            const key = `${name}::${dep.agentId}`;
            if (!seen.has(key)) {
              seen.add(key);
              skillEntries.push({ name, agentId: dep.agentId });
            }
          }
        }
        if (
          seen.size === 0 &&
          record.projects.includes(projectPath)
        ) {
          skillEntries.push({ name, agentId: "claude" });
        }
      }
      if (record.projects.includes(projectPath)) {
        record.projects = record.projects.filter((p) => p !== projectPath);
      }
      if (record.deployments) {
        record.deployments = record.deployments.filter(
          (d) => d.projectPath !== projectPath,
        );
      }
    }
    const stackEntries: { id: string; agentId: string }[] = [];
    if (opts.cleanFiles) {
      for (const dep of config.stackDeployments) {
        if (dep.projectPath === projectPath) {
          stackEntries.push({ id: dep.stackId, agentId: dep.agentId });
        }
      }
    }
    config.stackDeployments = config.stackDeployments.filter(
      (d) => d.projectPath !== projectPath,
    );
    if (config.last_project === projectPath) config.last_project = "";
    await saveConfig(config);
    return { skills: skillEntries, stacks: stackEntries } satisfies Cleanup;
  });

  // FS cleanup uses resolveAgentPaths so non-claude projects (codex,
  // gemini, continue, cursor, cline) actually have their deployed files
  // removed instead of leaving symlinks behind at .codex/skills/<name>/.
  const { resolveAgentPaths, AGENTS } = await import("./services/agents");

  function resolvePathFor(agentId: string, name: string): string | null {
    const agent = AGENTS[agentId];
    if (!agent) return null;
    const resolved = resolveAgentPaths(agentId, name, projectPath);
    if (!resolved.projectPath) return null;
    const isSingleFile = /{name}/.test(agent.entryFile);
    return isSingleFile
      ? join(resolved.projectPath, resolved.entryFile)
      : resolved.projectPath;
  }

  for (const entry of toClean.skills) {
    const target = resolvePathFor(entry.agentId, entry.name);
    if (!target) continue;
    try {
      await fs.rm(target, { recursive: true, force: true });
      skillsCleaned.push(entry.name);
    } catch {
      // skip
    }
  }
  for (const dep of toClean.stacks) {
    const target = resolvePathFor(dep.agentId, dep.id);
    if (!target) continue;
    try {
      await fs.rm(target, { recursive: true, force: true });
      stacksCleaned.push(dep.id);
    } catch {
      // skip
    }
  }
  return { skillsCleaned, stacksCleaned };
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

export interface ParsedLocalEntry {
  name: string;
  /** Absolute path to the local skill source. */
  localPath: string;
  /** Mirrors the codex `enabled` flag when present — UI defaults disabled
   *  entries to off in the install batch. */
  enabled?: boolean;
  alreadyInstalled: boolean;
}

export interface ParsedImportSummary {
  entries: ParsedImportEntry[];
  /** Local-path entries (e.g. codex `path` references). Have no URL so they
   *  go through installLocalSkill rather than the URL clone path. */
  localEntries: ParsedLocalEntry[];
  doc: SkillJsonDoc | null;
  /** Which input shape was detected — surfaced so the importer UI can show
   *  "Detected: codex config — converted 3 paths" style status. */
  detectedFormat: ImportParseResult["detectedFormat"];
  /** Count of malformed entries dropped during parsing. */
  skipped: number;
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
  const entries: ParsedImportEntry[] = [];
  const localEntries: ParsedLocalEntry[] = [];
  for (const entry of flexible.skills) {
    if (!entry.url && entry.localPath) {
      localEntries.push({
        name: entry.name,
        localPath: entry.localPath,
        enabled: entry.enabled,
        alreadyInstalled: installed.has(entry.name),
      });
      continue;
    }
    if (!entry.url) {
      // Pure malformed — counted via flexible.skipped already.
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
    localEntries,
    doc,
    detectedFormat: flexible.detectedFormat,
    skipped: flexible.skipped,
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
