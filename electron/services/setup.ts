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

/**
 * What the scanner thinks a candidate directory is.
 *
 * - "skill": root SKILL.md/AGENTS.md present. Canonical Anthropic skill.
 * - "bundle": no root identifier, but contains nested skills (e.g. context7
 *   ships several skills together).
 * - "package": no root identifier, no nested skills, but the directory
 *   *looks* substantive — has root content folders (scripts/data/commands/
 *   resources/templates/agents/hooks/tools/bin/sdk), a package.json, a
 *   Makefile, or a CLAUDE.md/GEMINI.md. Things like awesome-claude-code,
 *   get-shit-done, and MCP servers fall here. We surface them so the user
 *   can opt-in to bringing them along, but default-unchecked so we don't
 *   blindly slurp every cloned repo.
 */
export type DetectedKind = "skill" | "bundle" | "package";

export interface DetectedSkill {
  /** Skill name = directory basename. */
  name: string;
  /** Absolute path of the skill directory inside the scanned root. */
  path: string;
  kind: DetectedKind;
  /** Short description of why we tagged it this way, shown as a chip in
   *  the UI. Examples: "AGENTS.md", "scripts/, data/", "5 skills". */
  reason: string;
  /** Back-compat alias for `kind === "skill"`. */
  isSkill: boolean;
  /** Back-compat alias for `kind === "bundle"`. */
  isBundle: boolean;
  /** Number of nested skills detected (when isBundle). */
  nestedCount: number;
  /** When set, the detected entry was found one level below the scan root,
   *  inside a container directory of this name (e.g. "skills/"). The UI
   *  uses this to show provenance like "via skills/" so the user understands
   *  what we descended into. */
  viaContainer?: string;
}

/**
 * Top-level entries we never treat as skills, regardless of contents.
 *
 * - plugins / marketplaces: Claude Code plugin system. We are not a plugin
 *   manager — those are handled by the agent itself.
 * - skills-history: snapshot directory we (or the legacy app) own.
 * - agents / commands / hooks: Claude home siblings of skills/. If the user
 *   accidentally points the scan at ~/.claude instead of ~/.claude/skills,
 *   we don't want these masquerading as skills.
 * - cache / file-history / sessions / etc: Claude internal state.
 * - .git / node_modules / .DS_Store / dot-prefixed: never skills.
 */
const SCAN_EXCLUDE_NAMES = new Set([
  "plugins",
  "marketplaces",
  "skills-history",
  "agents",
  "commands",
  "hooks",
  "cache",
  "image-cache",
  "paste-cache",
  "file-history",
  "session-env",
  "sessions",
  "shell-snapshots",
  "ide",
  "downloads",
  "debug",
  "backups",
  "projects",
  "plans",
  "node_modules",
  ".git",
  ".DS_Store",
]);

/**
 * Names that, when found as a single child of the scan root with no root
 * identifier and nested skills inside, indicate a library container — we
 * should descend into it and present its children as candidates instead.
 *
 * This catches the common bad shape `~/.skill-stack/skills/skills/` (a
 * library re-nested inside itself by a buggy migration) without breaking
 * legitimate multi-skill bundles like `context7/` or `n8n-skills/`.
 */
const CONTAINER_DESCEND_NAMES = new Set(["skills", "library"]);

/**
 * Root markers that indicate a directory is a substantive "package" even
 * if it isn't a skill in the SKILL.md sense. We use these to surface
 * content-rich folders (awesome-claude-code, get-shit-done, MCP servers)
 * as opt-in candidates during onboarding rather than silently skipping
 * them.
 */
const PACKAGE_DIR_MARKERS = [
  "scripts",
  "data",
  "commands",
  "references",
  "resources",
  "templates",
  "tools",
  "agents",
  "hooks",
  "bin",
  "sdk",
] as const;
const PACKAGE_FILE_MARKERS = [
  "package.json",
  "Makefile",
  "CLAUDE.md",
  "GEMINI.md",
] as const;

/**
 * Probe a directory for package markers. Returns the human-readable list
 * of markers found (used as the `reason` chip in the UI), or null if the
 * directory has nothing that would make it useful to track.
 */
async function detectPackageMarkers(dir: string): Promise<string[]> {
  const found: string[] = [];
  // Cheap reads; bail early once we have something to show. We DON'T
  // bail at first hit because the UI shows up to 3 markers — gives the
  // user a sense of what's inside.
  for (const m of PACKAGE_DIR_MARKERS) {
    try {
      const st = await fs.stat(join(dir, m));
      if (st.isDirectory()) found.push(`${m}/`);
    } catch {
      // not present
    }
    if (found.length >= 3) break;
  }
  if (found.length < 3) {
    for (const m of PACKAGE_FILE_MARKERS) {
      try {
        const st = await fs.stat(join(dir, m));
        if (st.isFile()) found.push(m);
      } catch {
        // not present
      }
      if (found.length >= 3) break;
    }
  }
  return found;
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
 * can offer to import them.
 *
 * Rules (see SCAN_EXCLUDE_NAMES / CONTAINER_DESCEND_NAMES above):
 *  1. Hard-skip names like `plugins/`, `skills-history/`, `agents/` etc.
 *     These are never skills and showing them as bundles is the bug we hit
 *     on first-run when scanning `~/.claude` siblings of `skills/`.
 *  2. For each remaining child, run `detectSkillType`:
 *     - `isSkill` (root SKILL.md/AGENTS.md) → emit as one entry
 *     - `isBundle` (no root identifier, nested skills) → if the directory
 *       is named `skills`/`library`, treat as a *library container* and
 *       emit the entries inside it instead (one level deep). Otherwise
 *       emit as a single bundle.
 *     - neither → skip
 *  3. Containers can't recursively descend into more containers — that
 *     would be a footgun on weird disk shapes.
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
  // Map keyed by skill name so a duplicate (same name nested in a container
  // and at top level) collapses to one row. Last-wins.
  const found = new Map<string, DetectedSkill>();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (SCAN_EXCLUDE_NAMES.has(entry.name)) continue;
    const dir = join(rootPath, entry.name);
    let detection;
    try {
      detection = await detectSkillType(dir);
    } catch {
      continue;
    }

    if (detection.isSkill) {
      const reason = detection.identifiers.join(", ") || "skill";
      found.set(entry.name, {
        name: entry.name,
        path: dir,
        kind: "skill",
        reason,
        isSkill: true,
        isBundle: detection.nested.length > 0,
        nestedCount: detection.nested.length,
      });
      continue;
    }

    if (
      CONTAINER_DESCEND_NAMES.has(entry.name) &&
      detection.identifiers.length === 0 &&
      detection.content.length === 0
    ) {
      // Library container: a folder named skills/library with no root
      // identifier and no content folders is almost certainly a
      // directory-of-skills (typically the bad-migration shape
      // skills/skills/). Descend one level and classify each child;
      // do NOT descend further. Note: we don't gate on isBundle here so
      // packages-inside-containers (e.g. skills/awesome-claude-code)
      // also surface.
      let childEntries: import("node:fs").Dirent[];
      try {
        childEntries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of childEntries) {
        if (!child.isDirectory()) continue;
        if (child.name.startsWith(".")) continue;
        if (SCAN_EXCLUDE_NAMES.has(child.name)) continue;
        const childDir = join(dir, child.name);
        let childDetection;
        try {
          childDetection = await detectSkillType(childDir);
        } catch {
          continue;
        }
        if (childDetection.isSkill) {
          found.set(child.name, {
            name: child.name,
            path: childDir,
            kind: "skill",
            reason: childDetection.identifiers.join(", ") || "skill",
            isSkill: true,
            isBundle: childDetection.nested.length > 0,
            nestedCount: childDetection.nested.length,
            viaContainer: entry.name,
          });
        } else if (childDetection.isBundle) {
          found.set(child.name, {
            name: child.name,
            path: childDir,
            kind: "bundle",
            reason: `${childDetection.nested.length} skill${childDetection.nested.length === 1 ? "" : "s"}`,
            isSkill: false,
            isBundle: true,
            nestedCount: childDetection.nested.length,
            viaContainer: entry.name,
          });
        } else {
          // Package check inside a container — same content/file probes as
          // top-level so awesome-claude-code etc. surface even when nested.
          const markers = await detectPackageMarkers(childDir);
          if (markers.length > 0) {
            found.set(child.name, {
              name: child.name,
              path: childDir,
              kind: "package",
              reason: markers.slice(0, 3).join(", "),
              isSkill: false,
              isBundle: false,
              nestedCount: 0,
              viaContainer: entry.name,
            });
          }
        }
      }
      continue;
    }

    if (detection.isBundle) {
      found.set(entry.name, {
        name: entry.name,
        path: dir,
        kind: "bundle",
        reason: `${detection.nested.length} skill${detection.nested.length === 1 ? "" : "s"}`,
        isSkill: false,
        isBundle: true,
        nestedCount: detection.nested.length,
      });
      continue;
    }

    // Not a skill, not a bundle — last chance: does it look like a
    // substantive package the user might want anyway?
    const markers = await detectPackageMarkers(dir);
    if (markers.length > 0) {
      found.set(entry.name, {
        name: entry.name,
        path: dir,
        kind: "package",
        reason: markers.slice(0, 3).join(", "),
        isSkill: false,
        isBundle: false,
        nestedCount: 0,
      });
    }
  }
  return Array.from(found.values()).sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
}

/**
 * How to bring an existing skill into the new library.
 *
 * - `copy`: clone the source into the library (originals untouched).
 * - `move`: relocate the source into the library, then leave a symlink at
 *   the original path pointing back. Makes the library the source of truth
 *   while keeping the agent's directory functional. Used when the user
 *   picks "move to Skill Manager library" during onboarding.
 */
export type ImportMode = "copy" | "move";

export interface CompleteSetupArgs {
  libraryRoot: LibraryRoot;
  customPath: string | null;
  primaryAgent: string;
  defaultDeployMode: DeployMode;
  /** Optional — skills to bring into the new library during setup. Each
   *  entry's `name` becomes the destination folder; `mode` defaults to
   *  "copy" if omitted (preserves prior behaviour). */
  importSkills?: { name: string; sourcePath: string; mode?: ImportMode }[];
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

  // Import phase: copy or move selected skills into the new library.
  // Conflicts (name already exists at the destination) are skipped — the
  // SetupFlow pre-warned the user and we never overwrite during setup.
  const imported: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const entry of args.importSkills ?? []) {
    const mode: ImportMode = entry.mode ?? "copy";
    const dest = join(libraryPath, entry.name);

    // Source must exist.
    try {
      await fs.lstat(entry.sourcePath);
    } catch {
      skipped.push({
        name: entry.name,
        reason: `Source not found: ${entry.sourcePath}`,
      });
      continue;
    }

    // Source already pointing at dest (already a symlink to dest, or same
    // path) — nothing to do. Helpful when the user re-runs onboarding.
    try {
      const real = await fs.realpath(entry.sourcePath);
      const realDest = await fs.realpath(dest).catch(() => dest);
      if (real === realDest) {
        imported.push(entry.name);
        continue;
      }
    } catch {
      // realpath may throw on broken symlinks — fall through.
    }

    // Conflict at destination — skip, don't overwrite.
    let destExists = false;
    try {
      await fs.lstat(dest);
      destExists = true;
    } catch {
      // OK — destination free.
    }
    if (destExists) {
      skipped.push({
        name: entry.name,
        reason: `Already exists at ${dest}`,
      });
      continue;
    }

    try {
      if (mode === "move") {
        // 1. Move source → dest. fs.rename is atomic within a filesystem;
        //    falls back to copy+rm if the source crosses filesystems.
        try {
          await fs.rename(entry.sourcePath, dest);
        } catch (err) {
          if (
            err &&
            typeof err === "object" &&
            "code" in err &&
            (err as NodeJS.ErrnoException).code === "EXDEV"
          ) {
            await fs.cp(entry.sourcePath, dest, {
              recursive: true,
              verbatimSymlinks: false,
            });
            await fs.rm(entry.sourcePath, { recursive: true, force: true });
          } else {
            throw err;
          }
        }
        // 2. Leave a symlink behind so the agent's directory still works.
        //    Best-effort: if the symlink fails, the skill is safe at dest
        //    and we surface the partial-success in the skipped reason.
        try {
          await fs.symlink(dest, entry.sourcePath);
        } catch (err) {
          skipped.push({
            name: entry.name,
            reason: `Moved to ${dest} but symlink-back failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          });
          imported.push(entry.name);
          continue;
        }
      } else {
        await fs.cp(entry.sourcePath, dest, {
          recursive: true,
          verbatimSymlinks: false,
        });
      }
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
