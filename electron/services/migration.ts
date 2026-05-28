// Library migration: relocate the library from one absolute path to
// another (e.g. when the user switches primary agent in Settings or runs
// "Move…" against a custom path). Per-entry atomic: copy → verify → rewrite
// symlinks → delete source. Symlinks pointing into the OLD library are
// re-pointed at the NEW library so existing project deployments keep
// working without a re-cascade. History snapshots optionally move alongside.
//
// Stack meta-skills are first-class library citizens (Phase 0A), so they
// migrate as regular library entries — no special "regenerate" pass.

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { AGENTS, resolveAgentPaths } from "./agents";
import { loadConfig, saveConfig, withConfigLock } from "./config";
import { configurePaths } from "./paths";

export interface MigrationPlanEntry {
  name: string;
  sizeBytes: number;
}

export interface MigrationSymlinkRewrite {
  /** Where the symlink lives on disk (inside the user's project). */
  symlinkPath: string;
  /** Where it currently points (inside the OLD library). */
  oldTarget: string;
  /** Where it will point after migration (inside the NEW library). */
  newTarget: string;
  /** Project path the symlink belongs to. */
  projectPath: string;
  /** Agent id (drives which `.<agent>/...` subdir hosts the symlink). */
  agentId: string;
  /** Library entry name being repointed. */
  entryName: string;
}

export interface MigrationPlan {
  fromLibrary: string;
  toLibrary: string;
  fromHistory: string;
  /** When `null`, history is left at the old location and `getHistoryPath`
   *  remains pointed there. When set, history is moved to this path. */
  toHistory: string | null;
  entries: MigrationPlanEntry[];
  symlinkRewrites: MigrationSymlinkRewrite[];
  totalBytes: number;
  /** Entry names already present at `toLibrary` — these will be skipped to
   *  avoid clobbering whatever is there. */
  conflicts: string[];
}

export interface MigrationProgressMsg {
  level: "info" | "warn" | "error" | "success";
  text: string;
}

export interface MigrationResult {
  movedEntries: string[];
  skippedEntries: { name: string; reason: string }[];
  movedHistory: boolean;
  rewrittenSymlinks: number;
  failedSymlinks: {
    symlinkPath: string;
    entryName: string;
    error: string;
  }[];
}

async function dirSize(p: string): Promise<number> {
  let total = 0;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(p, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = join(p, e.name);
    if (e.isDirectory()) {
      total += await dirSize(full);
    } else if (e.isFile()) {
      try {
        const st = await fs.stat(full);
        total += st.size;
      } catch {
        // skip
      }
    }
  }
  return total;
}

/**
 * Compute what `runMigration` would do, given a from→to library move.
 * Includes conflicts and symlink rewrites so the UI can show a preview
 * before the user commits.
 */
export async function planMigration(args: {
  fromLibrary: string;
  toLibrary: string;
  /** When true, the plan also tries to move skills-history alongside the
   *  library (sibling layout). When false, history stays put. */
  moveHistory: boolean;
  /** Source history path (defaults to <fromLibrary>'s sibling
   *  skills-history). Caller may override for non-standard layouts. */
  fromHistory?: string;
  /** Target history path; required when moveHistory=true. */
  toHistory?: string;
}): Promise<MigrationPlan> {
  const fromLibrary = args.fromLibrary;
  const toLibrary = args.toLibrary;
  if (fromLibrary === toLibrary) {
    throw new Error(
      "planMigration: fromLibrary and toLibrary cannot be the same",
    );
  }
  const fromHistory =
    args.fromHistory ??
    join(fromLibrary, "..", "skills-history");
  const toHistory = args.moveHistory
    ? (args.toHistory ?? join(toLibrary, "..", "skills-history"))
    : null;

  // Walk the source library for top-level entries.
  let dirEntries: string[] = [];
  try {
    const list = await fs.readdir(fromLibrary, { withFileTypes: true });
    dirEntries = list
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    // No library at the source — nothing to do.
  }

  const entries: MigrationPlanEntry[] = [];
  let totalBytes = 0;
  for (const name of dirEntries) {
    const sizeBytes = await dirSize(join(fromLibrary, name));
    entries.push({ name, sizeBytes });
    totalBytes += sizeBytes;
  }

  // Detect conflicts at the destination so the UI can warn before commit.
  const conflicts: string[] = [];
  for (const entry of entries) {
    const dst = join(toLibrary, entry.name);
    try {
      await fs.access(dst);
      conflicts.push(entry.name);
    } catch {
      // OK — destination free.
    }
  }

  // Build symlink rewrites. Sources:
  //  1. config.skills[*].deployments where deployMode === 'symlink'
  //  2. config.stackDeployments where deployMode === 'symlink'
  // For each symlink deployment we recompute the on-disk symlink path
  // (via resolveAgentPaths) and produce old → new targets.
  const config = await loadConfig();
  const symlinkRewrites: MigrationSymlinkRewrite[] = [];
  function addRewrite(
    entryName: string,
    projectPath: string,
    agentId: string,
  ): void {
    if (!entries.find((e) => e.name === entryName)) return;
    const agent = AGENTS[agentId];
    if (!agent) return;
    const resolved = resolveAgentPaths(agentId, entryName, projectPath);
    if (!resolved.projectPath) return;
    const isSingleFile = agent.entryShape === "single-file";
    const symlinkPath = isSingleFile
      ? join(resolved.projectPath, resolved.entryFile)
      : resolved.projectPath;
    const oldEntryDir = join(fromLibrary, entryName);
    const newEntryDir = join(toLibrary, entryName);
    const oldTarget = isSingleFile ? join(oldEntryDir, "SKILL.md") : oldEntryDir;
    const newTarget = isSingleFile ? join(newEntryDir, "SKILL.md") : newEntryDir;
    symlinkRewrites.push({
      symlinkPath,
      oldTarget,
      newTarget,
      projectPath,
      agentId,
      entryName,
    });
  }

  for (const [name, record] of Object.entries(config.skills)) {
    for (const dep of record.deployments ?? []) {
      if (dep.deployMode === "symlink") {
        addRewrite(name, dep.projectPath, dep.agentId);
      }
    }
  }
  for (const dep of config.stackDeployments) {
    if (dep.deployMode === "symlink") {
      addRewrite(dep.stackId, dep.projectPath, dep.agentId);
    }
  }

  return {
    fromLibrary,
    toLibrary,
    fromHistory,
    toHistory,
    entries,
    symlinkRewrites,
    totalBytes,
    conflicts,
  };
}

/**
 * Execute a migration plan. Per-entry: copy → fast verify → rewrite
 * symlinks pointing at this entry → delete source. Failures are isolated
 * to the entry — other entries keep migrating. Re-running the same plan
 * is safe: already-moved entries hit the conflict path and are skipped.
 *
 * After the entry pass, optionally moves the history directory and
 * always updates `setup.libraryPath` (and `setup.historyPath` when
 * history moved) plus calls `configurePaths` so the rest of the backend
 * resolves to the new location.
 */
export async function runMigration(
  plan: MigrationPlan,
  opts: {
    onLog?: (m: MigrationProgressMsg) => void;
    signal?: AbortSignal;
  } = {},
): Promise<MigrationResult> {
  const log = opts.onLog ?? (() => undefined);
  const movedEntries: string[] = [];
  const skippedEntries: { name: string; reason: string }[] = [];
  const failedSymlinks: MigrationResult["failedSymlinks"] = [];
  let rewrittenSymlinks = 0;

  await fs.mkdir(plan.toLibrary, { recursive: true });

  for (const entry of plan.entries) {
    if (opts.signal?.aborted) {
      log({ level: "warn", text: "Migration cancelled — stopping." });
      break;
    }
    if (plan.conflicts.includes(entry.name)) {
      skippedEntries.push({
        name: entry.name,
        reason: "Already exists at destination",
      });
      log({
        level: "warn",
        text: `skip ${entry.name} (already at destination)`,
      });
      continue;
    }
    const src = join(plan.fromLibrary, entry.name);
    const dst = join(plan.toLibrary, entry.name);
    try {
      log({ level: "info", text: `copy ${entry.name}` });
      await fs.cp(src, dst, {
        recursive: true,
        errorOnExist: true,
        verbatimSymlinks: false,
      });
      // Fast verify: dest size within 1% of source size. A more rigorous
      // tree compare would be slower without buying much — fs.cp is
      // already well-tested.
      const dstSize = await dirSize(dst);
      const tolerance = Math.max(64, Math.floor(entry.sizeBytes * 0.01));
      if (Math.abs(dstSize - entry.sizeBytes) > tolerance) {
        await fs.rm(dst, { recursive: true, force: true });
        skippedEntries.push({
          name: entry.name,
          reason: `Size mismatch after copy (${dstSize} vs ${entry.sizeBytes})`,
        });
        log({ level: "error", text: `${entry.name}: size verify failed` });
        continue;
      }
      // Re-point this entry's symlinks. A failure here doesn't block
      // source deletion — the user can re-deploy from the Deploy view.
      const myRewrites = plan.symlinkRewrites.filter(
        (r) => r.entryName === entry.name,
      );
      for (const r of myRewrites) {
        try {
          await fs.unlink(r.symlinkPath);
        } catch {
          // Symlink may have been deleted manually since plan was built.
        }
        try {
          await fs.symlink(r.newTarget, r.symlinkPath);
          rewrittenSymlinks += 1;
          log({
            level: "info",
            text: `repoint ${entry.name} at ${r.projectPath}`,
          });
        } catch (err) {
          failedSymlinks.push({
            symlinkPath: r.symlinkPath,
            entryName: entry.name,
            error: err instanceof Error ? err.message : String(err),
          });
          log({
            level: "error",
            text: `symlink rewrite failed for ${r.symlinkPath}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          });
        }
      }
      // Now safe to delete the source. Any rewrite failures already logged.
      await fs.rm(src, { recursive: true, force: true });
      movedEntries.push(entry.name);
      log({ level: "success", text: `moved ${entry.name}` });
    } catch (err) {
      skippedEntries.push({
        name: entry.name,
        reason: err instanceof Error ? err.message : String(err),
      });
      log({
        level: "error",
        text: `${entry.name}: ${err instanceof Error ? err.message : err}`,
      });
    }
  }

  // History move (best-effort; failure is logged but not fatal).
  let movedHistory = false;
  if (plan.toHistory) {
    try {
      log({ level: "info", text: "moving history snapshots" });
      try {
        await fs.rename(plan.fromHistory, plan.toHistory);
        movedHistory = true;
      } catch (err: unknown) {
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          (err as NodeJS.ErrnoException).code === "EXDEV"
        ) {
          // Cross-device move: fall back to copy + delete.
          await fs.cp(plan.fromHistory, plan.toHistory, {
            recursive: true,
            verbatimSymlinks: false,
          });
          await fs.rm(plan.fromHistory, { recursive: true, force: true });
          movedHistory = true;
        } else {
          throw err;
        }
      }
      log({ level: "success", text: "history moved" });
    } catch (err) {
      log({
        level: "warn",
        text: `history move failed: ${err instanceof Error ? err.message : err}`,
      });
    }
  }

  // Persist + configure runtime paths. Always update libraryPath even if
  // some entries failed — partial migration is recoverable by re-running.
  const finalHistory = movedHistory ? plan.toHistory! : plan.fromHistory;
  await withConfigLock(async () => {
    const config = await loadConfig();
    config.setup.libraryPath = plan.toLibrary;
    config.setup.historyPath = finalHistory;
    await saveConfig(config);
  });
  configurePaths({
    libraryPath: plan.toLibrary,
    historyPath: finalHistory,
  });

  return {
    movedEntries,
    skippedEntries,
    movedHistory,
    rewrittenSymlinks,
    failedSymlinks,
  };
}
