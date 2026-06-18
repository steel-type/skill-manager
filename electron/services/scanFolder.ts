// Scan a folder (default ~/Downloads) for importable agent skills.
//
// Two candidate kinds, both per the agentskills.io spec:
//
//   1. `folder` — a directory containing a SKILL.md at its root (or one level
//      down inside a single wrapping subdirectory, which is the shape most
//      downloads land in).
//   2. `archive` — a `.skill` or `.zip` file. `.skill` is the de facto
//      distribution format used by Claude downloads and most agent-skill
//      marketplaces (the spec itself defines a skill as the unzipped folder,
//      but `.skill` is what actually lands in ~/Downloads).
//
// The scan is intentionally cheap: it walks one level into the target dir,
// looks at filenames and (for folders) the existence of SKILL.md. Archives
// are NOT extracted during scan — that would cost up to 60s per file and is
// the import phase's job. We surface every plausible candidate and let the
// existing importLocalSkill pipeline make the final call.

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { isArchivePath } from "./skillArchive";

export interface SkillCandidate {
  /** Absolute path to the folder or archive on disk. */
  path: string;
  /** `folder` for a directory containing SKILL.md; `archive` for .skill/.zip. */
  kind: "folder" | "archive";
  /** Display name — folder basename or archive basename without extension. */
  displayName: string;
  /** Size in bytes. For folders this is the SKILL.md size as a cheap proxy
   *  (full recursive size is too expensive during scan). */
  sizeBytes: number;
  /** Last-modified time in ISO-8601, for sort + "downloaded N days ago" UI. */
  modifiedAt: string;
}

/** Where the scan looks when the caller doesn't specify a folder. */
export function defaultScanFolder(): string {
  return join(homedir(), "Downloads");
}

/** Hide noise that pollutes Downloads — partial downloads, OS metadata. */
const IGNORED_PREFIXES = [".", "__MACOSX"];
const IGNORED_SUFFIXES = [
  ".crdownload", // Chrome partial
  ".part", // Firefox partial
  ".download", // Safari partial
];

function isIgnoredName(name: string): boolean {
  if (IGNORED_PREFIXES.some((p) => name.startsWith(p))) return true;
  if (IGNORED_SUFFIXES.some((s) => name.toLowerCase().endsWith(s))) return true;
  return false;
}

/** A folder is a skill candidate if it contains SKILL.md at its root, or has
 *  exactly one subdirectory that does (the "unzipped into a wrapper folder"
 *  shape). We don't go deeper — past two levels we're probably inside a
 *  reference repo with many skills, which is bundle-import territory, not
 *  scan territory. */
async function folderLooksLikeSkill(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name === "SKILL.md")) return true;
    const subdirs = entries.filter(
      (e) => e.isDirectory() && !isIgnoredName(e.name),
    );
    if (subdirs.length !== 1) return false;
    const inner = await fs.readdir(join(dir, subdirs[0].name), {
      withFileTypes: true,
    });
    return inner.some((e) => e.isFile() && e.name === "SKILL.md");
  } catch {
    return false;
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await fs.stat(path)).size;
  } catch {
    return 0;
  }
}

/** Strip a recognised archive extension so the candidate's display name
 *  matches what the import will land in the library as. */
function displayNameForArchive(name: string): string {
  const lower = name.toLowerCase();
  for (const ext of [".skill", ".zip"]) {
    if (lower.endsWith(ext)) return name.slice(0, -ext.length);
  }
  return name;
}

/**
 * Walk `dir` (default ~/Downloads) and return every plausible skill
 * candidate. Folders are validated cheaply (does a SKILL.md exist within one
 * level); archives are listed without extraction. Errors on individual
 * entries are swallowed — one unreadable file shouldn't kill the scan.
 *
 * Results are sorted newest-first by mtime so the most recently downloaded
 * skill is at the top of the UI list.
 */
export async function scanFolderForSkills(
  dir: string,
): Promise<SkillCandidate[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(
      `Could not read folder: ${err instanceof Error ? err.message : err}`,
    );
  }

  const candidates: SkillCandidate[] = [];
  for (const entry of entries) {
    if (isIgnoredName(entry.name)) continue;
    const full = join(dir, entry.name);
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }

    if (entry.isFile() && isArchivePath(entry.name)) {
      candidates.push({
        path: full,
        kind: "archive",
        displayName: displayNameForArchive(entry.name),
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
      continue;
    }

    if (entry.isDirectory() && (await folderLooksLikeSkill(full))) {
      // For folders, use SKILL.md size as a cheap "weight" indicator. A full
      // recursive walk would be O(every-file-in-Downloads) and we'd rather
      // keep scan latency under ~100ms even with hundreds of entries.
      const skillMdSize = await fileSize(join(full, "SKILL.md"));
      candidates.push({
        path: full,
        kind: "folder",
        displayName: basename(full),
        sizeBytes: skillMdSize,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
  }

  candidates.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return candidates;
}
