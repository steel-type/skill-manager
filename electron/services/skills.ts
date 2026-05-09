import { promises as fs } from "node:fs";
import { join, basename, relative } from "node:path";
import { getLibraryPath } from "./paths";
import { loadConfig } from "./config";
import type {
  NestedSkill,
  Skill,
  SkillDetection,
  SkillFrontmatter,
} from "./types";

const SKILL_IDENTIFIERS = ["SKILL.md", "AGENTS.md"] as const;
const SKILL_CONTENT = ["references", "scripts", "data", "commands"] as const;
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "dist",
  "build",
]);
const NESTED_SKIP_PARTS = new Set([
  "resources",
  "docs",
  "i18n",
  "test",
  "tests",
]);
const FRONTMATTER_FIELDS = new Set<keyof SkillFrontmatter>([
  "name",
  "description",
  "license",
  "compatibility",
]);

// Frontmatter is at the top of the file. Reading more than a few KB of YAML
// is suspicious; cap the read so a 5 GB file pretending to be SKILL.md can't
// OOM the renderer.
const MAX_FRONTMATTER_FILE_BYTES = 4 * 1024 * 1024; // 4 MB

/**
 * Parse YAML frontmatter from a SKILL.md or AGENTS.md file. Returns the
 * recognised fields (name, description, license, compatibility). Mirrors the
 * Python app's mini-parser behaviour — handles flat key:value, multiline >- /
 * |, and indented continuation lines.
 */
export async function parseSkillFrontmatter(
  filePath: string,
): Promise<SkillFrontmatter> {
  let text: string;
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FRONTMATTER_FILE_BYTES) {
      // Read just the first chunk — frontmatter lives at the top, so we
      // don't need the whole file. If the chunk doesn't contain a complete
      // frontmatter block, parseSkillFrontmatter returns {} naturally.
      const handle = await fs.open(filePath, "r");
      try {
        const buf = Buffer.alloc(64 * 1024);
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
        text = buf.subarray(0, bytesRead).toString("utf8");
      } finally {
        await handle.close();
      }
    } else {
      text = await fs.readFile(filePath, "utf8");
    }
  } catch {
    return {};
  }

  if (!text.startsWith("---")) return {};
  const end = text.indexOf("---", 3);
  if (end === -1) return {};
  const yamlText = text.slice(3, end).trim();

  const result: SkillFrontmatter = {};
  let currentKey: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentKey && FRONTMATTER_FIELDS.has(currentKey as keyof SkillFrontmatter)) {
      (result as Record<string, string>)[currentKey] = currentLines
        .join(" ")
        .trim();
    }
  };

  for (const line of yamlText.split("\n")) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) continue;

    // Indented continuation line (part of a multiline value)
    if (currentKey && (line[0] === " " || line[0] === "\t")) {
      currentLines.push(stripped);
      continue;
    }

    // New top-level key: value
    if (stripped.includes(":") && !stripped.startsWith("-")) {
      flush();
      const colonIdx = stripped.indexOf(":");
      const key = stripped.slice(0, colonIdx).trim();
      let value = stripped.slice(colonIdx + 1).trim();
      // Strip matching quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      currentKey = key;
      // YAML multiline indicators — value continues on indented lines
      if (["", ">-", ">", "|", "|-"].includes(value)) {
        currentLines = [];
      } else {
        currentLines = [value];
      }
    }
  }
  flush();
  return result;
}

export async function getSkillInfo(skillDir: string): Promise<SkillFrontmatter> {
  for (const filename of SKILL_IDENTIFIERS) {
    const info = await parseSkillFrontmatter(join(skillDir, filename));
    if (Object.keys(info).length > 0) return info;
  }
  return {};
}

async function isFile(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function findNestedSkills(root: string): Promise<NestedSkill[]> {
  const found: NestedSkill[] = [];
  const seen = new Set<string>();

  async function walk(dir: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const sub = join(dir, entry.name);
        const rel = relative(root, sub);
        const parts = rel.split("/").filter(Boolean);
        if (parts.some((p) => NESTED_SKIP_PARTS.has(p))) continue;
        await walk(sub);
      } else if (
        entry.isFile() &&
        (SKILL_IDENTIFIERS as readonly string[]).includes(entry.name)
      ) {
        if (dir === root) continue; // root is the parent, not nested
        const name = basename(dir);
        if (!seen.has(name)) {
          seen.add(name);
          found.push({ name, path: dir });
        }
      }
    }
  }

  await walk(root);
  return found;
}

/**
 * Analyse a directory and return its skill metadata.
 */
export async function detectSkillType(dirPath: string): Promise<SkillDetection> {
  const identifiers: string[] = [];
  for (const f of SKILL_IDENTIFIERS) {
    if (await isFile(join(dirPath, f))) identifiers.push(f);
  }

  const content: string[] = [];
  for (const d of SKILL_CONTENT) {
    if (await isDir(join(dirPath, d))) content.push(`${d}/`);
  }

  const nested = await findNestedSkills(dirPath);

  return {
    identifiers,
    content,
    nested,
    isSkill: identifiers.length > 0,
    isBundle: nested.length > 0 && identifiers.length === 0,
  };
}

export function describeSkill(detection: SkillDetection): string {
  if (detection.isBundle) {
    const n = detection.nested.length;
    return `${n} skill${n === 1 ? "" : "s"}`;
  }
  if (detection.identifiers.length || detection.content.length) {
    return [...detection.identifiers, ...detection.content].join(", ");
  }
  return "";
}

const TREE_SKIP = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  ".DS_Store",
]);
const TREE_MAX_DEPTH = 5;
const TREE_MAX_NODES = 500;

/**
 * Walk the skill directory and return a tree node. Best-effort, depth- and
 * breadth-capped so a runaway repo doesn't lock the renderer or main.
 */
export async function getSkillTree(skillName: string): Promise<import("./types").TreeNode | null> {
  const root = join(getLibraryPath(), skillName);
  let nodeCount = 0;

  async function walk(
    dirPath: string,
    relativePath: string,
    depth: number,
  ): Promise<import("./types").TreeNode> {
    const baseName = relativePath === "" ? skillName : relativePath.split("/").pop()!;
    const node: import("./types").TreeNode = {
      name: baseName,
      relativePath,
      isDir: true,
      children: [],
    };
    if (depth >= TREE_MAX_DEPTH || nodeCount >= TREE_MAX_NODES) {
      return node;
    }
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return node;
    }
    // Sort: directories first, then files, both alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (TREE_SKIP.has(entry.name)) continue;
      if (nodeCount >= TREE_MAX_NODES) break;
      nodeCount += 1;
      const childRel = relativePath === "" ? entry.name : `${relativePath}/${entry.name}`;
      const childAbs = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        node.children!.push(await walk(childAbs, childRel, depth + 1));
      } else if (entry.isFile()) {
        let size = 0;
        try {
          const stat = await fs.stat(childAbs);
          size = stat.size;
        } catch {
          // skip
        }
        node.children!.push({
          name: entry.name,
          relativePath: childRel,
          isDir: false,
          size,
        });
      }
    }
    return node;
  }

  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }
  return await walk(root, "", 0);
}

export function extractSkillName(url: string): string {
  let trimmed = url.replace(/\/+$/, "");
  if (trimmed.endsWith(".git")) trimmed = trimmed.slice(0, -4);
  const parts = trimmed.split("/");
  return parts[parts.length - 1] ?? trimmed;
}

/**
 * List every skill in the library, joining disk metadata with config records.
 */
export async function listSkills(): Promise<Skill[]> {
  const config = await loadConfig();
  const skills: Skill[] = [];
  // Stack meta-skills live alongside regular skills in LIBRARY_PATH so
  // they can be deployed via the standard skill code path. By default we
  // hide them from the Library view — they belong on the Stacks tab. But
  // stacks the user has explicitly deployed to their home library
  // (inHomeLibrary === true) DO surface here, so they're visible
  // alongside regular skills as the user expects after promoting them.
  const hiddenStackIds = new Set(
    config.stacks
      .filter((s) => s.inHomeLibrary !== true)
      .map((s) => s.id),
  );

  const libraryPath = getLibraryPath();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(libraryPath, { withFileTypes: true });
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

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (hiddenStackIds.has(entry.name)) continue;
    const dir = join(libraryPath, entry.name);
    const detection = await detectSkillType(dir);
    const frontmatter = await getSkillInfo(dir);
    const record = config.skills[entry.name];
    const description =
      frontmatter.description?.trim() || describeSkill(detection);
    skills.push({
      name: entry.name,
      displayName: frontmatter.name?.trim() || entry.name,
      description,
      url: record?.url ?? null,
      commit: record?.commit ?? null,
      installedAt: record?.installed_at ?? "",
      updatedAt: record?.updated_at ?? null,
      projects: record?.projects ?? [],
      isSkill: detection.isSkill,
      isBundle: detection.isBundle,
      bundleSize: detection.nested.length,
      identifiers: detection.identifiers,
      contentDirs: detection.content,
      isLocal: !record?.url,
      historyCount: record?.history?.length ?? 0,
      nestedSkills: detection.nested.map((n) => ({
        name: n.name,
        relativePath: n.path.replace(`${dir}/`, ""),
      })),
    });
  }

  return skills.sort((a, b) =>
    a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()),
  );
}
