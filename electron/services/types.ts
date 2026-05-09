// Shared types between main and renderer. Schema for SkillRecord is identical
// to the Python app's (`~/.claude/skill-manager.json`) — installs from the old
// app load without migration.

export interface HistorySnapshot {
  commit: string; // SHA, or `pre-<iso>` for snapshots without a captured commit
  archived_at: string; // ISO timestamp the snapshot was taken
}

export type DeployMode = "copy" | "symlink";

export interface Deployment {
  projectPath: string;
  /** Agent id from electron/services/agents.ts. Defaults to "claude" for
   *  records migrated from the legacy `projects: string[]` shape. */
  agentId: string;
  deployMode: DeployMode;
  deployedAt: string;
}

export interface SkillRecord {
  url: string | null;
  commit: string | null;
  installed_at: string;
  updated_at: string | null;
  /** Legacy projection: list of project paths this skill is deployed to.
   *  Kept populated for backward read-compat; the source of truth for new
   *  code is `deployments[]`. */
  projects: string[];
  /** Per-deployment metadata (agent + mode + timestamp). Optional only on
   *  the wire — loadConfig synthesizes entries from `projects` when this is
   *  missing so the rest of the app can rely on it. */
  deployments?: Deployment[];
  history?: HistorySnapshot[];
}

// Maximum snapshots we'll keep per skill — picked so a 30-skill library with
// modest bundles stays under ~500 MB at the highest retention setting.
export const MAX_HISTORY_RETENTION = 10;

export const HISTORY_RETENTION_OPTIONS = [0, 1, 2, 5, 10] as const;

export type HistoryRetention = (typeof HISTORY_RETENTION_OPTIONS)[number];

export type Theme = "light" | "dark" | "system";

export interface AppSettings {
  auto_check_updates: boolean;
  cascade_updates: boolean;
  confirm_before_remove: boolean;
  show_resource_only: boolean;
  default_layout: "cards" | "palette";
  // 0 = disabled (atomic swap, no rollback). Default 2 covers the common
  // "undo my last bad update" case without doubling disk cost.
  update_history_retention: HistoryRetention;
  theme: Theme;
  /** Default mode for the Deploy modal. "copy" replicates files into the
   *  target project; "symlink" points the target at the library copy so
   *  edits/updates are picked up without a re-cascade. */
  default_deploy_mode: DeployMode;
}

export const DEFAULT_SETTINGS: AppSettings = {
  auto_check_updates: false,
  cascade_updates: true,
  confirm_before_remove: true,
  show_resource_only: false,
  default_layout: "cards",
  update_history_retention: 2,
  // Default to dark — users open this app late at night and white mode
  // is harsh. They can flip to light or system in Settings.
  theme: "dark",
  default_deploy_mode: "copy",
};

/** Where the library + history live. `claude` keeps the legacy
 *  ~/.claude/skills layout; `centralized` puts everything under
 *  ~/.skill-stack/skills (agent-neutral); `custom` lets the user pick any
 *  absolute path via the folder picker. */
export type LibraryRoot = "claude" | "centralized" | "custom";

/** First-run + library-relocation state. Loaded once at boot and used to
 *  call `configurePaths` so the rest of the backend resolves to the right
 *  on-disk location. `completed: false` means the SetupFlow blocks the
 *  rest of the UI until the user makes their choices. */
export interface SetupConfig {
  completed: boolean;
  /** Schema version — bumped if the shape evolves post-launch. */
  version: 1;
  libraryRoot: LibraryRoot;
  /** Resolved absolute path to the library directory. Empty string while
   *  `completed === false`. */
  libraryPath: string;
  /** Resolved absolute path to the history directory (sibling of
   *  libraryPath's parent in the standard layout). */
  historyPath: string;
  /** Agent id of the user's primary agent. Drives the Deploy view's
   *  default agent selection and the visual ordering. Limited to agents
   *  with a globalSkillPath (claude, codex, gemini, continue) — cursor
   *  and cline have no global skills dir so they can't be primary. */
  primaryAgent: string;
  /** ISO timestamp of completion. */
  completedAt: string;
}

export const DEFAULT_SETUP: SetupConfig = {
  completed: false,
  version: 1,
  libraryRoot: "claude",
  libraryPath: "",
  historyPath: "",
  primaryAgent: "claude",
  completedAt: "",
};

export interface SkillManagerConfig {
  last_project: string;
  skills: Record<string, SkillRecord>;
  settings: AppSettings;
  /** User-defined skill stacks (named, ordered groups of skills). */
  stacks: SkillStack[];
  /** Per-(stack, project, agent) deployment ledger — analogous to
   *  SkillRecord.deployments but for stacks. */
  stackDeployments: StackDeployment[];
  /** First-run setup state. Defaults to DEFAULT_SETUP for configs that
   *  predate this field, which causes the SetupFlow to mount on next
   *  launch. */
  setup: SetupConfig;
}

/** A named, reusable bundle of skills. Identified by `id` (kebab-case per the
 *  agentskills.io naming spec). When deployed, members are pushed individually
 *  AND a generated meta-skill SKILL.md is written so an agent can activate the
 *  whole bundle by name. */
export interface SkillStack {
  id: string;
  name: string;
  description: string;
  /** Ordered list of skill names from the library. Order is preserved in the
   *  generated meta-skill body so the user can express priority. */
  skillIds: string[];
  createdAt: string;
  updatedAt: string;
  /** True when this stack has been promoted into the user's home library
   *  (visible in Library view + symlinked/copied into the primary agent's
   *  global skills dir so it's invokable from any project). The
   *  meta-skill is always WRITTEN to the library at <library>/<id>/SKILL.md
   *  on stack create/update; this flag controls whether it's also
   *  surfaced as a library entry and wired into agent dirs. */
  inHomeLibrary?: boolean;
  /** When inHomeLibrary === true, the agent dir(s) we wired the stack
   *  into (so removeStackFromHomeLibrary knows what to clean up). */
  homeLibraryAgents?: string[];
}

export interface StackDeployment {
  stackId: string;
  projectPath: string;
  agentId: string;
  deployMode: DeployMode;
  /** ISO timestamp of the deploy. */
  timestamp: string;
  /** Snapshot of stack.skillIds at deploy time — lets the UI flag drift when
   *  the stack composition has changed since this deployment. */
  includedSkillIds: string[];
}

/** Payload for the Deploy tab's queue. The Library and Stacks views push one
 *  of these into the store, which switches the active tab to Deploy. */
export type DeployRequest =
  | { type: "skill"; id: string }
  | { type: "stack"; id: string };

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
}

export interface NestedSkill {
  name: string;
  path: string;
}

export interface TreeNode {
  name: string;
  /** path relative to the skill root */
  relativePath: string;
  isDir: boolean;
  size?: number;
  children?: TreeNode[];
}

export interface SkillDetection {
  identifiers: string[]; // e.g. ["SKILL.md"]
  content: string[]; // e.g. ["references/", "scripts/"]
  nested: NestedSkill[];
  isSkill: boolean;
  isBundle: boolean;
}

// Renderer-facing shape — combines disk + config + detection.
export interface Skill {
  name: string;
  displayName: string;
  description: string;
  url: string | null;
  commit: string | null;
  installedAt: string;
  updatedAt: string | null;
  projects: string[];
  isSkill: boolean;
  isBundle: boolean;
  bundleSize: number;
  identifiers: string[];
  contentDirs: string[];
  isLocal: boolean; // no source URL
  historyCount: number;
  nestedSkills: { name: string; relativePath: string }[];
}

export interface UpdateInfo {
  current: string | null;
  remote: string;
  hasUpdate: boolean;
}

export interface TrackedProject {
  path: string;
  skillCount: number;
  skillNames: string[];
  lastDeployedAt: string | null;
  exists: boolean;
  /** Unique agent ids that have at least one deployment in this project. */
  agentIds: string[];
  /** Unique deploy modes used in this project (for the copy/symlink hint). */
  deployModes: DeployMode[];
}

export interface InstallResult {
  name: string;
  commit: string | null;
  isBundle: boolean;
  bundleSize: number;
}

export interface UpdateResult {
  name: string;
  commit: string | null;
  cascadedTo: string[];
  failedProjects: string[];
}

export interface ExportPayload {
  markdown: string;
  count: number;
}

export interface ImportEntry {
  name: string;
  url: string;
}

export interface ImportSummary {
  installed: ImportEntry[];
  failed: { entry: ImportEntry; error: string }[];
}

export interface HistoryEntry {
  commit: string;
  archived_at: string;
  sizeBytes: number;
  exists: boolean; // false if snapshot dir was deleted out from under us
}

export interface RollbackResult {
  name: string;
  commit: string;
  cascadedTo: string[];
  failedProjects: string[];
}
