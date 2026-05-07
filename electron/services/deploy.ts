import { promises as fs } from "node:fs";
import { join } from "node:path";
import { LIBRARY_PATH } from "./paths";

/**
 * Copy a library skill into a project's .claude/skills/<name>/ directory.
 * Returns true on success; throws on filesystem error.
 *
 * If a skill of the same name already exists at the destination, it is
 * replaced (caller should confirm beforehand).
 */
export async function copyToProject(
  skillName: string,
  projectPath: string,
): Promise<void> {
  const src = join(LIBRARY_PATH, skillName);
  try {
    const stat = await fs.stat(src);
    if (!stat.isDirectory()) {
      throw new Error(`Skill '${skillName}' not in library`);
    }
  } catch {
    throw new Error(`Skill '${skillName}' not in library`);
  }

  const skillsDir = join(projectPath, ".claude", "skills");
  const dest = join(skillsDir, skillName);
  await fs.mkdir(skillsDir, { recursive: true });
  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(src, dest, { recursive: true });
}

/**
 * Cascade an updated library skill into every tracked project. Returns lists
 * of projects that succeeded and projects that failed (skipped without
 * aborting the cascade).
 */
export async function cascadeToProjects(
  skillName: string,
  projectPaths: string[],
): Promise<{ updated: string[]; failed: string[] }> {
  const updated: string[] = [];
  const failed: string[] = [];
  for (const project of projectPaths) {
    try {
      const stat = await fs.stat(project);
      if (!stat.isDirectory()) {
        failed.push(project);
        continue;
      }
      await copyToProject(skillName, project);
      updated.push(project);
    } catch {
      failed.push(project);
    }
  }
  return { updated, failed };
}
