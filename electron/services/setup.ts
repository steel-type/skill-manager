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
 * Recursively compare two skill directories. Returns:
 *  - "identical": every file present in both with matching contents
 *  - "differs": at least one file differs, is missing on one side, or
 *    a directory entry has different type
 *  - "missing": one side doesn't exist
 *
 * Used during onboarding to decide whether an agent-side skill that
 * collides with an existing library entry can be auto-symlinked
 * (identical, no data loss) or needs explicit conflict resolution.
 *
 * Skips noise: .git, node_modules, .DS_Store. Caps total bytes read at
 * ~64 MB so a runaway bundle doesn't lock the main process; if the cap
 * is exceeded we conservatively return "differs".
 */
const COMPARE_SKIP = new Set([".git", "node_modules", ".DS_Store"]);
const COMPARE_BYTE_CAP = 64 * 1024 * 1024;

export async function compareSkillDirs(
  a: string,
  b: string,
): Promise<"identical" | "differs" | "missing"> {
  const aExists = await fs.stat(a).then(
    (s) => s.isDirectory(),
    () => false,
  );
  const bExists = await fs.stat(b).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!aExists || !bExists) return "missing";

  let bytesRead = 0;
  let result: "identical" | "differs" = "identical";

  async function walk(relPath: string): Promise<boolean> {
    const aDir = relPath ? join(a, relPath) : a;
    const bDir = relPath ? join(b, relPath) : b;
    let aEntries: import("node:fs").Dirent[];
    let bEntries: import("node:fs").Dirent[];
    try {
      aEntries = await fs.readdir(aDir, { withFileTypes: true });
      bEntries = await fs.readdir(bDir, { withFileTypes: true });
    } catch {
      result = "differs";
      return false;
    }
    const aNames = new Map(
      aEntries
        .filter((e) => !COMPARE_SKIP.has(e.name))
        .map((e) => [e.name, e]),
    );
    const bNames = new Map(
      bEntries
        .filter((e) => !COMPARE_SKIP.has(e.name))
        .map((e) => [e.name, e]),
    );
    if (aNames.size !== bNames.size) {
      result = "differs";
      return false;
    }
    for (const [name, aEntry] of aNames) {
      const bEntry = bNames.get(name);
      if (!bEntry) {
        result = "differs";
        return false;
      }
      // Type must match (both file, both dir, both symlink, etc).
      if (aEntry.isDirectory() !== bEntry.isDirectory()) {
        result = "differs";
        return false;
      }
      const childRel = relPath ? `${relPath}/${name}` : name;
      if (aEntry.isDirectory()) {
        const ok = await walk(childRel);
        if (!ok) return false;
      } else if (aEntry.isFile()) {
        const aPath = join(aDir, name);
        const bPath = join(bDir, name);
        const [aStat, bStat] = await Promise.all([
          fs.stat(aPath),
          fs.stat(bPath),
        ]);
        if (aStat.size !== bStat.size) {
          result = "differs";
          return false;
        }
        bytesRead += aStat.size;
        if (bytesRead > COMPARE_BYTE_CAP) {
          result = "differs"; // conservative: too big to fully verify
          return false;
        }
        const [aBuf, bBuf] = await Promise.all([
          fs.readFile(aPath),
          fs.readFile(bPath),
        ]);
        if (!aBuf.equals(bBuf)) {
          result = "differs";
          return false;
        }
      } else {
        // symlink or other special — bail conservatively
        result = "differs";
        return false;
      }
    }
    return true;
  }

  await walk("");
  return result;
}

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

/**
 * Wire every library entry into an agent's global skills dir so the
 * agent can discover them. For each top-level dir in the library,
 * ensure {agentSkillsDir}/{name} exists pointing at it.
 *
 * Behavior per entry:
 *  - target missing            → create symlink (or copy when mode=copy)
 *  - target is a symlink to lib → no-op
 *  - target is a symlink elsewhere → replace with symlink to lib
 *  - target is a real dir      → leave alone (we never overwrite real
 *    user content at the agent dir without explicit confirmation)
 *
 * Returns counts so the caller can summarize. Best-effort per entry —
 * one failure doesn't block the others.
 */
export async function wireLibraryIntoAgentDir(
  agentSkillsDir: string,
  libraryPath: string,
  mode: DeployMode,
): Promise<{
  created: string[];
  alreadyLinked: string[];
  redirected: string[];
  skipped: { name: string; reason: string }[];
}> {
  const result = {
    created: [] as string[],
    alreadyLinked: [] as string[],
    redirected: [] as string[],
    skipped: [] as { name: string; reason: string }[],
  };

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(libraryPath, { withFileTypes: true });
  } catch {
    return result;
  }
  await fs.mkdir(agentSkillsDir, { recursive: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const source = join(libraryPath, entry.name);
    const target = join(agentSkillsDir, entry.name);

    let targetStat: import("node:fs").Stats | null = null;
    try {
      targetStat = await fs.lstat(target);
    } catch {
      targetStat = null;
    }

    try {
      if (!targetStat) {
        if (mode === "symlink") {
          await fs.symlink(source, target);
        } else {
          await fs.cp(source, target, {
            recursive: true,
            verbatimSymlinks: false,
          });
        }
        result.created.push(entry.name);
        continue;
      }

      if (targetStat.isSymbolicLink()) {
        const existingLink = await fs.readlink(target);
        if (existingLink === source) {
          result.alreadyLinked.push(entry.name);
          continue;
        }
        // Symlink, but pointing somewhere else (e.g. an old library).
        // Repoint at the canonical source.
        await fs.rm(target, { force: true });
        if (mode === "symlink") {
          await fs.symlink(source, target);
        } else {
          await fs.cp(source, target, {
            recursive: true,
            verbatimSymlinks: false,
          });
        }
        result.redirected.push(entry.name);
        continue;
      }

      // Real dir at target — don't clobber. Skip with reason.
      result.skipped.push({
        name: entry.name,
        reason: `Real directory exists at ${target} — not overwriting`,
      });
    } catch (err) {
      result.skipped.push({
        name: entry.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
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

/**
 * Move a source dir into the library and leave a symlink at the original
 * location. fs.rename is atomic within a filesystem; falls back to
 * copy+rm if the source crosses filesystems (EXDEV).
 *
 * Symlink-back failures are not silent — they throw, since the caller
 * needs to surface the partial-success state to the user (skill is at
 * dest, original location won't see it).
 */
async function moveAndSymlink(source: string, dest: string): Promise<void> {
  try {
    await fs.rename(source, dest);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "EXDEV"
    ) {
      await fs.cp(source, dest, {
        recursive: true,
        verbatimSymlinks: false,
      });
      await fs.rm(source, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
  await fs.symlink(dest, source);
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
  // Helper: a name is dir-shaped if the entry itself is a directory OR
  // it's a symlink whose target resolves to a directory. The latter is
  // the on-disk reality after onboarding's "move + symlink-back" path,
  // so missing it makes the agent-scan come up empty when in fact
  // every skill is reachable via symlink.
  async function resolvesAsDir(
    base: string,
    entry: import("node:fs").Dirent,
  ): Promise<boolean> {
    if (entry.isDirectory()) return true;
    if (!entry.isSymbolicLink()) return false;
    try {
      const targetStat = await fs.stat(join(base, entry.name));
      return targetStat.isDirectory();
    } catch {
      return false; // broken symlink
    }
  }

  // Map keyed by skill name so a duplicate (same name nested in a container
  // and at top level) collapses to one row. Last-wins.
  const found = new Map<string, DetectedSkill>();
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (SCAN_EXCLUDE_NAMES.has(entry.name)) continue;
    if (!(await resolvesAsDir(rootPath, entry))) continue;
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
        if (child.name.startsWith(".")) continue;
        if (SCAN_EXCLUDE_NAMES.has(child.name)) continue;
        if (!(await resolvesAsDir(dir, child))) continue;
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
 *   picks "move to Skillbase library" during onboarding.
 */
export type ImportMode = "copy" | "move";

/**
 * What to do when a skill's destination in the library already exists.
 *
 * - "new": no library entry — proceed (move or copy depending on mode).
 * - "identical": same name, byte-equal contents. With move mode this
 *   means "drop agent dir and symlink to library" (no data move). With
 *   copy mode this is a no-op.
 * - "keep-agent": library has an entry but it differs; user chose to
 *   keep the agent-side version. We overwrite the library entry, then
 *   (move) symlink the agent dir, or (copy) leave the agent dir alone.
 * - "keep-library": library entry differs; user chose to keep it. With
 *   move mode the agent dir is replaced with a symlink to library. With
 *   copy mode this is a no-op (agent stays as independent older copy).
 * - "skip": no action; both stay as they are.
 */
export type ImportResolution =
  | "new"
  | "identical"
  | "keep-agent"
  | "keep-library"
  | "skip";

export interface CompleteSetupArgs {
  libraryRoot: LibraryRoot;
  customPath: string | null;
  primaryAgent: string;
  defaultDeployMode: DeployMode;
  /** Optional — skills to bring into the new library during setup.
   *  Each entry pairs a source path with an import mode and a per-skill
   *  resolution that determines how conflicts at the destination are
   *  handled. `mode` and `resolution` default to "copy"/"new" if omitted
   *  (preserves prior call sites). */
  importSkills?: {
    name: string;
    sourcePath: string;
    mode?: ImportMode;
    resolution?: ImportResolution;
  }[];
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

  const imported: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  // Stack-id collision guard. createStack already refuses to land a stack
  // whose id matches an existing library dir; the inverse — refusing an
  // imported skill whose name matches an existing stack id — needs to
  // happen here so a sloppy onboarding import can't clobber a meta-skill.
  const { loadConfig } = await import("./config");
  const preConfig = await loadConfig();
  const stackIds = new Set(preConfig.stacks.map((s) => s.id));

  for (const entry of args.importSkills ?? []) {
    const mode: ImportMode = entry.mode ?? "copy";
    const resolution: ImportResolution = entry.resolution ?? "new";
    const dest = join(libraryPath, entry.name);

    if (resolution === "skip") {
      skipped.push({ name: entry.name, reason: "skipped by user" });
      continue;
    }
    if (stackIds.has(entry.name)) {
      skipped.push({
        name: entry.name,
        reason: `Name collides with stack '${entry.name}' — rename the source folder before importing`,
      });
      continue;
    }

    // Source must exist (lstat — symlinks count).
    try {
      await fs.lstat(entry.sourcePath);
    } catch {
      skipped.push({
        name: entry.name,
        reason: `Source not found: ${entry.sourcePath}`,
      });
      continue;
    }

    // Already-symlinked: source resolves to dest. No-op regardless of
    // mode/resolution — re-running onboarding on a symlinked agent dir.
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

    try {
      // Per (mode, resolution), decide what to do with library/dest and
      // with agent/source. The combinations are documented in the
      // ImportResolution doc above.
      const destExists = await fs
        .lstat(dest)
        .then(() => true)
        .catch(() => false);

      if (mode === "move") {
        if (resolution === "new") {
          if (destExists) {
            skipped.push({
              name: entry.name,
              reason: `Library entry exists at ${dest} but resolution was 'new'; expected scanner to flag conflict`,
            });
            continue;
          }
          await moveAndSymlink(entry.sourcePath, dest);
        } else if (resolution === "identical") {
          // Library already has an identical copy — drop agent dir,
          // symlink it to library. Library is canonical.
          await fs.rm(entry.sourcePath, { recursive: true, force: true });
          await fs.symlink(dest, entry.sourcePath);
        } else if (resolution === "keep-agent") {
          // Replace library with agent's version, then symlink.
          if (destExists) {
            await fs.rm(dest, { recursive: true, force: true });
          }
          await moveAndSymlink(entry.sourcePath, dest);
        } else if (resolution === "keep-library") {
          // Library wins — drop agent copy, symlink to library.
          await fs.rm(entry.sourcePath, { recursive: true, force: true });
          await fs.symlink(dest, entry.sourcePath);
        }
      } else {
        // copy mode: never modify the agent dir.
        if (resolution === "new") {
          if (destExists) {
            skipped.push({
              name: entry.name,
              reason: `Library entry exists at ${dest} but resolution was 'new'`,
            });
            continue;
          }
          await fs.cp(entry.sourcePath, dest, {
            recursive: true,
            verbatimSymlinks: false,
          });
        } else if (resolution === "identical") {
          // Library already has it. Nothing to do.
        } else if (resolution === "keep-agent") {
          if (destExists) {
            await fs.rm(dest, { recursive: true, force: true });
          }
          await fs.cp(entry.sourcePath, dest, {
            recursive: true,
            verbatimSymlinks: false,
          });
        } else if (resolution === "keep-library") {
          // Library wins — agent dir stays as-is (independent copy).
        }
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
