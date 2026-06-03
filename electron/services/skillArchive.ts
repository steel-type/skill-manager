// Local-skill archive handling: extract a `.zip` or `.skill` (a renamed zip —
// Skillbase's own convention; NOT part of the agentskills.io or Anthropic
// spec, both of which treat a skill as a plain folder) into a temp directory,
// then locate the folder that actually contains SKILL.md so the caller can
// install it with the same primitive used for folder imports.
//
// We shell out to the system unzip/tar rather than add a zip dependency —
// the app already spawns `git`, the runtime deps are deliberately minimal,
// and Node 22 has no built-in zip *archive* reader (only gzip streams).

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, sep } from "node:path";
import { spawn } from "node:child_process";

const EXTRACT_TIMEOUT_MS = 60_000;

/** Extensions we treat as a zip archive. `.skill` is a renamed `.zip`. */
export const ARCHIVE_EXTENSIONS = [".zip", ".skill"] as const;

export function isArchivePath(p: string): boolean {
  const lower = p.toLowerCase();
  return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "USER"]) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  return env;
}

/**
 * Run an extractor command, rejecting on non-zero exit, signal, or timeout.
 * stdout/stderr are captured for the error message but otherwise discarded.
 */
function runExtractor(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let done = false;
    const child = spawn(cmd, args, { env: sanitizedEnv() });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${EXTRACT_TIMEOUT_MS}ms`));
    }, EXTRACT_TIMEOUT_MS);
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${cmd} exited ${code}${stderr.trim() ? `: ${stderr.trim().slice(0, 400)}` : ""}`,
          ),
        );
    });
  });
}

/**
 * Extract `archivePath` into a fresh temp directory and return that
 * directory. Tries the system `unzip` first (present on macOS/Linux), then
 * falls back to `tar` (bsdtar reads zip on macOS and Windows 10+). The temp
 * dir is the caller's to clean up via `cleanupExtraction`.
 *
 * Path traversal: both unzip and bsdtar refuse `../` entries by default;
 * we additionally extract into an isolated dir and the downstream
 * installLocalSkill copy filters symlinks, so a crafted archive can't escape
 * into the library or follow a link out of it.
 */
export async function extractArchive(archivePath: string): Promise<string> {
  const dest = await fs.mkdtemp(join(tmpdir(), "skillbase-extract-"));
  try {
    await runExtractor("unzip", ["-o", "-q", archivePath, "-d", dest]);
  } catch (unzipErr) {
    try {
      await runExtractor("tar", ["-xf", archivePath, "-C", dest]);
    } catch (tarErr) {
      await cleanupExtraction(dest);
      throw new Error(
        `Could not extract archive (unzip: ${unzipErr instanceof Error ? unzipErr.message : unzipErr}; tar: ${tarErr instanceof Error ? tarErr.message : tarErr})`,
      );
    }
  }
  return dest;
}

export async function cleanupExtraction(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Walk an extracted (or picked) directory tree and return the directory that
 * directly contains a `SKILL.md`. Handles the common "zip wraps everything in
 * a single top-level folder" case and a couple levels of nesting. Returns
 * null when no SKILL.md is found within the search depth.
 *
 * macOS zip noise (`__MACOSX/`, `.DS_Store`) is ignored.
 */
export async function findSkillRoot(
  root: string,
  maxDepth = 3,
): Promise<string | null> {
  // BFS so the shallowest SKILL.md wins (the skill's own root, not a
  // reference doc nested deeper).
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const hasSkillMd = entries.some(
      (e) => e.isFile() && e.name === "SKILL.md",
    );
    if (hasSkillMd) return dir;
    if (depth >= maxDepth) continue;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === "__MACOSX" || e.name.startsWith(".")) continue;
      queue.push({ dir: join(dir, e.name), depth: depth + 1 });
    }
  }
  return null;
}

/**
 * Derive a candidate skill name from an archive/folder path: the base name
 * with any archive extension stripped. The caller still runs it through
 * validateSkillName, which enforces the agentskills.io kebab-case contract.
 */
export function nameFromArchivePath(p: string): string {
  let base = basename(p.replace(new RegExp(`\\${sep}+$`), ""));
  for (const ext of ARCHIVE_EXTENSIONS) {
    if (base.toLowerCase().endsWith(ext)) {
      base = base.slice(0, -ext.length);
      break;
    }
  }
  return base;
}
