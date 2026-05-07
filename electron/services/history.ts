// Per-skill snapshot history. Before each update overwrites a library entry,
// the previous version is moved to ~/.claude/skills-history/<name>/<commit>/.
// Listing/restoring/pruning is centralised here so callers don't need to know
// about the on-disk layout.

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { CLAUDE_DIR } from "./paths";
import { LIBRARY_PATH } from "./paths";
import { nowIso } from "./config";
import type { HistoryEntry, HistorySnapshot } from "./types";

export const HISTORY_PATH = join(CLAUDE_DIR, "skills-history");

function snapshotDir(name: string, commit: string): string {
  // Tolerate any commit string — file-safe replacement keeps things sane.
  const safe = commit.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(HISTORY_PATH, name, safe);
}

async function dirSize(path: string): Promise<number> {
  let total = 0;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const sub = join(path, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(sub);
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(sub);
        total += stat.size;
      } catch {
        // skip
      }
    }
  }
  return total;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move the current library/<name> directory into history. Returns the new
 * snapshot record, or null if there's nothing to archive (no existing entry).
 *
 * Best-effort: if the move fails (e.g. cross-device EXDEV), falls back to a
 * recursive copy + remove. If even that fails the function returns null and
 * the caller proceeds without archiving — never block the update on history.
 */
export async function archiveSkillVersion(
  name: string,
  commit: string | null,
): Promise<HistorySnapshot | null> {
  const src = join(LIBRARY_PATH, name);
  if (!(await pathExists(src))) return null;

  const archivedAt = nowIso();
  const stableCommit = commit?.trim()
    ? commit.trim()
    : `pre-${archivedAt.replace(/[:T]/g, "-")}`;

  const dest = snapshotDir(name, stableCommit);
  await fs.mkdir(join(HISTORY_PATH, name), { recursive: true });
  // If a snapshot at this commit already exists, drop it — we want the most
  // recent capture under that name (rare: same commit re-archived after a
  // rollback). Avoids a stale snapshot lying about its origin.
  await fs.rm(dest, { recursive: true, force: true });

  try {
    await fs.rename(src, dest);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      ((err as NodeJS.ErrnoException).code === "EXDEV" ||
        (err as NodeJS.ErrnoException).code === "EPERM")
    ) {
      try {
        await fs.cp(src, dest, { recursive: true });
        await fs.rm(src, { recursive: true, force: true });
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  return { commit: stableCommit, archived_at: archivedAt };
}

/**
 * Drop snapshots beyond the retention count, oldest first. Returns the
 * trimmed list (up to `retain` items, newest first).
 */
export async function pruneHistory(
  name: string,
  history: HistorySnapshot[],
  retain: number,
): Promise<HistorySnapshot[]> {
  const sorted = [...history].sort((a, b) =>
    b.archived_at.localeCompare(a.archived_at),
  );
  const keep = sorted.slice(0, retain);
  const drop = sorted.slice(retain);
  for (const snap of drop) {
    await fs.rm(snapshotDir(name, snap.commit), {
      recursive: true,
      force: true,
    });
  }
  return keep;
}

/**
 * Decorate the in-config snapshot list with disk-derived metadata (size,
 * existence). Snapshots whose directories disappeared are marked exists:false
 * so callers can visually flag them.
 */
export async function listHistory(
  name: string,
  history: HistorySnapshot[] | undefined,
): Promise<HistoryEntry[]> {
  if (!history || history.length === 0) return [];
  const entries: HistoryEntry[] = [];
  for (const snap of history) {
    const dir = snapshotDir(name, snap.commit);
    const exists = await pathExists(dir);
    const sizeBytes = exists ? await dirSize(dir) : 0;
    entries.push({
      commit: snap.commit,
      archived_at: snap.archived_at,
      sizeBytes,
      exists,
    });
  }
  // Newest first
  return entries.sort((a, b) => b.archived_at.localeCompare(a.archived_at));
}

/**
 * Replace the live library/<name> with the contents of a stored snapshot.
 * Caller is responsible for archiving the current (pre-rollback) version
 * first if desired.
 */
export async function restoreSnapshot(
  name: string,
  commit: string,
): Promise<void> {
  const src = snapshotDir(name, commit);
  if (!(await pathExists(src))) {
    throw new Error(`Snapshot not found: ${name} @ ${commit}`);
  }
  const dest = join(LIBRARY_PATH, name);
  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(src, dest, { recursive: true });
}

/**
 * Remove all history for a skill (used when the skill itself is removed —
 * keeping orphan history forever isn't useful and just costs disk).
 */
export async function clearHistory(name: string): Promise<void> {
  await fs.rm(join(HISTORY_PATH, name), { recursive: true, force: true });
}

/**
 * Walk skills-history/ and remove any snapshot directory not referenced by
 * `referenced[name] = Set<commit>`. Also removes the per-skill folder when a
 * skill is no longer in config at all. Returns the count + bytes freed for
 * UI feedback.
 *
 * Safe to call from bootstrap — best-effort, swallows per-entry errors so a
 * single permission glitch doesn't abort the whole sweep.
 */
export async function reconcileHistory(
  referenced: Map<string, Set<string>>,
): Promise<{ removedDirs: number; freedBytes: number }> {
  let removedDirs = 0;
  let freedBytes = 0;

  let nameDirs: import("node:fs").Dirent[];
  try {
    nameDirs = await fs.readdir(HISTORY_PATH, { withFileTypes: true });
  } catch {
    // No history dir yet — nothing to reconcile.
    return { removedDirs, freedBytes };
  }

  for (const nameDir of nameDirs) {
    if (!nameDir.isDirectory()) continue;
    const skillName = nameDir.name;
    const allowed = referenced.get(skillName);
    const skillRoot = join(HISTORY_PATH, skillName);

    // Whole-skill orphan: skill removed from config but history dir lingers.
    if (!allowed) {
      try {
        const size = await dirSize(skillRoot);
        await fs.rm(skillRoot, { recursive: true, force: true });
        removedDirs += 1;
        freedBytes += size;
      } catch {
        // skip
      }
      continue;
    }

    // Per-snapshot orphan: skill is in config but this commit isn't.
    let snapshotDirs: import("node:fs").Dirent[];
    try {
      snapshotDirs = await fs.readdir(skillRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const snap of snapshotDirs) {
      if (!snap.isDirectory()) continue;
      if (allowed.has(snap.name)) continue;
      const dir = join(skillRoot, snap.name);
      try {
        const size = await dirSize(dir);
        await fs.rm(dir, { recursive: true, force: true });
        removedDirs += 1;
        freedBytes += size;
      } catch {
        // skip
      }
    }
  }

  return { removedDirs, freedBytes };
}

/**
 * Aggregate disk usage across every snapshot in the history tree. Used by
 * the Settings view to show "snapshots are using X MB" so retention
 * trade-offs are concrete.
 */
export async function totalHistorySize(): Promise<number> {
  try {
    return await dirSize(HISTORY_PATH);
  } catch {
    return 0;
  }
}
