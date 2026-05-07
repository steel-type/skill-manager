import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  DeployMode,
  ExportPayload,
  HistoryEntry,
  ImportSummary,
  InstallResult,
  RollbackResult,
  Skill,
  SkillStack,
  StackDeployment,
  TrackedProject,
  TreeNode,
  UpdateInfo,
  UpdateResult,
} from "./services/types";

export interface EnvInfo {
  platform: NodeJS.Platform;
  electron: string;
  node: string;
  paths: {
    config: string;
    library: string;
    claudeDir: string;
  };
}

/**
 * Wire up a log subscription for the lifetime of an IPC call. Cancellation
 * lives in the renderer, NOT here — `AbortSignal` doesn't survive a
 * contextBridge crossing (its prototype methods get stripped during
 * structured clone). Instead, callers receive a `streamId` and pair it
 * with `window.api.cancelOperation(streamId)` themselves.
 */
function withLogChannel<T>(
  streamId: string,
  onLog: ((line: string) => void) | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (!onLog) return run();
  const channel = `op-log:${streamId}`;
  const handler = (_e: unknown, line: string) => onLog(line);
  ipcRenderer.on(channel, handler);
  return run().finally(() => ipcRenderer.off(channel, handler));
}

const api = {
  envInfo: () => ipcRenderer.invoke("env-info") as Promise<EnvInfo>,

  listAgents: () =>
    ipcRenderer.invoke("list-agents") as Promise<
      {
        id: string;
        displayName: string;
        supportsSymlinks: boolean;
        formatNotes: string | null;
      }[]
    >,

  listSkills: () => ipcRenderer.invoke("list-skills") as Promise<Skill[]>,

  /**
   * Generate a streamId that can be used both as a log-channel key and a
   * cancellation handle. Cancellable operations require one; non-cancellable
   * ones can pass the empty string.
   */
  makeStreamId: () =>
    ipcRenderer.invoke("make-stream-id") as Promise<string>,

  cancelOperation: (streamId: string) =>
    ipcRenderer.invoke("cancel-operation", streamId) as Promise<boolean>,

  installFromUrl: (
    url: string,
    streamId: string,
    onLog?: (line: string) => void,
  ): Promise<InstallResult> =>
    withLogChannel(streamId, onLog, () =>
      ipcRenderer.invoke("install-from-url", { url, streamId }),
    ),

  installLocalSkill: (name: string, sourcePath: string): Promise<InstallResult> =>
    ipcRenderer.invoke("install-local-skill", { name, sourcePath }),

  checkUpdates: () =>
    ipcRenderer.invoke("check-updates") as Promise<Record<string, UpdateInfo>>,

  updateSkill: (
    name: string,
    streamId: string,
    onLog?: (line: string) => void,
  ): Promise<UpdateResult> =>
    withLogChannel(streamId, onLog, () =>
      ipcRenderer.invoke("update-skill", { name, streamId }),
    ),

  deploySkill: (
    name: string,
    projectPath: string,
    opts?: { agentId?: string; deployMode?: "copy" | "symlink" },
  ): Promise<{
    agentId: string;
    deployMode: "copy" | "symlink";
    warning: string | null;
    destPath: string;
  }> =>
    ipcRenderer.invoke("deploy-skill", {
      name,
      projectPath,
      agentId: opts?.agentId,
      deployMode: opts?.deployMode,
    }),

  removeSkill: (
    name: string,
    cascade: boolean,
  ): Promise<{ removedFromProjects: string[] }> =>
    ipcRenderer.invoke("remove-skill", { name, cascade }),

  listProjects: () =>
    ipcRenderer.invoke("list-projects") as Promise<TrackedProject[]>,

  removeProjectTracking: (
    projectPath: string,
    cleanFiles: boolean,
  ): Promise<{ skillsCleaned: string[] }> =>
    ipcRenderer.invoke("remove-project-tracking", { projectPath, cleanFiles }),

  exportMarkdown: () =>
    ipcRenderer.invoke("export-markdown") as Promise<ExportPayload>,

  exportJson: () =>
    ipcRenderer.invoke("export-json") as Promise<{
      json: string;
      count: number;
    }>,

  parseImportJson: (text: string) =>
    ipcRenderer.invoke("parse-import-json", text) as Promise<{
      entries: {
        name: string;
        url: string;
        commit?: string | null;
        description?: string;
        alreadyInstalled: boolean;
      }[];
      /** Codex-style local-path entries — installed via installLocalSkill,
       *  not the URL clone path, so the review screen never sees them. */
      localEntries: {
        name: string;
        localPath: string;
        enabled?: boolean;
        alreadyInstalled: boolean;
      }[];
      doc: { version: 1; exported_at: string } | null;
      /** Which input shape the parser recognised. */
      detectedFormat:
        | "native"
        | "bare-array"
        | "codex-config"
        | "skills-array"
        | "url-map"
        | "url-lines"
        | "unknown";
      /** Malformed JSON entries that were dropped. */
      skipped: number;
    }>,

  validateSkillUrl: (url: string) =>
    ipcRenderer.invoke("validate-skill-url", url) as Promise<{
      url: string;
      ok: boolean;
      remoteCommit: string | null;
      error?: string;
    }>,

  saveTextFile: (args: {
    defaultName: string;
    content: string;
    filterName?: string;
    extensions?: string[];
  }) =>
    ipcRenderer.invoke("save-text-file", args) as Promise<string | null>,

  readTextFile: (args?: { filterName?: string; extensions?: string[] }) =>
    ipcRenderer.invoke("read-text-file", args ?? {}) as Promise<
      { path: string; content: string } | null
    >,

  importMarkdown: (
    text: string,
    streamId: string,
    onLog?: (line: string) => void,
  ): Promise<ImportSummary> =>
    withLogChannel(streamId, onLog, () =>
      ipcRenderer.invoke("import-markdown", { text, streamId }),
    ),

  getLastProject: () =>
    ipcRenderer.invoke("get-last-project") as Promise<string>,

  setLastProject: (p: string) =>
    ipcRenderer.invoke("set-last-project", p) as Promise<void>,

  openInFinder: (p: string) =>
    ipcRenderer.invoke("open-in-finder", p) as Promise<void>,

  openPath: (p: string) =>
    ipcRenderer.invoke("open-path", p) as Promise<string>,

  pickFolder: () =>
    ipcRenderer.invoke("pick-folder") as Promise<string | null>,

  writeClipboard: (text: string) =>
    ipcRenderer.invoke("write-clipboard", text) as Promise<void>,

  getSettings: () =>
    ipcRenderer.invoke("get-settings") as Promise<AppSettings>,

  setSettings: (partial: Partial<AppSettings>) =>
    ipcRenderer.invoke("set-settings", partial) as Promise<AppSettings>,

  resetConfig: () => ipcRenderer.invoke("reset-config") as Promise<void>,

  listSkillHistory: (name: string) =>
    ipcRenderer.invoke("list-skill-history", name) as Promise<HistoryEntry[]>,

  rollbackSkill: (
    name: string,
    commit: string,
    cascade: boolean,
    streamId: string,
    onLog?: (line: string) => void,
  ): Promise<RollbackResult> =>
    withLogChannel(streamId, onLog, () =>
      ipcRenderer.invoke("rollback-skill", { name, commit, cascade, streamId }),
    ),

  openExternal: (url: string) =>
    ipcRenderer.invoke("open-external", url) as Promise<void>,

  getHistorySize: () =>
    ipcRenderer.invoke("get-history-size") as Promise<number>,

  clearAllHistory: () =>
    ipcRenderer.invoke("clear-all-history") as Promise<{
      snapshotsCleared: number;
      freedBytes: number;
    }>,

  getSkillTree: (name: string) =>
    ipcRenderer.invoke("get-skill-tree", name) as Promise<TreeNode | null>,

  // ── Stacks ────────────────────────────────────────────────────────────────

  listStacks: () =>
    ipcRenderer.invoke("list-stacks") as Promise<SkillStack[]>,

  createStack: (name: string, description: string, skillIds: string[]) =>
    ipcRenderer.invoke("create-stack", {
      name,
      description,
      skillIds,
    }) as Promise<SkillStack>,

  updateStackComposition: (stackId: string, skillIds: string[]) =>
    ipcRenderer.invoke("update-stack-composition", {
      stackId,
      skillIds,
    }) as Promise<{
      stack: SkillStack;
      added: string[];
      removed: string[];
      pushed: {
        projectPath: string;
        agentId: string;
        addedDeployed: string[];
        addFailed: { skillId: string; error: string }[];
        metaSkillPath: string;
      }[];
    }>,

  deleteStack: (stackId: string, cleanup: boolean) =>
    ipcRenderer.invoke("delete-stack", { stackId, cleanup }) as Promise<void>,

  deployStack: (
    stackId: string,
    projectPath: string,
    agentId: string,
    deployMode: DeployMode,
  ) =>
    ipcRenderer.invoke("deploy-stack", {
      stackId,
      projectPath,
      agentId,
      deployMode,
    }) as Promise<{
      stackId: string;
      projectPath: string;
      agentId: string;
      deployMode: DeployMode;
      deployed: string[];
      failed: { skillId: string; error: string }[];
      metaSkillPath: string;
      warning: string | null;
    }>,

  getStackDeployments: (stackId?: string) =>
    ipcRenderer.invoke("get-stack-deployments", { stackId }) as Promise<
      StackDeployment[]
    >,

  removeStackDeployment: (
    stackId: string,
    projectPath: string,
    agentId: string,
    cleanup: boolean,
  ) =>
    ipcRenderer.invoke("remove-stack-deployment", {
      stackId,
      projectPath,
      agentId,
      cleanup,
    }) as Promise<void>,
};

contextBridge.exposeInMainWorld("api", api);

export type SkillManagerApi = typeof api;
