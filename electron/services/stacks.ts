import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { AGENTS, getAgentSkillsDir, resolveAgentPaths } from "./agents";
import { loadConfig, nowIso, saveConfig, withConfigLock } from "./config";
import { deployToProject } from "./deploy";
import { getLibraryPath } from "./paths";
import { listSkills } from "./skills";
import {
  validateProjectPath,
  validateSkillName,
  validateStackName,
} from "./validators";
import type {
  Deployment,
  DeployMode,
  Skill,
  SkillStack,
  StackDeployment,
} from "./types";

const META_BODY_INTRO =
  "This is a skill stack. When activated, also use these skills for the current session:";
const META_BODY_OUTRO =
  "Load each listed skill's full instructions before proceeding with the task.";
const META_NO_DESCRIPTION = "No description provided.";

/** A subset of {@link Skill} sufficient for meta-skill body generation. */
export type StackMember = Pick<Skill, "name" | "description">;

/** Quote a value for the simple parser in skills.ts. The parser strips
 *  outer matching `"` or `'` but does NOT unescape — so we strip embedded
 *  double quotes and only wrap when the unwrapped value would confuse the
 *  parser (leading reserved char, YAML scalar literal, multiline indicator,
 *  empty string). */
function yamlScalar(value: string): string {
  const safe = value.replace(/\s+/g, " ").trim().replace(/"/g, "'");
  if (safe.length === 0) return '""';
  const startsReserved = /^[-?:!&*|>%@`'"#]/.test(safe);
  const isLiteral = ["true", "false", "null", "~", ">-", ">", "|", "|-"].includes(safe);
  return startsReserved || isLiteral ? `"${safe}"` : safe;
}

/**
 * Generate the meta-skill SKILL.md body for a stack. Member skills are
 * referenced by NAME, not filepath — every agentskills.io-conformant agent
 * has the catalog of installed skill names available at startup, so the
 * meta-skill can hand activation off to them by name without baking in
 * agent-specific paths.
 */
export function generateMetaSkill(
  stack: SkillStack,
  members: StackMember[],
): string {
  const byName = new Map(members.map((m) => [m.name, m] as const));
  const description = stack.description.trim() || `Skill stack: ${stack.name}`;
  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: ${stack.id}`);
  lines.push(`description: ${yamlScalar(description)}`);
  lines.push("---");
  lines.push(`# ${stack.name}`);
  lines.push("");
  lines.push(META_BODY_INTRO);
  lines.push("");
  if (stack.skillIds.length === 0) {
    lines.push("_(no skills configured)_");
  } else {
    for (const id of stack.skillIds) lines.push(`- ${id}`);
  }
  lines.push("");
  lines.push(META_BODY_OUTRO);
  lines.push("");
  lines.push("## Included Skills");
  lines.push("");
  for (const id of stack.skillIds) {
    lines.push(`### ${id}`);
    const desc = byName.get(id)?.description?.trim() || META_NO_DESCRIPTION;
    lines.push(desc);
    lines.push("");
  }
  return lines.join("\n");
}

/** Resolve where the meta-skill SKILL.md (or .mdc for cursor) should land
 *  for a (stack, project, agent) tuple. Mirrors deploy.ts's single-file
 *  fork: cursor writes one `.mdc`; everyone else writes a directory whose
 *  entry file is `SKILL.md`. */
function metaSkillDestination(
  stackId: string,
  projectPath: string,
  agentId: string,
): { entryPath: string; containerPath: string; isSingleFile: boolean } {
  const agent = AGENTS[agentId];
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);
  const resolved = resolveAgentPaths(agentId, stackId, projectPath);
  if (!resolved.projectPath) {
    throw new Error(`Agent '${agentId}' has no project-level deployment path`);
  }
  const isSingleFile = /\{name\}/.test(agent.entryFile);
  if (isSingleFile) {
    const entryPath = join(resolved.projectPath, resolved.entryFile);
    return { entryPath, containerPath: entryPath, isSingleFile };
  }
  return {
    entryPath: join(resolved.projectPath, "SKILL.md"),
    containerPath: resolved.projectPath,
    isSingleFile,
  };
}

/**
 * Stage the generated meta-skill SKILL.md inside the library at
 * `<LIBRARY_PATH>/<stackId>/SKILL.md`. This makes stack meta-skills first-class
 * library citizens: symlink deployments resolve back here so composition
 * changes propagate automatically, and migration logic treats stacks
 * uniformly with regular skills (no special regeneration step).
 *
 * Idempotent — overwrites any existing file. Safe to call from createStack,
 * updateStackComposition, deployStack, and a bootstrap backfill.
 */
export async function writeMetaSkillToLibrary(
  stackId: string,
  content: string,
): Promise<string> {
  const dir = join(getLibraryPath(), stackId);
  await fs.mkdir(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  await fs.writeFile(path, content, "utf8");
  return path;
}

/** Remove the staged meta-skill from the library. Best-effort. */
export async function removeMetaSkillFromLibrary(
  stackId: string,
): Promise<void> {
  await fs.rm(join(getLibraryPath(), stackId), { recursive: true, force: true });
}

export async function writeMetaSkillToProject(
  stackId: string,
  content: string,
  projectPath: string,
  agentId: string,
): Promise<string> {
  const { entryPath } = metaSkillDestination(stackId, projectPath, agentId);
  await fs.mkdir(dirname(entryPath), { recursive: true });
  // Clear anything currently at the destination — prior meta-skill, stale
  // file, or symlink — before writing the fresh body. Matches the
  // overwrite-cleanly semantics of deployToProject.
  await fs.rm(entryPath, { recursive: true, force: true });
  await fs.writeFile(entryPath, content, "utf8");
  return entryPath;
}

export async function removeMetaSkillFromProject(
  stackId: string,
  projectPath: string,
  agentId: string,
): Promise<void> {
  const { containerPath } = metaSkillDestination(stackId, projectPath, agentId);
  await fs.rm(containerPath, { recursive: true, force: true });
}

// ── Home library deployment ──────────────────────────────────────────────────
//
// "Deploy to home library" promotes a stack from a config-only entity into
// a first-class library citizen + makes it discoverable from the user's
// primary agent. After deploy:
//   1. <library>/<id>/SKILL.md exists (already true on stack create — this
//      makes it permanent rather than incidental)
//   2. SkillStack.inHomeLibrary === true → listSkills surfaces it as a
//      Library-view entry alongside regular skills
//   3. The primary agent's global skills dir contains <stackId>/ (symlink
//      when sync mode = symlink, copy when sync mode = copy) so the agent
//      can discover and invoke the stack from any project.

export interface DeployStackToLibraryResult {
  stackId: string;
  /** Agents we wired the stack into. Empty when the user's primary agent
   *  has no global skills concept (cursor/cline) or library == agent dir. */
  wiredAgents: string[];
  warning: string | null;
}

export async function deployStackToHomeLibrary(
  rawStackId: string,
): Promise<DeployStackToLibraryResult> {
  const stackId = validateStackName(rawStackId);
  const config = await loadConfig();
  const stack = config.stacks.find((s) => s.id === stackId);
  if (!stack) throw new Error(`Stack '${stackId}' not found`);

  // Always re-generate the meta-skill body — picks up any member-description
  // drift since the last write.
  const members = await loadStackMembers(stack.skillIds);
  const metaContent = generateMetaSkill(stack, members);
  await writeMetaSkillToLibrary(stackId, metaContent);

  // Wire into the user's primary agent dir (if it has a global concept and
  // it isn't the same dir as the library — in agent-in-place setups the
  // library IS the agent dir, so the meta-skill is already discoverable).
  const wiredAgents: string[] = [];
  let warning: string | null = null;
  const primaryAgent = config.setup.primaryAgent;
  const agentSkillsDir = primaryAgent
    ? getAgentSkillsDir(primaryAgent)
    : null;
  const libraryPath = getLibraryPath();
  const mode: DeployMode = config.settings.default_deploy_mode;

  if (agentSkillsDir && agentSkillsDir !== libraryPath) {
    const target = join(agentSkillsDir, stackId);
    const source = join(libraryPath, stackId);
    try {
      await fs.mkdir(agentSkillsDir, { recursive: true });
      // Clear any prior copy/symlink at the target — overwrite-cleanly.
      await fs.rm(target, { recursive: true, force: true });
      if (mode === "symlink") {
        await fs.symlink(source, target);
      } else {
        await fs.cp(source, target, {
          recursive: true,
          verbatimSymlinks: false,
        });
      }
      wiredAgents.push(primaryAgent!);
    } catch (err) {
      warning = `Wrote stack to library, but failed to wire ${primaryAgent} dir: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }

  // Persist the flag + agents list so listSkills + remove know about it.
  await withConfigLock(async () => {
    const fresh = await loadConfig();
    const idx = fresh.stacks.findIndex((s) => s.id === stackId);
    if (idx < 0) return;
    fresh.stacks[idx] = {
      ...fresh.stacks[idx],
      inHomeLibrary: true,
      homeLibraryAgents: wiredAgents,
      updatedAt: nowIso(),
    };
    await saveConfig(fresh);
  });

  return { stackId, wiredAgents, warning };
}

export async function removeStackFromHomeLibrary(
  rawStackId: string,
): Promise<{ stackId: string; cleanedAgents: string[] }> {
  const stackId = validateStackName(rawStackId);
  const config = await loadConfig();
  const stack = config.stacks.find((s) => s.id === stackId);
  if (!stack) throw new Error(`Stack '${stackId}' not found`);

  // Remove from each agent dir we previously wired into.
  const cleanedAgents: string[] = [];
  for (const agentId of stack.homeLibraryAgents ?? []) {
    const agentSkillsDir = getAgentSkillsDir(agentId);
    if (!agentSkillsDir) continue;
    const target = join(agentSkillsDir, stackId);
    try {
      await fs.rm(target, { recursive: true, force: true });
      cleanedAgents.push(agentId);
    } catch {
      // best-effort
    }
  }

  // Note: the meta-skill at <library>/<id>/ stays in place. It's still the
  // source of truth for any per-project deployments and gets regenerated
  // on createStack/updateStackComposition. listSkills will hide it again
  // as soon as inHomeLibrary flips false.
  await withConfigLock(async () => {
    const fresh = await loadConfig();
    const idx = fresh.stacks.findIndex((s) => s.id === stackId);
    if (idx < 0) return;
    fresh.stacks[idx] = {
      ...fresh.stacks[idx],
      inHomeLibrary: false,
      homeLibraryAgents: [],
      updatedAt: nowIso(),
    };
    await saveConfig(fresh);
  });

  return { stackId, cleanedAgents };
}

// ── Orchestration ────────────────────────────────────────────────────────────

export async function listStacks(): Promise<SkillStack[]> {
  const config = await loadConfig();
  return config.stacks;
}

export async function getStackDeployments(
  stackId?: string,
): Promise<StackDeployment[]> {
  const config = await loadConfig();
  if (stackId === undefined) return config.stackDeployments;
  return config.stackDeployments.filter((d) => d.stackId === stackId);
}

function makeStackId(rawName: string): string {
  // Match the auto-kebab logic the UI will use: lowercase, replace runs of
  // non-alphanumeric with single hyphen, trim leading/trailing hyphens.
  return rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export async function createStack(
  rawName: string,
  description: string,
  rawSkillIds: string[],
): Promise<SkillStack> {
  if (typeof rawName !== "string" || rawName.trim().length === 0) {
    throw new Error("Stack name is required");
  }
  if (typeof description !== "string") {
    throw new Error("Stack description must be a string");
  }
  if (!Array.isArray(rawSkillIds)) {
    throw new Error("skillIds must be an array");
  }
  const id = validateStackName(makeStackId(rawName));
  const skillIds = rawSkillIds.map((s) => validateSkillName(s));

  const stack = await withConfigLock(async () => {
    const config = await loadConfig();
    if (config.stacks.some((s) => s.id === id)) {
      throw new Error(`A stack with id '${id}' already exists`);
    }
    // Stack ids share a namespace with skill names in the library — refuse
    // collisions so writeMetaSkillToLibrary can never clobber a real
    // skill. Belt-and-suspenders: check both the config record AND the
    // disk. Manual installs (or migrations) may produce a library dir
    // without a config.skills entry; we still must not overwrite it.
    if (config.skills[id]) {
      throw new Error(
        `Cannot create stack '${id}': a skill with that name already exists in the library`,
      );
    }
    let diskHasName = false;
    try {
      await fs.access(join(getLibraryPath(), id));
      diskHasName = true;
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        throw err;
      }
      // ENOENT — name is free on disk.
    }
    if (diskHasName) {
      throw new Error(
        `Cannot create stack '${id}': a directory already exists at ${join(getLibraryPath(), id)} — refusing to overwrite`,
      );
    }
    // Make sure each member skill is in the library — otherwise we'd happily
    // create a stack that fails to deploy the moment the user tries.
    for (const skillId of skillIds) {
      if (!config.skills[skillId]) {
        throw new Error(`Skill '${skillId}' is not in the library`);
      }
    }
    const now = nowIso();
    const newStack: SkillStack = {
      id,
      name: rawName.trim(),
      description: description.trim(),
      skillIds,
      createdAt: now,
      updatedAt: now,
    };
    config.stacks = [...config.stacks, newStack];
    await saveConfig(config);
    return newStack;
  });

  // Stage the meta-skill in the library so symlink deploys resolve back here
  // and composition changes propagate. Done outside the lock — file IO is
  // slow and the config is already authoritative.
  const members = await loadStackMembers(stack.skillIds);
  const content = generateMetaSkill(stack, members);
  await writeMetaSkillToLibrary(stack.id, content);

  return stack;
}

export interface UpdateStackCompositionResult {
  stack: SkillStack;
  added: string[];
  removed: string[];
  /** Per-deployment summary of side effects. */
  pushed: {
    projectPath: string;
    agentId: string;
    addedDeployed: string[];
    addFailed: { skillId: string; error: string }[];
    metaSkillPath: string;
  }[];
  /** When `cascadeRemoveOrphans` was passed and removed members had files
   *  deployed by this stack to projects, the cascade pass removed them
   *  unless another deployed stack at the same project still claimed the
   *  member. This array lists what was actually removed from disk. */
  cascadeRemoved: { skillId: string; projectPath: string; agentId: string }[];
  /** Removals that were SKIPPED because another deployed stack at the same
   *  project still includes this member. Surfaced so the UI can explain why
   *  some files were left behind. */
  cascadeSkipped: { skillId: string; projectPath: string; agentId: string; reason: string }[];
}

export interface UpdateStackCompositionOptions {
  /** When true, after composition is saved, remove the file deployments of
   *  removed members from every project where this stack was deployed —
   *  but only if no other deployed stack at that project still includes the
   *  member. Default: false (legacy behavior, leaves orphan files). */
  cascadeRemoveOrphans?: boolean;
}

/**
 * Compute which (skillId, project, agent) tuples would be cascade-removed
 * if `updateStackComposition(stackId, newSkillIds, { cascadeRemoveOrphans:
 * true })` were run right now. Used by the UI to preview before commit.
 *
 * A tuple is INCLUDED iff: the member is in `removed`, the stack has an
 * existing deployment at (project, agent), AND no other deployed stack at
 * the same project includes the member.
 */
export async function previewCompositionCascade(
  rawStackId: string,
  rawNewSkillIds: string[],
): Promise<{
  toRemove: { skillId: string; projectPath: string; agentId: string }[];
  toSkip: { skillId: string; projectPath: string; agentId: string; reason: string }[];
}> {
  const stackId = validateStackName(rawStackId);
  const newSkillIds = rawNewSkillIds.map((s) => validateSkillName(s));
  const config = await loadConfig();
  const existing = config.stacks.find((s) => s.id === stackId);
  if (!existing) return { toRemove: [], toSkip: [] };
  const newSet = new Set(newSkillIds);
  const removed = existing.skillIds.filter((id) => !newSet.has(id));
  const deployments = config.stackDeployments.filter(
    (d) => d.stackId === stackId,
  );
  const toRemove: { skillId: string; projectPath: string; agentId: string }[] = [];
  const toSkip: { skillId: string; projectPath: string; agentId: string; reason: string }[] = [];
  for (const skillId of removed) {
    for (const dep of deployments) {
      const ownedByOther = config.stackDeployments.some(
        (d) =>
          d.stackId !== stackId &&
          d.projectPath === dep.projectPath &&
          d.includedSkillIds.includes(skillId),
      );
      if (ownedByOther) {
        toSkip.push({
          skillId,
          projectPath: dep.projectPath,
          agentId: dep.agentId,
          reason: "Still part of another deployed stack at this project",
        });
      } else {
        toRemove.push({
          skillId,
          projectPath: dep.projectPath,
          agentId: dep.agentId,
        });
      }
    }
  }
  return { toRemove, toSkip };
}

/**
 * Replace `stack.skillIds` and re-push the change to every existing
 * deployment of this stack: deploy newly-added member skills, regenerate the
 * meta-skill SKILL.md, and update the deployment's `includedSkillIds`
 * snapshot.
 *
 * Removed skills are NOT deleted from the project filesystem — the same
 * skill may have been deployed standalone or via another stack, and we
 * have no per-deployment provenance to tell the difference. The meta-skill
 * regeneration is enough to drop them from the activate-list; the user can
 * remove the residual files via the single-skill remove flow.
 */
export async function updateStackComposition(
  rawStackId: string,
  rawNewSkillIds: string[],
  opts: UpdateStackCompositionOptions = {},
): Promise<UpdateStackCompositionResult> {
  if (!Array.isArray(rawNewSkillIds)) {
    throw new Error("skillIds must be an array");
  }
  const stackId = validateStackName(rawStackId);
  const newSkillIds = rawNewSkillIds.map((s) => validateSkillName(s));
  const cascade = opts.cascadeRemoveOrphans === true;

  // Snapshot config + member-skill descriptions outside the lock so the
  // long-running filesystem work below can run concurrently with other
  // reads. We re-take the lock at the end to atomically commit changes.
  const config = await loadConfig();
  const existing = config.stacks.find((s) => s.id === stackId);
  if (!existing) throw new Error(`Stack '${stackId}' not found`);
  for (const id of newSkillIds) {
    if (!config.skills[id]) {
      throw new Error(`Skill '${id}' is not in the library`);
    }
  }
  const oldSet = new Set(existing.skillIds);
  const newSet = new Set(newSkillIds);
  const added = newSkillIds.filter((id) => !oldSet.has(id));
  const removed = existing.skillIds.filter((id) => !newSet.has(id));

  const updatedStack: SkillStack = {
    ...existing,
    skillIds: newSkillIds,
    updatedAt: nowIso(),
  };

  const deployments = config.stackDeployments.filter(
    (d) => d.stackId === stackId,
  );

  const members = await loadStackMembers(newSkillIds);
  const metaContent = generateMetaSkill(updatedStack, members);
  // Refresh the library copy first. Symlink deployments resolve back here
  // so they pick up the change automatically; copy deployments still need a
  // re-deploy below to refresh their on-disk file.
  await writeMetaSkillToLibrary(stackId, metaContent);

  // If this stack is wired into the home library AND we're in copy mode,
  // the agent-dir copy goes stale on every composition update. Refresh it
  // so the user doesn't have to re-run "Deploy to home library" manually.
  // Symlink-mode wiring resolves to the freshly-written library copy
  // automatically and needs no action here.
  if (existing.inHomeLibrary === true) {
    const mode: DeployMode = config.settings.default_deploy_mode;
    if (mode === "copy") {
      const libraryPath = getLibraryPath();
      for (const agentId of existing.homeLibraryAgents ?? []) {
        const agentSkillsDir = getAgentSkillsDir(agentId);
        if (!agentSkillsDir || agentSkillsDir === libraryPath) continue;
        const target = join(agentSkillsDir, stackId);
        try {
          await fs.rm(target, { recursive: true, force: true });
          await fs.cp(join(libraryPath, stackId), target, {
            recursive: true,
            verbatimSymlinks: false,
          });
        } catch {
          // best-effort; user can re-run "Deploy to home library" if this
          // diverges
        }
      }
    }
  }

  const pushed: UpdateStackCompositionResult["pushed"] = [];
  for (const dep of deployments) {
    const addedDeployed: string[] = [];
    const addFailed: { skillId: string; error: string }[] = [];
    for (const skillId of added) {
      try {
        await deployToProject(skillId, dep.projectPath, {
          agentId: dep.agentId,
          deployMode: dep.deployMode,
        });
        addedDeployed.push(skillId);
      } catch (err) {
        addFailed.push({
          skillId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // For copy deployments we re-deploy the meta-skill from the freshly
    // staged library file. Symlink deployments already point at the library
    // and don't need a touch — but we still resolve the canonical path for
    // the result summary.
    const agent = AGENTS[dep.agentId];
    const isSingleFile = agent ? /{name}/.test(agent.entryFile) : false;
    let metaSkillPath: string;
    if (dep.deployMode === "symlink") {
      const resolved = resolveAgentPaths(dep.agentId, stackId, dep.projectPath);
      metaSkillPath = isSingleFile
        ? join(resolved.projectPath ?? "", resolved.entryFile)
        : join(resolved.projectPath ?? "", "SKILL.md");
    } else {
      const r = await deployToProject(stackId, dep.projectPath, {
        agentId: dep.agentId,
        deployMode: dep.deployMode,
      });
      metaSkillPath = isSingleFile ? r.destPath : join(r.destPath, "SKILL.md");
    }
    pushed.push({
      projectPath: dep.projectPath,
      agentId: dep.agentId,
      addedDeployed,
      addFailed,
      metaSkillPath,
    });
  }

  // Atomic config commit: re-load (config may have changed during FS work)
  // and merge the new stack composition + refreshed deployment snapshots.
  const finalStack = await withConfigLock(async () => {
    const fresh = await loadConfig();
    const idx = fresh.stacks.findIndex((s) => s.id === stackId);
    if (idx < 0) throw new Error(`Stack '${stackId}' was deleted mid-update`);
    fresh.stacks[idx] = updatedStack;
    fresh.stackDeployments = fresh.stackDeployments.map((d) =>
      d.stackId === stackId
        ? { ...d, includedSkillIds: [...newSkillIds], timestamp: nowIso() }
        : d,
    );
    // Mirror the new members onto each member SkillRecord.deployments so
    // future cascades reach them. (Removed members keep their record — see
    // function-level docstring.)
    for (const dep of deployments) {
      for (const skillId of added) {
        const rec = fresh.skills[skillId];
        if (!rec) continue;
        if (!rec.projects.includes(dep.projectPath)) {
          rec.projects.push(dep.projectPath);
        }
        const deps = rec.deployments ?? [];
        const i = deps.findIndex(
          (d) => d.projectPath === dep.projectPath && d.agentId === dep.agentId,
        );
        const entry: Deployment = {
          projectPath: dep.projectPath,
          agentId: dep.agentId,
          deployMode: dep.deployMode,
          deployedAt: nowIso(),
        };
        if (i >= 0) deps[i] = entry;
        else deps.push(entry);
        rec.deployments = deps;
      }
    }
    await saveConfig(fresh);
    return updatedStack;
  });

  // Cascade removal pass: opt-in. For each removed member, walk this
  // stack's existing deployments and rm the file at the resolved agent
  // path UNLESS another deployed stack at that project still includes
  // the member. The skill's record.deployments entry is also dropped so
  // the global deployment ledger stays in sync.
  const cascadeRemoved: UpdateStackCompositionResult["cascadeRemoved"] = [];
  const cascadeSkipped: UpdateStackCompositionResult["cascadeSkipped"] = [];
  if (cascade && removed.length > 0 && deployments.length > 0) {
    const reread = await loadConfig();
    for (const skillId of removed) {
      for (const dep of deployments) {
        const ownedByOther = reread.stackDeployments.some(
          (d) =>
            d.stackId !== stackId &&
            d.projectPath === dep.projectPath &&
            d.includedSkillIds.includes(skillId),
        );
        if (ownedByOther) {
          cascadeSkipped.push({
            skillId,
            projectPath: dep.projectPath,
            agentId: dep.agentId,
            reason: "Still part of another deployed stack at this project",
          });
          continue;
        }
        const agent = AGENTS[dep.agentId];
        if (!agent) continue;
        const resolved = resolveAgentPaths(dep.agentId, skillId, dep.projectPath);
        const isSingleFile = /{name}/.test(agent.entryFile);
        const target = isSingleFile
          ? join(resolved.projectPath ?? "", resolved.entryFile)
          : (resolved.projectPath ?? "");
        if (!target) continue;
        try {
          await fs.rm(target, { recursive: true, force: true });
          cascadeRemoved.push({
            skillId,
            projectPath: dep.projectPath,
            agentId: dep.agentId,
          });
        } catch {
          // Best-effort. The config update below still proceeds.
        }
      }
    }
    if (cascadeRemoved.length > 0) {
      await withConfigLock(async () => {
        const fresh = await loadConfig();
        for (const entry of cascadeRemoved) {
          const rec = fresh.skills[entry.skillId];
          if (!rec) continue;
          if (rec.deployments) {
            rec.deployments = rec.deployments.filter(
              (d) =>
                !(d.projectPath === entry.projectPath &&
                  d.agentId === entry.agentId),
            );
          }
          // Drop the project from `projects[]` if no remaining deployments.
          const stillDeployed = (rec.deployments ?? []).some(
            (d) => d.projectPath === entry.projectPath,
          );
          if (!stillDeployed) {
            rec.projects = rec.projects.filter((p) => p !== entry.projectPath);
          }
        }
        await saveConfig(fresh);
      });
    }
  }

  return { stack: finalStack, added, removed, pushed, cascadeRemoved, cascadeSkipped };
}

/**
 * Delete a stack. With `cleanup`, the meta-skill SKILL.md (or `.mdc`) is
 * removed from each tracked project. Member skill files are LEFT IN PLACE
 * for the same reasons documented on {@link updateStackComposition}.
 * Without `cleanup`, only the config entries are removed.
 */
export async function deleteStack(
  rawStackId: string,
  cleanup: boolean,
): Promise<void> {
  const stackId = validateStackName(rawStackId);
  const config = await loadConfig();
  const deployments = config.stackDeployments.filter(
    (d) => d.stackId === stackId,
  );

  // Home-library wiring (agent-dir symlinks/copies) and the library
  // meta-skill ALWAYS get torn down on delete, regardless of the
  // `cleanup` flag. The `cleanup` flag is about per-project deployments
  // (which can be many and slow to clean); home-library is one place
  // and leaving it around causes the meta-skill dir to surface in
  // listSkills as an orphan after the stack record is gone.
  const stackEntry = config.stacks.find((s) => s.id === stackId);
  for (const agentId of stackEntry?.homeLibraryAgents ?? []) {
    const agentSkillsDir = getAgentSkillsDir(agentId);
    if (!agentSkillsDir) continue;
    try {
      await fs.rm(join(agentSkillsDir, stackId), {
        recursive: true,
        force: true,
      });
    } catch {
      // best-effort
    }
  }
  try {
    await removeMetaSkillFromLibrary(stackId);
  } catch {
    // Best-effort.
  }

  if (cleanup) {
    for (const dep of deployments) {
      try {
        await removeMetaSkillFromProject(stackId, dep.projectPath, dep.agentId);
      } catch {
        // Best-effort cleanup — a project that's been moved or deleted
        // shouldn't block removing the stack from config.
      }
    }
  }

  await withConfigLock(async () => {
    const fresh = await loadConfig();
    fresh.stacks = fresh.stacks.filter((s) => s.id !== stackId);
    fresh.stackDeployments = fresh.stackDeployments.filter(
      (d) => d.stackId !== stackId,
    );
    await saveConfig(fresh);
  });
}

export interface DeployStackResult {
  stackId: string;
  projectPath: string;
  agentId: string;
  deployMode: DeployMode;
  deployed: string[];
  failed: { skillId: string; error: string }[];
  metaSkillPath: string;
  warning: string | null;
}

export interface RemoveStackDeploymentOptions {
  /** Remove the stack's meta-skill from the project. Default true to
   *  match the legacy boolean signature when this flag is omitted. */
  cleanup?: boolean;
  /** Also rm each member skill file deployed by this stack at this
   *  project. Members owned by another deployed stack at the same project
   *  are skipped. Default false. */
  cascadeMembers?: boolean;
}

export interface RemoveStackDeploymentResult {
  cascadeRemoved: { skillId: string; projectPath: string; agentId: string }[];
  cascadeSkipped: { skillId: string; projectPath: string; agentId: string; reason: string }[];
}

/** Drop a single (stack, project, agent) deployment. Mirrors
 *  {@link deleteStack} with `cleanup`, but scoped to one row — used by
 *  the Deploy tab's per-row Remove. The third positional argument was
 *  historically a boolean `cleanup`; now an options object is preferred
 *  (the boolean form is still accepted for back-compat). */
export async function removeStackDeployment(
  rawStackId: string,
  rawProjectPath: string,
  rawAgentId: string,
  cleanupOrOpts: boolean | RemoveStackDeploymentOptions,
): Promise<RemoveStackDeploymentResult> {
  const stackId = validateStackName(rawStackId);
  const projectPath = validateProjectPath(rawProjectPath);
  if (!AGENTS[rawAgentId]) throw new Error(`Unknown agent: ${rawAgentId}`);
  const opts: RemoveStackDeploymentOptions =
    typeof cleanupOrOpts === "boolean"
      ? { cleanup: cleanupOrOpts }
      : cleanupOrOpts;
  const cleanup = opts.cleanup !== false;
  const cascadeMembers = opts.cascadeMembers === true;

  if (cleanup) {
    try {
      await removeMetaSkillFromProject(stackId, projectPath, rawAgentId);
    } catch {
      // Best-effort cleanup — same rationale as deleteStack.
    }
  }

  // Capture the snapshot BEFORE we strip this stack's row from config so
  // we know which members the row claimed.
  const cascadeRemoved: RemoveStackDeploymentResult["cascadeRemoved"] = [];
  const cascadeSkipped: RemoveStackDeploymentResult["cascadeSkipped"] = [];
  if (cascadeMembers) {
    const snapshot = await loadConfig();
    const row = snapshot.stackDeployments.find(
      (d) =>
        d.stackId === stackId &&
        d.projectPath === projectPath &&
        d.agentId === rawAgentId,
    );
    if (row) {
      for (const skillId of row.includedSkillIds) {
        const ownedByOther = snapshot.stackDeployments.some(
          (d) =>
            !(d.stackId === stackId && d.agentId === rawAgentId) &&
            d.projectPath === projectPath &&
            d.includedSkillIds.includes(skillId),
        );
        if (ownedByOther) {
          cascadeSkipped.push({
            skillId,
            projectPath,
            agentId: rawAgentId,
            reason: "Still part of another deployed stack at this project",
          });
          continue;
        }
        const agent = AGENTS[rawAgentId];
        if (!agent) continue;
        const resolved = resolveAgentPaths(rawAgentId, skillId, projectPath);
        const isSingleFile = /{name}/.test(agent.entryFile);
        const target = isSingleFile
          ? join(resolved.projectPath ?? "", resolved.entryFile)
          : (resolved.projectPath ?? "");
        if (!target) continue;
        try {
          await fs.rm(target, { recursive: true, force: true });
          cascadeRemoved.push({ skillId, projectPath, agentId: rawAgentId });
        } catch {
          // Best-effort.
        }
      }
    }
  }

  await withConfigLock(async () => {
    const fresh = await loadConfig();
    fresh.stackDeployments = fresh.stackDeployments.filter(
      (d) =>
        !(
          d.stackId === stackId &&
          d.projectPath === projectPath &&
          d.agentId === rawAgentId
        ),
    );
    if (cascadeMembers) {
      for (const entry of cascadeRemoved) {
        const rec = fresh.skills[entry.skillId];
        if (!rec) continue;
        if (rec.deployments) {
          rec.deployments = rec.deployments.filter(
            (d) =>
              !(d.projectPath === entry.projectPath &&
                d.agentId === entry.agentId),
          );
        }
        const stillDeployed = (rec.deployments ?? []).some(
          (d) => d.projectPath === entry.projectPath,
        );
        if (!stillDeployed) {
          rec.projects = rec.projects.filter((p) => p !== entry.projectPath);
        }
      }
    }
    await saveConfig(fresh);
  });

  return { cascadeRemoved, cascadeSkipped };
}

export async function deployStack(
  rawStackId: string,
  rawProjectPath: string,
  rawAgentId: string,
  rawDeployMode: DeployMode,
): Promise<DeployStackResult> {
  const stackId = validateStackName(rawStackId);
  const projectPath = validateProjectPath(rawProjectPath);
  if (!AGENTS[rawAgentId]) throw new Error(`Unknown agent: ${rawAgentId}`);
  const agentId = rawAgentId;
  if (rawDeployMode !== "copy" && rawDeployMode !== "symlink") {
    throw new Error(`Invalid deploy mode: ${rawDeployMode}`);
  }
  const requestedMode: DeployMode = rawDeployMode;

  const config = await loadConfig();
  const stack = config.stacks.find((s) => s.id === stackId);
  if (!stack) throw new Error(`Stack '${stackId}' not found`);

  const deployed: string[] = [];
  const failed: { skillId: string; error: string }[] = [];
  let actualMode: DeployMode = requestedMode;
  let warning: string | null = null;

  for (const memberId of stack.skillIds) {
    try {
      const r = await deployToProject(memberId, projectPath, {
        agentId,
        deployMode: requestedMode,
      });
      deployed.push(memberId);
      actualMode = r.deployMode;
      if (r.warning && warning === null) warning = r.warning;
    } catch (err) {
      failed.push({
        skillId: memberId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Refresh the library copy so it reflects current member descriptions,
  // then deploy through the standard skill path. This makes symlink mode
  // work for stacks (the project symlink resolves back to the library file)
  // and unifies the deploy code path with regular skills.
  const members = await loadStackMembers(stack.skillIds);
  const metaContent = generateMetaSkill(stack, members);
  await writeMetaSkillToLibrary(stackId, metaContent);
  const metaResult = await deployToProject(stackId, projectPath, {
    agentId,
    deployMode: requestedMode,
  });
  // deployToProject returns the directory for directory-style agents and
  // the entry file for single-file agents. metaSkillPath is documented as
  // the path to the SKILL.md (or .mdc) file — normalize accordingly.
  const isSingleFile = /{name}/.test(AGENTS[agentId].entryFile);
  const metaSkillPath = isSingleFile
    ? metaResult.destPath
    : join(metaResult.destPath, "SKILL.md");
  // The meta-skill's mode wins over the member modes for the recorded
  // StackDeployment row — it's the canonical entry point and any agent
  // capability fallback (e.g. cursor → copy) is reflected here.
  actualMode = metaResult.deployMode;
  if (metaResult.warning && warning === null) warning = metaResult.warning;

  await withConfigLock(async () => {
    const fresh = await loadConfig();
    const idx = fresh.stackDeployments.findIndex(
      (d) =>
        d.stackId === stackId &&
        d.projectPath === projectPath &&
        d.agentId === agentId,
    );
    const entry: StackDeployment = {
      stackId,
      projectPath,
      agentId,
      deployMode: actualMode,
      timestamp: nowIso(),
      includedSkillIds: [...stack.skillIds],
    };
    if (idx >= 0) fresh.stackDeployments[idx] = entry;
    else fresh.stackDeployments.push(entry);

    // Mirror to each successfully-deployed member's SkillRecord so cascades
    // pick up the project. Failed members are skipped — they aren't actually
    // on disk and shouldn't be cascade targets.
    for (const memberId of deployed) {
      const record = fresh.skills[memberId];
      if (!record) continue;
      if (!record.projects.includes(projectPath)) {
        record.projects.push(projectPath);
      }
      const deps = record.deployments ?? [];
      const i = deps.findIndex(
        (d) => d.projectPath === projectPath && d.agentId === agentId,
      );
      const dep: Deployment = {
        projectPath,
        agentId,
        deployMode: actualMode,
        deployedAt: nowIso(),
      };
      if (i >= 0) deps[i] = dep;
      else deps.push(dep);
      record.deployments = deps;
    }

    fresh.last_project = projectPath;
    await saveConfig(fresh);
  });

  return {
    stackId,
    projectPath,
    agentId,
    deployMode: actualMode,
    deployed,
    failed,
    metaSkillPath,
    warning,
  };
}

/** Resolve member descriptions from `listSkills()` so the generated body
 *  reflects what the user actually sees in the Library. Skills not present
 *  in the library fall back to {@link META_NO_DESCRIPTION} via
 *  {@link generateMetaSkill}. */
export async function loadStackMembers(skillIds: string[]): Promise<StackMember[]> {
  const skills = await listSkills();
  const byName = new Map(skills.map((s) => [s.name, s] as const));
  return skillIds.map((id) => {
    const s = byName.get(id);
    return { name: id, description: s?.description ?? "" };
  });
}
