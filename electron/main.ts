import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  clipboard,
  session as defaultSession,
  type Session,
} from "electron";
import windowStateKeeper from "electron-window-state";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { CONFIG_PATH, getClaudeDir, getLibraryPath } from "./services/paths";
import { getAgentSkillsDir, getSupportedAgents } from "./services/agents";
import { killAllGitChildren } from "./services/git";
import {
  bootstrap,
  listSkills,
  installFromUrl,
  installLocalSkill,
  checkUpdates,
  updateSkill,
  deploySkill,
  removeSkill,
  listTrackedProjects,
  removeProjectTracking,
  exportMarkdown,
  exportJson,
  importMarkdown,
  parseImportJson,
  validateSkillUrl,
  getLastProject,
  setLastProject,
  getSettings,
  setSettings,
  resetConfig,
  listSkillHistory,
  rollbackSkill,
  getHistorySize,
  clearAllHistory,
  getSkillTree,
} from "./operations";
import {
  createStack,
  deleteStack,
  deployStack,
  deployStackToHomeLibrary,
  removeStackFromHomeLibrary,
  getStackDeployments,
  listStacks,
  previewCompositionCascade,
  removeStackDeployment,
  updateStackComposition,
} from "./services/stacks";
import {
  compareSkillDirs,
  completeSetup,
  resolveLibraryRoot,
  scanForExistingSkills,
  validateLibraryPath,
  wireLibraryIntoAgentDir,
  type CompleteSetupArgs,
} from "./services/setup";
import { loadConfig, saveConfig, withConfigLock } from "./services/config";
import { withSetupDefaults } from "./services/config";
import type {
  DeployMode,
  LibraryRoot,
  SetupConfig,
} from "./services/types";

// ESM doesn't expose __dirname; reconstruct it from import.meta.url so the
// preload-script and built-renderer paths resolve from dist-electron/main.js.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let mainWindow: BrowserWindow | null = null;
// Crash-loop guard: if the renderer keeps dying we stop reloading and let
// the user see the failure rather than spin forever.
let rendererCrashCount = 0;
const MAX_RENDERER_CRASHES = 3;

// Set after the user explicitly OKs a quit-while-busy prompt. Lets the
// re-issued close event sail through without prompting again.
let quitConfirmed = false;

/**
 * Inject a strict Content-Security-Policy on every response. Done as a
 * response header rather than a meta tag so it covers both the dev server
 * (loaded over http) and the bundled HTML (loaded over file://). The dev
 * variant additionally allows the Vite HMR websocket and source maps.
 */
function attachCsp(session: Session) {
  session.webRequest.onHeadersReceived((details, callback) => {
    const csp = [
      "default-src 'self'",
      // Inline styles are used heavily by React's per-element style props;
      // we accept the trade-off rather than refactor every prop. Inline
      // scripts stay forbidden via 'self' in script-src.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      // unsafe-eval is required by Vite's dev runtime; in prod we drop it.
      isDev
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : "script-src 'self'",
      "img-src 'self' data: blob:",
      isDev
        ? `connect-src 'self' ws://localhost:* http://localhost:* https://fonts.googleapis.com https://fonts.gstatic.com https://api.github.com`
        : "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://api.github.com",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; ");

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

function createWindow() {
  // Restore the user's last window size + position. The keeper writes to
  // <userData>/window-state.json on move/resize/close.
  const state = windowStateKeeper({
    defaultWidth: 980,
    defaultHeight: 700,
  });

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 760,
    minHeight: 520,
    // `hidden` (not `hiddenInset`) keeps the native traffic lights but
    // lets us reposition them. We move them into the wireframe titlebar
    // so the OS controls live exactly where the design's drawn ring
    // group sits — one set of lights, in the right place.
    titleBarStyle: "hidden",
    // Centered against the new 36 px wf-titlebar so they sit visually
    // aligned with the title text instead of crowding the top edge.
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: "#fdfcf8",
    icon: path.join(__dirname, "..", "assets", "icon.icns"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload only uses contextBridge + ipcRenderer (no Node APIs in
      // the renderer), so the renderer can run sandboxed. Tighter isolation
      // for free.
      sandbox: true,
    },
  });
  state.manage(mainWindow);

  // Block all renderer-initiated window.open / target=_blank navigations.
  // External links should be opened with shell.openExternal from the main
  // process via IPC; this keeps a stray window.open(...) from spawning a
  // second Electron window with our preload.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // Prevent in-place navigation away from the app's own origin (vite dev
  // server in dev, file:// in prod). Any external link attempt is routed to
  // the OS browser instead.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = isDev
      ? url.startsWith(process.env.VITE_DEV_SERVER_URL!)
      : url.startsWith("file://");
    if (!allowed) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // Auto-recover from renderer crashes (white-screen avoidance). After a
  // few crashes in a row, surface the failure instead of looping.
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[skill-manager] renderer gone:", details);
    rendererCrashCount += 1;
    if (rendererCrashCount > MAX_RENDERER_CRASHES) {
      dialog.showErrorBox(
        "Skill Manager",
        `The window kept crashing (${details.reason}). Quit and relaunch when you're ready.`,
      );
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload();
    }
  });

  mainWindow.once("ready-to-show", () => {
    rendererCrashCount = 0;
    mainWindow?.show();
  });

  // Hard-quit on red X / Cmd+W instead of the macOS-default
  // hide-window-but-keep-app-running behaviour. If operations are in
  // flight, prompt the user so they don't lose work to a stray click.
  mainWindow.on("close", async (event) => {
    if (quitConfirmed) return; // re-issued close after confirmation
    if (operationControllers.size === 0) return; // nothing running
    event.preventDefault();
    const count = operationControllers.size;
    const choice = await dialog.showMessageBox(mainWindow!, {
      type: "warning",
      buttons: ["Cancel", "Quit anyway"],
      defaultId: 0,
      cancelId: 0,
      message: `${count} operation${count === 1 ? "" : "s"} in progress`,
      detail:
        "Quitting now will cancel the running install/update/rollback. Your library and config stay safe — only the in-flight clone is interrupted.",
      noLink: true,
    });
    if (choice.response === 1) {
      quitConfirmed = true;
      // Re-issue the close; this time the early-returns above let it through.
      mainWindow?.close();
    }
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
    // Only open DevTools if you explicitly want them
    //mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(async () => {
  attachCsp(defaultSession.defaultSession);
  try {
    await bootstrap();
  } catch (err) {
    console.error("bootstrap failed:", err);
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Quit on macOS too — user wants the red X to terminate the app, not
  // just hide the window like a typical macOS lifecycle.
  app.quit();
});

// Kill any in-flight `git` children when the user quits — without this they
// linger as zombies until the parent exits naturally.
app.on("before-quit", () => {
  killAllGitChildren();
});

// ── Streaming-log channel helper ──
//
// IPC `invoke` returns a single Promise, so live progress (git clone output,
// cascade status) is broadcast on a side channel keyed by a random `streamId`
// generated by the renderer. The renderer subscribes to `op-log:<streamId>`
// for the lifetime of the call and unsubscribes after it resolves.

function makeLogger(streamId: string | undefined) {
  if (!streamId) return undefined;
  return (line: string) => {
    // Guard against post-quit / mid-reload sends that would otherwise crash
    // the main process when webContents is gone.
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.webContents.isDestroyed()
    ) {
      mainWindow.webContents.send(`op-log:${streamId}`, line);
    }
  };
}

// One AbortController per active long-running op, keyed by streamId. The
// renderer triggers cancellation by streamId; the IPC handlers register
// + clean up entries.
const operationControllers = new Map<string, AbortController>();

function registerCancellable(streamId: string | undefined): AbortSignal | undefined {
  if (!streamId) return undefined;
  const ctl = new AbortController();
  // Replace any pre-existing controller (caller should never reuse a
  // streamId, but if they do we abort the old one defensively).
  operationControllers.get(streamId)?.abort();
  operationControllers.set(streamId, ctl);
  return ctl.signal;
}

function clearCancellable(streamId: string | undefined): void {
  if (!streamId) return;
  operationControllers.delete(streamId);
}

// ── IPC handlers ──
//
// All input validation lives in operations.ts (services/validators.ts);
// these handlers just thread args through. Throws bubble back to the
// renderer's `await window.api.x()` and into the toast.

ipcMain.handle("env-info", () => ({
  platform: process.platform,
  electron: process.versions.electron,
  node: process.versions.node,
  home: homedir(),
  paths: {
    config: CONFIG_PATH,
    library: getLibraryPath(),
    claudeDir: getClaudeDir(),
  },
}));

// ── Setup / first-run handlers ──

ipcMain.handle("get-setup", async (): Promise<SetupConfig> => {
  const config = await loadConfig();
  return config.setup;
});

ipcMain.handle(
  "set-setup",
  async (
    _e,
    args: { partial: Partial<SetupConfig> },
  ): Promise<SetupConfig> => {
    return withConfigLock(async () => {
      const config = await loadConfig();
      config.setup = withSetupDefaults({ ...config.setup, ...args.partial });
      await saveConfig(config);
      return config.setup;
    });
  },
);

ipcMain.handle(
  "validate-library-path",
  (_e, args: { path: string }) => validateLibraryPath(args.path),
);

ipcMain.handle(
  "scan-existing-skills",
  (_e, args: { rootPath: string }) => scanForExistingSkills(args.rootPath),
);

ipcMain.handle(
  "compare-skill-dirs",
  (_e, args: { a: string; b: string }) => compareSkillDirs(args.a, args.b),
);

ipcMain.handle(
  "resolve-library-root",
  (_e, args: { root: LibraryRoot; customPath: string | null }) =>
    resolveLibraryRoot(args.root, args.customPath),
);

ipcMain.handle("complete-setup", (_e, args: CompleteSetupArgs) =>
  completeSetup(args),
);

ipcMain.handle(
  "wire-library-into-agent",
  async (_e, args: { agentId: string }) => {
    const config = await loadConfig();
    const skillsDir = getAgentSkillsDir(args.agentId);
    if (!skillsDir) {
      throw new Error(
        `Agent '${args.agentId}' has no global skills directory`,
      );
    }
    return wireLibraryIntoAgentDir(
      skillsDir,
      config.setup.libraryPath,
      config.settings.default_deploy_mode,
    );
  },
);

// ── Migration handlers ──

ipcMain.handle(
  "plan-migration",
  async (
    _e,
    args: {
      fromLibrary: string;
      toLibrary: string;
      moveHistory: boolean;
      fromHistory?: string;
      toHistory?: string;
    },
  ) => {
    const { planMigration } = await import("./services/migration");
    return planMigration(args);
  },
);

ipcMain.handle(
  "run-migration",
  async (
    _e,
    args: {
      plan: import("./services/migration").MigrationPlan;
      streamId?: string;
    },
  ) => {
    const { runMigration } = await import("./services/migration");
    const stringLogger = makeLogger(args.streamId);
    const onLog = stringLogger
      ? (m: import("./services/migration").MigrationProgressMsg) =>
          stringLogger(JSON.stringify(m))
      : undefined;
    try {
      return await runMigration(args.plan, {
        onLog,
        signal: registerCancellable(args.streamId),
      });
    } finally {
      clearCancellable(args.streamId);
    }
  },
);

ipcMain.handle("list-agents", () =>
  getSupportedAgents().map((a) => ({
    id: a.id,
    displayName: a.displayName,
    supportsSymlinks: a.supportsSymlinks,
    formatNotes: a.formatNotes,
    /** Default global skills dir for this agent, or null if none. The
     *  SetupFlow uses this to auto-scan the right place after the user
     *  picks an agent. */
    skillsDir: getAgentSkillsDir(a.id),
    /** Per-project deploy template, e.g. ".claude/skills/{name}/".
     *  DeployView renders this as a path preview so users can see
     *  exactly where files will land before clicking Deploy. */
    projectSkillPath: a.projectSkillPath,
  })),
);

ipcMain.handle("list-skills", () => listSkills());

ipcMain.handle(
  "install-from-url",
  async (_e, args: { url: string; streamId?: string }) => {
    try {
      return await installFromUrl(args.url, {
        onLog: makeLogger(args.streamId),
        signal: registerCancellable(args.streamId),
      });
    } finally {
      clearCancellable(args.streamId);
    }
  },
);

ipcMain.handle(
  "install-local-skill",
  (_e, args: { name: string; sourcePath: string }) =>
    installLocalSkill(args.name, args.sourcePath),
);

ipcMain.handle("check-updates", () => checkUpdates());

ipcMain.handle(
  "update-skill",
  async (_e, args: { name: string; streamId?: string }) => {
    try {
      return await updateSkill(args.name, {
        onLog: makeLogger(args.streamId),
        signal: registerCancellable(args.streamId),
      });
    } finally {
      clearCancellable(args.streamId);
    }
  },
);

ipcMain.handle(
  "deploy-skill",
  (
    _e,
    args: {
      name: string;
      projectPath: string;
      agentId?: string;
      deployMode?: "copy" | "symlink";
    },
  ) =>
    deploySkill(args.name, args.projectPath, {
      agentId: args.agentId,
      deployMode: args.deployMode,
    }),
);

ipcMain.handle(
  "remove-skill",
  (_e, args: { name: string; cascade: boolean }) =>
    removeSkill(args.name, { cascade: args.cascade }),
);

ipcMain.handle("list-projects", () => listTrackedProjects());

ipcMain.handle(
  "remove-project-tracking",
  (_e, args: { projectPath: string; cleanFiles: boolean }) =>
    removeProjectTracking(args.projectPath, { cleanFiles: args.cleanFiles }),
);

ipcMain.handle("export-markdown", () => exportMarkdown());

ipcMain.handle("export-json", () => exportJson());

ipcMain.handle("parse-import-json", (_e, text: string) =>
  parseImportJson(text),
);

ipcMain.handle("validate-skill-url", (_e, url: string) =>
  validateSkillUrl(url),
);

// Persist a string payload (markdown or JSON share) to a user-chosen path.
// Returns the chosen path or null when the user cancels.
ipcMain.handle(
  "save-text-file",
  async (
    _e,
    args: { defaultName: string; content: string; filterName?: string; extensions?: string[] },
  ) => {
    if (!mainWindow) return null;
    if (typeof args.content !== "string") {
      throw new Error("File content must be a string");
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: args.defaultName,
      filters:
        args.extensions && args.extensions.length > 0
          ? [
              {
                name: args.filterName ?? "File",
                extensions: args.extensions,
              },
            ]
          : undefined,
    });
    if (result.canceled || !result.filePath) return null;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(result.filePath, args.content, "utf8");
    return result.filePath;
  },
);

// Open a file picker, then return the chosen path + decoded UTF-8 content.
ipcMain.handle(
  "read-text-file",
  async (
    _e,
    args: { filterName?: string; extensions?: string[] } = {},
  ) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters:
        args.extensions && args.extensions.length > 0
          ? [
              {
                name: args.filterName ?? "File",
                extensions: args.extensions,
              },
            ]
          : undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const { readFile, stat } = await import("node:fs/promises");
    const s = await stat(filePath);
    if (s.size > 1_000_000) {
      throw new Error("File too large (>1 MB)");
    }
    const content = await readFile(filePath, "utf8");
    return { path: filePath, content };
  },
);

ipcMain.handle(
  "import-markdown",
  async (_e, args: { text: string; streamId?: string }) => {
    try {
      return await importMarkdown(args.text, {
        onLog: makeLogger(args.streamId),
        signal: registerCancellable(args.streamId),
      });
    } finally {
      clearCancellable(args.streamId);
    }
  },
);

ipcMain.handle("get-last-project", () => getLastProject());

ipcMain.handle("set-last-project", (_e, p: string) => setLastProject(p));

ipcMain.handle("open-in-finder", (_e, p: string) => {
  shell.showItemInFolder(p);
});

ipcMain.handle("open-path", (_e, p: string) => shell.openPath(p));

ipcMain.handle("pick-folder", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("write-clipboard", (_e, text: string) => {
  clipboard.writeText(text);
});

ipcMain.handle("make-stream-id", () => randomUUID());

ipcMain.handle("get-settings", () => getSettings());

ipcMain.handle("set-settings", (_e, partial: Record<string, unknown>) =>
  setSettings(partial as never),
);

ipcMain.handle("reset-config", () => resetConfig());

ipcMain.handle("list-skill-history", (_e, name: string) =>
  listSkillHistory(name),
);

ipcMain.handle(
  "rollback-skill",
  async (
    _e,
    args: {
      name: string;
      commit: string;
      cascade: boolean;
      streamId?: string;
    },
  ) => {
    try {
      return await rollbackSkill(
        args.name,
        args.commit,
        { cascade: args.cascade },
        {
          onLog: makeLogger(args.streamId),
          signal: registerCancellable(args.streamId),
        },
      );
    } finally {
      clearCancellable(args.streamId);
    }
  },
);

ipcMain.handle("cancel-operation", (_e, streamId: string) => {
  if (typeof streamId !== "string" || !streamId) return false;
  const ctl = operationControllers.get(streamId);
  if (!ctl) return false;
  ctl.abort();
  return true;
});

ipcMain.handle("get-history-size", () => getHistorySize());

ipcMain.handle("clear-all-history", () => clearAllHistory());

ipcMain.handle("get-skill-tree", (_e, name: string) => getSkillTree(name));

ipcMain.handle("open-external", (_e, url: string) => {
  // Defensive — only http(s). Refuse javascript:, file://, etc.
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
  void shell.openExternal(url);
});

// ── Stacks ──────────────────────────────────────────────────────────────────

ipcMain.handle("list-stacks", () => listStacks());

ipcMain.handle(
  "create-stack",
  (
    _e,
    args: { name: string; description: string; skillIds: string[] },
  ) => createStack(args.name, args.description, args.skillIds),
);

ipcMain.handle(
  "update-stack-composition",
  (
    _e,
    args: {
      stackId: string;
      skillIds: string[];
      cascadeRemoveOrphans?: boolean;
    },
  ) =>
    updateStackComposition(args.stackId, args.skillIds, {
      cascadeRemoveOrphans: args.cascadeRemoveOrphans === true,
    }),
);

ipcMain.handle(
  "preview-composition-cascade",
  (_e, args: { stackId: string; skillIds: string[] }) =>
    previewCompositionCascade(args.stackId, args.skillIds),
);

ipcMain.handle(
  "delete-stack",
  (_e, args: { stackId: string; cleanup: boolean }) =>
    deleteStack(args.stackId, args.cleanup),
);

ipcMain.handle(
  "deploy-stack",
  (
    _e,
    args: {
      stackId: string;
      projectPath: string;
      agentId: string;
      deployMode: DeployMode;
    },
  ) =>
    deployStack(args.stackId, args.projectPath, args.agentId, args.deployMode),
);

ipcMain.handle(
  "deploy-stack-to-home-library",
  (_e, args: { stackId: string }) => deployStackToHomeLibrary(args.stackId),
);

ipcMain.handle(
  "remove-stack-from-home-library",
  (_e, args: { stackId: string }) =>
    removeStackFromHomeLibrary(args.stackId),
);

ipcMain.handle(
  "get-stack-deployments",
  (_e, args: { stackId?: string } = {}) =>
    getStackDeployments(args.stackId),
);

ipcMain.handle(
  "remove-stack-deployment",
  (
    _e,
    args: {
      stackId: string;
      projectPath: string;
      agentId: string;
      cleanup: boolean;
      cascadeMembers?: boolean;
    },
  ) =>
    removeStackDeployment(args.stackId, args.projectPath, args.agentId, {
      cleanup: args.cleanup,
      cascadeMembers: args.cascadeMembers === true,
    }),
);
