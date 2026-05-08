import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { getLibraryPath } from "./paths";

export type LogHandler = (line: string) => void;

export interface CloneOptions {
  onLog?: LogHandler;
  signal?: AbortSignal;
}

export class CancelledError extends Error {
  constructor(message = "Operation cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

const GIT_TIMEOUT_MS = 60_000;
const LS_REMOTE_TIMEOUT_MS = 15_000;
const LS_REMOTE_RETRIES = 1; // one retry on transient failures (DNS, packet loss)

// Track every git child we spawn so the main process can SIGTERM them on
// quit. Without this, an in-flight clone keeps running as a zombie after the
// app window closes.
const liveChildren = new Set<ChildProcess>();

function trackChild(child: ChildProcess): ChildProcess {
  liveChildren.add(child);
  child.once("exit", () => liveChildren.delete(child));
  return child;
}

export function killAllGitChildren(): void {
  for (const child of liveChildren) {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
  liveChildren.clear();
}

async function rmrf(path: string): Promise<void> {
  await fs.rm(path, { recursive: true, force: true });
}

/**
 * Shallow-clone a repo into a tmp directory, capture its short HEAD SHA, then
 * copy into the library (excluding `.git`, `node_modules`, `__pycache__`,
 * and any symlinks to avoid escape-via-symlink). The tmp staging keeps the
 * install atomic — a failed clone does not corrupt the existing library
 * entry.
 *
 * Caller MUST validate `url` (see services/validators.ts) before calling.
 * The `--` separator below is belt-and-braces against URLs that begin with
 * `--` (which would otherwise be parsed as git flags).
 */
export async function cloneToLibrary(
  url: string,
  repoName: string,
  options: CloneOptions = {},
): Promise<{ commit: string | null }> {
  const { onLog, signal } = options;
  if (signal?.aborted) throw new CancelledError();

  await fs.mkdir(getLibraryPath(), { recursive: true });
  const tmp = join(tmpdir(), `skill-download-${repoName}-${Date.now()}`);
  await rmrf(tmp);

  onLog?.(`Cloning ${url} (depth 1)…`);

  await new Promise<void>((resolve, reject) => {
    const child = trackChild(
      spawn("git", [
        "clone",
        "--depth",
        "1",
        "--progress",
        "--",
        url,
        tmp,
      ]),
    );
    let stderrBuf = "";
    let cancelled = false;

    const onAbort = () => {
      cancelled = true;
      child.kill("SIGTERM");
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`git clone timed out after ${GIT_TIMEOUT_MS / 1000}s`));
    }, GIT_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim()) onLog?.(line);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stderrBuf += s;
      for (const line of s.split(/\r?\n/)) {
        if (line.trim()) onLog?.(line);
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const msg =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? "Git not found — install with: brew install git"
          : err.message;
      reject(new Error(msg));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (cancelled) {
        reject(new CancelledError());
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        const trimmed = stderrBuf.trim();
        const lastError =
          trimmed.split("\n").reverse().find((l) => /error|fatal/i.test(l)) ??
          trimmed;
        reject(
          new Error(
            lastError || `git clone exited with code ${code ?? "?"}`,
          ),
        );
      }
    });
  });

  if (signal?.aborted) {
    await rmrf(tmp);
    throw new CancelledError();
  }

  // Capture short HEAD SHA before we discard .git. Doing this via spawn
  // keeps simple-git out of the dependency graph.
  let commit: string | null = null;
  try {
    commit = await new Promise<string | null>((resolve) => {
      const child = trackChild(
        spawn("git", ["rev-parse", "--short", "HEAD"], { cwd: tmp }),
      );
      let stdout = "";
      const t = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(null);
      }, 5_000);
      child.stdout?.on("data", (c: Buffer) => (stdout += c.toString()));
      child.on("error", () => {
        clearTimeout(t);
        resolve(null);
      });
      child.on("close", (code) => {
        clearTimeout(t);
        if (code !== 0) return resolve(null);
        const s = stdout.trim();
        resolve(s.length > 0 ? s : null);
      });
    });
  } catch {
    commit = null;
  }

  // Copy tmp → library/<repoName>. We strip .git / build noise dirs and
  // **skip symbolic links** so a malicious repo can't smuggle a symlink
  // pointing at /etc/passwd into the user's library (or worse, a deployed
  // project's .claude/skills/).
  if (signal?.aborted) {
    await rmrf(tmp);
    throw new CancelledError();
  }
  const dest = join(getLibraryPath(), repoName);
  try {
    await rmrf(dest);
    await fs.cp(tmp, dest, {
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
          const stat = await fs.lstat(source);
          if (stat.isSymbolicLink()) return false;
        } catch {
          // race with FS; safer to skip
          return false;
        }
        return true;
      },
    });
    onLog?.(`Installed → ${dest}`);
  } finally {
    await rmrf(tmp);
  }

  return { commit };
}

/**
 * Remote-only check — returns the short SHA of HEAD on the upstream, or null
 * if the remote is unreachable / the URL is invalid. Retries once on
 * transient failures (network blip, slow DNS).
 */
export async function checkRemoteSha(url: string): Promise<string | null> {
  for (let attempt = 0; attempt <= LS_REMOTE_RETRIES; attempt++) {
    const sha = await runLsRemote(url);
    if (sha) return sha;
    if (attempt < LS_REMOTE_RETRIES) {
      // Brief backoff so a flapping network has a moment to settle.
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return null;
}

function runLsRemote(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = trackChild(
      spawn("git", ["ls-remote", "--", url, "HEAD"]),
    );
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, LS_REMOTE_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve(null);
      const first = stdout.trim().split(/\s+/)[0];
      resolve(first ? first.slice(0, 7) : null);
    });
  });
}
