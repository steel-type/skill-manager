import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { LIBRARY_PATH } from "./paths";
import { AGENTS, resolveAgentPaths } from "./agents";
import type { Deployment, DeployMode } from "./types";

export interface DeployOptions {
  agentId: string;
  deployMode: DeployMode;
}

export interface DeployResult {
  /** The mode that actually ran. May differ from the requested mode if the
   *  target agent doesn't support symlinks (we fall back to copy and surface
   *  a warning). */
  deployMode: DeployMode;
  warning: string | null;
  /** Concrete on-disk destination (directory or single .mdc file). */
  destPath: string;
}

async function librarySource(name: string): Promise<string> {
  const src = join(LIBRARY_PATH, name);
  try {
    const stat = await fs.stat(src);
    if (!stat.isDirectory()) {
      throw new Error(`Skill '${name}' not in library`);
    }
  } catch {
    throw new Error(`Skill '${name}' not in library`);
  }
  return src;
}

/**
 * Deploy a library skill into a project for a specific agent.
 *
 * Mode `copy` replicates the source directory (or, for single-file agents
 * like cursor, copies the entry file). Mode `symlink` creates a symbolic
 * link from the resolved target back to the library path so subsequent
 * library updates flow through without a re-cascade. If the agent has
 * `supportsSymlinks: false` we transparently fall back to copy and surface
 * a warning string in the result.
 *
 * Cursor uses a single-file destination (.cursor/rules/<name>.mdc); every
 * other agent currently uses a per-skill directory. The branch checks for
 * a `{name}` placeholder in the agent's entryFile template.
 */
export async function deployToProject(
  skillName: string,
  projectPath: string,
  opts: DeployOptions,
): Promise<DeployResult> {
  const src = await librarySource(skillName);
  const agent = AGENTS[opts.agentId];
  if (!agent) throw new Error(`Unknown agent: ${opts.agentId}`);

  // The project root must already exist as a directory. Without this
  // check, fs.mkdir(parent, recursive:true) silently materializes the
  // whole tree (e.g. `<typo>/.claude/skills/foo`), making the deploy
  // appear to succeed at a path that's not actually a project.
  try {
    const stat = await fs.stat(projectPath);
    if (!stat.isDirectory()) {
      throw new Error(
        `Project path is not a directory: ${projectPath}`,
      );
    }
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(
        `Project does not exist: ${projectPath}. Create the directory first or pick a different path.`,
      );
    }
    throw err;
  }

  const resolved = resolveAgentPaths(opts.agentId, skillName, projectPath);
  if (!resolved.projectPath) {
    throw new Error(
      `Agent '${opts.agentId}' has no project-level deployment path`,
    );
  }

  let mode: DeployMode = opts.deployMode;
  let warning: string | null = null;
  if (mode === "symlink" && !agent.supportsSymlinks) {
    mode = "copy";
    warning = `${agent.displayName} does not support symlink deployment — falling back to copy.`;
  }

  // Single-file agents (cursor today) write one entry file inside the
  // resolved directory. Everything else replaces a per-skill subdirectory.
  const isSingleFile = /{name}/.test(agent.entryFile);
  const dest = isSingleFile
    ? join(resolved.projectPath, resolved.entryFile)
    : resolved.projectPath;
  const sourcePath = isSingleFile ? join(src, "SKILL.md") : src;

  await fs.mkdir(dirname(dest), { recursive: true });
  // Remove anything currently at the destination — file, directory, or
  // stale symlink — before writing the fresh deployment.
  await fs.rm(dest, { recursive: true, force: true });

  if (mode === "symlink") {
    await fs.symlink(sourcePath, dest);
    // Defense in depth: verify the symlink resolves where we asked.
    try {
      const realDest = await fs.realpath(dest);
      const realSrc = await fs.realpath(sourcePath);
      if (realDest !== realSrc) {
        await fs.rm(dest, { force: true });
        throw new Error(
          `Symlink verification failed: ${dest} resolved to ${realDest}, expected ${realSrc}`,
        );
      }
    } catch (err) {
      await fs.rm(dest, { force: true });
      throw err;
    }
  } else if (isSingleFile) {
    // Single-file copy — fs.cp would refuse if dest already exists; we
    // already cleared it above so a plain copyFile is enough.
    await fs.copyFile(sourcePath, dest);
  } else {
    await fs.cp(sourcePath, dest, { recursive: true });
  }

  return { deployMode: mode, warning, destPath: dest };
}

/**
 * Backward-compatible thin wrapper that defaults to claude/copy. Existing
 * call sites in operations.ts continue to work; new code should call
 * deployToProject directly so it can pass agent + mode.
 */
export async function copyToProject(
  skillName: string,
  projectPath: string,
): Promise<void> {
  await deployToProject(skillName, projectPath, {
    agentId: "claude",
    deployMode: "copy",
  });
}

/**
 * Cascade an updated library skill into every tracked deployment. Symlink
 * entries are skipped (the link already points at the updated library copy)
 * and reported separately so callers can summarize accurately.
 */
export async function cascadeToDeployments(
  skillName: string,
  deployments: Deployment[],
): Promise<{ updated: string[]; failed: string[]; skipped: string[] }> {
  const updated: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  for (const d of deployments) {
    if (d.deployMode === "symlink") {
      skipped.push(d.projectPath);
      continue;
    }
    try {
      const stat = await fs.stat(d.projectPath);
      if (!stat.isDirectory()) {
        failed.push(d.projectPath);
        continue;
      }
      await deployToProject(skillName, d.projectPath, {
        agentId: d.agentId,
        deployMode: "copy",
      });
      updated.push(d.projectPath);
    } catch {
      failed.push(d.projectPath);
    }
  }
  return { updated, failed, skipped };
}

/**
 * Legacy cascade for callers that still pass `string[]`. Synthesizes a
 * claude/copy Deployment for each path and folds the symlink-skipped list
 * (which will be empty here) into `failed` to preserve the old return
 * shape.
 */
export async function cascadeToProjects(
  skillName: string,
  projectPaths: string[],
): Promise<{ updated: string[]; failed: string[] }> {
  const result = await cascadeToDeployments(
    skillName,
    projectPaths.map((p) => ({
      projectPath: p,
      agentId: "claude",
      deployMode: "copy",
      deployedAt: "",
    })),
  );
  return {
    updated: result.updated,
    failed: [...result.failed, ...result.skipped],
  };
}
