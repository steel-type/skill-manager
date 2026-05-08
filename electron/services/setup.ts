// First-run setup: resolve a chosen library location, scan for existing
// skills the user might want to import, and persist the choice into
// config.setup. Migration of an EXISTING library to a new location lives
// in services/migration.ts (Phase D) — this file only handles the
// initial place-and-import flow.

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { configurePaths } from "./paths";
import { detectSkillType } from "./skills";
import { loadConfig, nowIso, saveConfig, withConfigLock } from "./config";
import type { DeployMode, LibraryRoot, SetupConfig } from "./types";

export interface DetectedSkill {
  /** Skill name = directory basename. */
  name: string;
  /** Absolute path of the skill directory inside the scanned root. */
  path: string;
  /** Has a SKILL.md / AGENTS.md and parses as a skill. */
  isSkill: boolean;
  /** Bundle = directory containing nested skills. */
  isBundle: boolean;
  /** Number of nested skills detected (when isBundle). */
  nestedCount: number;
}

export interface ResolvedLibraryRoot {
  libraryPath: string;
  historyPath: string;
}

/** Map a LibraryRoot preset (or custom path) to {library, history}. */
export function resolveLibraryRoot(
  root: LibraryRoot,
  customPath: string | null,
): ResolvedLibraryRoot {
  switch (root) {
    case "claude":
      return {
        libraryPath: join(homedir(), ".claude", "skills"),
        historyPath: join(homedir(), ".claude", "skills-history"),
      };
    case "centralized":
      return {
        libraryPath: join(homedir(), ".skill-stack", "skills"),
        historyPath: join(homedir(), ".skill-stack", "skills-history"),
      };
    case "custom": {
      if (!customPath) {
        throw new Error(
          "resolveLibraryRoot: custom requires a non-empty customPath",
        );
      }
      if (!isAbsolute(customPath)) {
        throw new Error(
          `resolveLibraryRoot: custom path must be absolute (got ${customPath})`,
        );
      }
      // History sits beside the chosen library: <parent>/<basename>-history.
      // Keeps the pair colocated regardless of where the user picked.
      const parent = dirname(customPath);
      const base = customPath.split("/").pop() || "skills";
      return {
        libraryPath: customPath,
        historyPath: join(parent, `${base}-history`),
      };
    }
  }
}

/** Forbidden roots that would make the library unsafe or accidentally
 *  destructive if used as a target. */
const FORBIDDEN_PREFIXES = [
  "/", // bare root
  "/etc",
  "/System",
  "/usr/bin",
  "/usr/sbin",
  "/sbin",
  "/var",
  "/private/etc",
  "/private/var",
];

/** Validate a candidate library path. Returns null if OK, otherwise an
 *  error string the UI can render inline. */
export async function validateLibraryPath(p: string): Promise<string | null> {
  if (typeof p !== "string" || p.trim().length === 0) {
    return "Path is required.";
  }
  if (!isAbsolute(p)) {
    return "Path must be absolute (start with /).";
  }
  const trimmed = p.replace(/\/+$/, "");
  // Bare root: trimmed is empty (since the only chars were slashes).
  // Treat that as the bare-root case explicitly.
  if (trimmed === "") {
    return "Refusing to use / as the library — pick a subdirectory.";
  }
  for (const banned of FORBIDDEN_PREFIXES) {
    if (trimmed === banned) {
      return `Refusing to use ${banned} as the library — pick a subdirectory.`;
    }
  }
  // Walk up the path looking for the deepest ancestor that exists; that
  // tells us whether we'll be allowed to mkdir -p down to the chosen
  // path. We don't require the immediate parent to exist — completeSetup
  // does `fs.mkdir({recursive: true})` so any depth of new folders is
  // fine, as long as some ancestor up the chain is a writable directory.
  let probe = trimmed;
  while (probe !== "/" && probe !== "") {
    try {
      const stat = await fs.stat(probe);
      if (stat.isDirectory()) {
        // Found a real ancestor (or the path itself is a real dir).
        return null;
      }
      // It's a file — refuse to recurse into a file path.
      return `${probe} exists but is not a directory.`;
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        // Walk up another level.
        probe = dirname(probe);
        continue;
      }
      return `Cannot access ${probe}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return "Path has no existing ancestor — pick something under your home dir.";
}

/**
 * Walk a directory looking for skill-shaped subdirectories so the SetupFlow
 * can offer to import them. Only scans one level deep (directories
 * directly inside `rootPath`). Returns isSkill/isBundle/nested-count from
 * `detectSkillType` so the UI can show meaningful choices.
 */
export async function scanForExistingSkills(
  rootPath: string,
): Promise<DetectedSkill[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw err;
  }
  const found: DetectedSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = join(rootPath, entry.name);
    try {
      const detection = await detectSkillType(dir);
      if (!detection.isSkill && !detection.isBundle) continue;
      found.push({
        name: entry.name,
        path: dir,
        isSkill: detection.isSkill,
        isBundle: detection.isBundle,
        nestedCount: detection.nested.length,
      });
    } catch {
      // skip
    }
  }
  return found.sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
}

export interface CompleteSetupArgs {
  libraryRoot: LibraryRoot;
  customPath: string | null;
  primaryAgent: string;
  defaultDeployMode: DeployMode;
  /** Optional — skills to copy from elsewhere into the new library
   *  during setup. Each entry's `name` becomes the destination folder. */
  importSkills?: { name: string; sourcePath: string }[];
}

export interface CompleteSetupResult {
  setup: SetupConfig;
  imported: string[];
  skipped: { name: string; reason: string }[];
}

/**
 * Persist setup choices, ensure the library + history directories exist,
 * import any selected skills (skipping name conflicts), call
 * configurePaths so the rest of the backend resolves to the new location,
 * and return the finalized SetupConfig.
 */
export async function completeSetup(
  args: CompleteSetupArgs,
): Promise<CompleteSetupResult> {
  const { libraryPath, historyPath } = resolveLibraryRoot(
    args.libraryRoot,
    args.customPath,
  );
  const validation = await validateLibraryPath(libraryPath);
  if (validation) throw new Error(validation);

  await fs.mkdir(libraryPath, { recursive: true });
  await fs.mkdir(historyPath, { recursive: true });

  // Import phase: copy selected skills into the new library. Conflicts
  // (name already exists at the destination) are skipped — the SetupFlow
  // pre-warned the user and we never overwrite during setup.
  const imported: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const entry of args.importSkills ?? []) {
    const dest = join(libraryPath, entry.name);
    try {
      await fs.access(dest);
      skipped.push({
        name: entry.name,
        reason: `Already exists at ${dest}`,
      });
      continue;
    } catch {
      // OK — destination free.
    }
    try {
      await fs.cp(entry.sourcePath, dest, {
        recursive: true,
        verbatimSymlinks: false,
      });
      imported.push(entry.name);
    } catch (err) {
      skipped.push({
        name: entry.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Persist setup state + bump default_deploy_mode.
  const setup: SetupConfig = {
    completed: true,
    version: 1,
    libraryRoot: args.libraryRoot,
    libraryPath,
    historyPath,
    primaryAgent: args.primaryAgent,
    completedAt: nowIso(),
  };
  await withConfigLock(async () => {
    const config = await loadConfig();
    config.setup = setup;
    config.settings.default_deploy_mode = args.defaultDeployMode;
    await saveConfig(config);
  });

  // Now that the setup is committed, switch the runtime path resolution
  // so subsequent operations land at the new location.
  configurePaths({ libraryPath, historyPath });

  return { setup, imported, skipped };
}
