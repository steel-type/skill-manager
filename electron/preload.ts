import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  ExportPayload,
  HistoryEntry,
  ImportSummary,
  InstallResult,
  RollbackResult,
  Skill,
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

  deploySkill: (name: string, projectPath: string): Promise<void> =>
    ipcRenderer.invoke("deploy-skill", { name, projectPath }),

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
};

contextBridge.exposeInMainWorld("api", api);

export type SkillManagerApi = typeof api;
