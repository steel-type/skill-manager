import { create } from "zustand";
import type {
  AppSettings,
  DeployRequest,
  SetupConfig,
  Skill,
  SkillStack,
  StackDeployment,
  TrackedProject,
  UpdateInfo,
} from "../../electron/services/types";
import { DEFAULT_SETTINGS, DEFAULT_SETUP } from "../../electron/services/types";

export type Tab = "library" | "stacks" | "deploy" | "settings";
export type LibraryFilter =
  | "all"
  | "updates"
  | "bundles"
  | "local"
  | "deployed";
export type LibraryLayout = "cards" | "palette";

export interface DeployResultMessage {
  level: "info" | "warn" | "error" | "success";
  text: string;
}

export type ModalState =
  | null
  | { type: "install"; prefillUrl?: string }
  | { type: "removeSkill"; name: string }
  | { type: "removeProject"; path: string }
  | { type: "rollback"; name: string }
  | { type: "deleteStack"; stackId: string }
  | {
      // Generic in-app confirm dialog. Replaces window.confirm() so the
      // popup honors the app theme and modal corner-radius.
      type: "confirm";
      title: string;
      body: string;
      confirmLabel?: string;
      cancelLabel?: string;
      destructive?: boolean;
      onConfirm: () => void | Promise<void>;
      /** Optional. When provided, the cancel button runs this action
       *  (instead of just closing the modal). Lets a confirm dialog act
       *  as a two-action chooser — e.g., "Place in home library" /
       *  "Skip — proceed anyway". */
      onCancel?: () => void | Promise<void>;
    }
  | {
      // Outcome of a Deploy run. Replaces the inline 'Last run' card so the
      // result doesn't push the column layout around when it appears.
      type: "deployResult";
      // What was being deployed: skill or stack id, or null for unknown.
      itemKind: "skill" | "stack";
      itemId: string;
      messages: DeployResultMessage[];
    }
  | {
      // Library relocation flow. Opened from Settings → Library → Move…
      // after the user picks a destination folder.
      type: "migrate";
      toLibraryPath: string;
    };

/**
 * Full-pane "screens" that take over the right-pane (the LeftRail stays
 * visible). Used for multi-step flows that warrant their own breadcrumb
 * rather than a popup modal.
 */
export interface ImportEntryPrefill {
  name: string;
  url: string;
  commit?: string | null;
  description?: string;
  alreadyInstalled: boolean;
}

export type Screen =
  | { kind: "main" }
  | { kind: "update"; prefillName?: string }
  | { kind: "detail"; name: string }
  | { kind: "stackDetail"; stackId: string }
  | { kind: "createStack" }
  | { kind: "editStack"; stackId: string }
  | {
      kind: "import";
      entries: ImportEntryPrefill[];
      sourcePath: string | null;
      exportedAt: string | null;
    };

// Error queue replaces the old single-slot lastError. Multiple async
// operations can surface errors concurrently — under the old model, a
// fast failure overwrote a slower one's message and the user only saw
// the noisier one. Each entry auto-dismisses on a 6s timer (handled in
// App.tsx) but the queue ordering survives.
export interface AppError {
  id: string;
  source: "skills" | "projects" | "updateCheck" | "settings" | "setup" | "stacks" | "deploy" | "generic";
  message: string;
  /** ISO timestamp the error was raised. Used for sorting + auto-dismiss
   *  scheduling. */
  raisedAt: string;
}

interface AppState {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;

  libraryLayout: LibraryLayout;
  setLibraryLayout: (layout: LibraryLayout) => void;

  filter: LibraryFilter;
  setFilter: (filter: LibraryFilter) => void;

  selectedSkill: string | null;
  setSelectedSkill: (name: string | null) => void;

  // Cached data — refreshed via refreshSkills() / refreshProjects().
  skills: Skill[];
  projects: TrackedProject[];
  updateInfo: Record<string, UpdateInfo>;
  isLoading: boolean;
  isCheckingUpdates: boolean;
  /** ISO timestamp of the last successful runUpdateCheck completion. Drives
   *  the "✓ All current" feedback in LibraryView when updatesCount === 0,
   *  so a Check that finds nothing isn't a hollow gesture. Null until the
   *  user has run at least one check this session. */
  lastUpdateCheckAt: string | null;
  /** Skills examined / updates found on the last check. */
  lastUpdateCheckSummary: { total: number; updatesAvailable: number } | null;
  errors: AppError[];
  /** Back-compat alias — last error message, or null when the queue is
   *  empty. Read-only derived. */
  lastError: string | null;

  refreshSkills: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  runUpdateCheck: () => Promise<void>;
  setUpdateInfo: (info: Record<string, UpdateInfo>) => void;
  /** Push an error onto the queue. Pass `null` to clear ALL errors.
   *  Internally records source + auto-id so multiple toasts can render. */
  setError: (msg: string | null, source?: AppError["source"]) => void;
  /** Dismiss a specific error by id. */
  dismissError: (id: string) => void;

  // Names of skills currently being updated. Drives the inline "updating…"
  // pip on SkillCard so users get immediate visual feedback even when the
  // modal happens to be elsewhere on screen or just closed.
  updatingNames: Set<string>;
  markUpdating: (name: string) => void;
  unmarkUpdating: (name: string) => void;

  // Modals — all driven by a single discriminated union for predictability.
  modal: ModalState;
  /**
   * Open a modal. When a modal that the user is actively deciding on (any
   * `confirm` or destructive flow) is already mounted, a background event
   * (auto-dismiss of a deploy result, an arriving import summary, etc.)
   * MUST NOT clobber it — the user clicks "Confirm" expecting to confirm
   * what's on screen. Background-class openers can pass `{ background:
   * true }` to defer instead of clobbering; foreground (user-clicked)
   * openers always win.
   */
  openModal: (
    m: NonNullable<ModalState>,
    opts?: { background?: boolean },
  ) => void;
  closeModal: () => void;

  // Right-pane screens. `update` is the multi-step bulk update flow; it
  // gets its own screen rather than a popup so the user has a proper back
  // breadcrumb during the (potentially long) review/run cycle.
  screen: Screen;
  setScreen: (s: Screen) => void;

  // Settings — synced from disk via window.api.getSettings().
  settings: AppSettings;
  loadSettings: () => Promise<void>;
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>;

  // First-run / library-relocation state.
  setup: SetupConfig;
  loadSetup: () => Promise<void>;
  setSetup: (partial: Partial<SetupConfig>) => Promise<void>;

  // ── Stacks ──────────────────────────────────────────────────────────────
  stacks: SkillStack[];
  stackDeployments: StackDeployment[];
  /** Most-recently-opened StackDetailFlow stack id. Lets the detail screen
   *  re-render after composition edits without re-loading. */
  activeStackId: string | null;
  /** Skill or stack queued for deployment. Set by `queueSkillForDeploy` /
   *  `queueStackForDeploy`, which also flip `activeTab` to "deploy". The
   *  Deploy view reads this and pre-selects the queued item. */
  deployQueue: DeployRequest | null;

  loadStacks: () => Promise<void>;
  loadStackDeployments: () => Promise<void>;
  createStack: (
    name: string,
    description: string,
    skillIds: string[],
  ) => Promise<SkillStack>;
  updateStackComposition: (
    stackId: string,
    skillIds: string[],
    opts?: { cascadeRemoveOrphans?: boolean },
  ) => Promise<{
    stack: SkillStack;
    added: string[];
    removed: string[];
    cascadeRemoved: { skillId: string; projectPath: string; agentId: string }[];
    cascadeSkipped: { skillId: string; projectPath: string; agentId: string; reason: string }[];
  }>;
  deleteStack: (stackId: string, cleanup: boolean) => Promise<void>;
  deployStackToHomeLibrary: (stackId: string) => Promise<void>;
  removeStackFromHomeLibrary: (stackId: string) => Promise<void>;
  setActiveStack: (stackId: string | null) => void;
  queueSkillForDeploy: (skillName: string) => void;
  queueStackForDeploy: (stackId: string) => void;
  clearDeployQueue: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  activeTab: "library",
  // Switching the primary tab always returns the right pane to its main
  // content. Without this, a tab click while a takeover screen (Detail,
  // Stack detail, Update, Import, CreateStack) was open would leave the
  // screen on top of the new tab — the left rail would say Deploy but the
  // user would still be looking at SkillDetail.
  setActiveTab: (activeTab) =>
    set((state) =>
      state.screen.kind === "main"
        ? { activeTab }
        : { activeTab, screen: { kind: "main" } },
    ),

  libraryLayout: "cards",
  setLibraryLayout: (libraryLayout) => set({ libraryLayout }),

  filter: "all",
  setFilter: (filter) => set({ filter }),

  selectedSkill: null,
  setSelectedSkill: (selectedSkill) => set({ selectedSkill }),

  skills: [],
  projects: [],
  updateInfo: {},
  isLoading: false,
  isCheckingUpdates: false,
  lastUpdateCheckAt: null,
  lastUpdateCheckSummary: null,
  errors: [],
  lastError: null,

  refreshSkills: async () => {
    set({ isLoading: true });
    try {
      const skills = await window.api.listSkills();
      set({ skills, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      get().setError(
        err instanceof Error ? err.message : String(err),
        "skills",
      );
    }
  },

  refreshProjects: async () => {
    try {
      const projects = await window.api.listProjects();
      set({ projects });
    } catch (err) {
      get().setError(
        err instanceof Error ? err.message : String(err),
        "projects",
      );
    }
  },

  runUpdateCheck: async () => {
    if (get().isCheckingUpdates) return;
    set({ isCheckingUpdates: true });
    try {
      const updateInfo = await window.api.checkUpdates();
      const total = Object.keys(updateInfo).length;
      const updatesAvailable = Object.values(updateInfo).filter(
        (u) => u.hasUpdate,
      ).length;
      set({
        updateInfo,
        isCheckingUpdates: false,
        lastUpdateCheckAt: new Date().toISOString(),
        lastUpdateCheckSummary: { total, updatesAvailable },
      });
    } catch (err) {
      set({ isCheckingUpdates: false });
      get().setError(
        err instanceof Error ? err.message : String(err),
        "updateCheck",
      );
    }
  },

  setUpdateInfo: (updateInfo) => set({ updateInfo }),
  setError: (msg, source) => {
    if (msg === null) {
      set({ errors: [], lastError: null });
      return;
    }
    const entry: AppError = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: source ?? "generic",
      message: msg,
      raisedAt: new Date().toISOString(),
    };
    set((state) => {
      // Bound the queue. Five concurrent errors is already too noisy; older
      // ones drop off so the user sees current state, not a wall of stale.
      const next = [...state.errors, entry].slice(-5);
      return { errors: next, lastError: next[next.length - 1]?.message ?? null };
    });
  },
  dismissError: (id) => {
    set((state) => {
      const next = state.errors.filter((e) => e.id !== id);
      return { errors: next, lastError: next[next.length - 1]?.message ?? null };
    });
  },

  updatingNames: new Set<string>(),
  markUpdating: (name) =>
    set((state) => {
      const next = new Set(state.updatingNames);
      next.add(name);
      return { updatingNames: next };
    }),
  unmarkUpdating: (name) =>
    set((state) => {
      if (!state.updatingNames.has(name)) return state;
      const next = new Set(state.updatingNames);
      next.delete(name);
      return { updatingNames: next };
    }),

  modal: null,
  openModal: (modal, opts) => {
    const current = get().modal;
    const userDeciding =
      current?.type === "confirm" ||
      current?.type === "removeSkill" ||
      current?.type === "removeProject" ||
      current?.type === "deleteStack" ||
      current?.type === "rollback";
    if (opts?.background === true && userDeciding) {
      // Background event tried to clobber a decision dialog — drop it.
      // The originating system surfaces its result through `errors` (a
      // toast) so the information isn't lost.
      return;
    }
    set({ modal });
  },
  closeModal: () => set({ modal: null }),

  screen: { kind: "main" },
  setScreen: (screen) => set({ screen }),

  settings: DEFAULT_SETTINGS,
  loadSettings: async () => {
    try {
      const settings = await window.api.getSettings();
      set({ settings, libraryLayout: settings.default_layout });
    } catch (err) {
      get().setError(err instanceof Error ? err.message : String(err));
    }
  },
  setup: DEFAULT_SETUP,
  loadSetup: async () => {
    try {
      const setup = await window.api.getSetup();
      set({ setup });
    } catch (err) {
      get().setError(err instanceof Error ? err.message : String(err));
    }
  },
  setSetup: async (partial) => {
    try {
      const setup = await window.api.setSetup(partial);
      set({ setup });
    } catch (err) {
      get().setError(err instanceof Error ? err.message : String(err));
    }
  },

  updateSettings: async (partial) => {
    try {
      const settings = await window.api.setSettings(partial);
      // When the user changes the default library layout from Settings, also
      // flip the live library layout — otherwise the dropdown is a hollow
      // gesture (config persists, current view doesn't change). Same for
      // theme/deploy mode could go here if we add similar live syncs later.
      const next: Partial<AppState> = { settings };
      if (
        partial.default_layout !== undefined &&
        settings.default_layout !== get().libraryLayout
      ) {
        next.libraryLayout = settings.default_layout;
      }
      set(next);
    } catch (err) {
      get().setError(err instanceof Error ? err.message : String(err));
    }
  },

  // ── Stacks ────────────────────────────────────────────────────────────────

  stacks: [],
  stackDeployments: [],
  activeStackId: null,
  deployQueue: null,

  loadStacks: async () => {
    try {
      const stacks = await window.api.listStacks();
      set({ stacks });
    } catch (err) {
      get().setError(err instanceof Error ? err.message : String(err));
    }
  },

  loadStackDeployments: async () => {
    try {
      const stackDeployments = await window.api.getStackDeployments();
      set({ stackDeployments });
    } catch (err) {
      get().setError(err instanceof Error ? err.message : String(err));
    }
  },

  createStack: async (name, description, skillIds) => {
    const stack = await window.api.createStack(name, description, skillIds);
    set((state) => ({ stacks: [...state.stacks, stack] }));
    return stack;
  },

  updateStackComposition: async (stackId, skillIds, opts) => {
    const result = await window.api.updateStackComposition(
      stackId,
      skillIds,
      opts,
    );
    set((state) => ({
      stacks: state.stacks.map((s) =>
        s.id === stackId ? result.stack : s,
      ),
    }));
    // Refresh deployments since includedSkillIds and timestamp changed.
    // If cascade removed any member files, the skill records changed too.
    await get().loadStackDeployments();
    if (result.cascadeRemoved.length > 0) {
      await get().refreshSkills();
      await get().refreshProjects();
    }
    return result;
  },

  deleteStack: async (stackId, cleanup) => {
    await window.api.deleteStack(stackId, cleanup);
    set((state) => ({
      stacks: state.stacks.filter((s) => s.id !== stackId),
      stackDeployments: state.stackDeployments.filter(
        (d) => d.stackId !== stackId,
      ),
      activeStackId:
        state.activeStackId === stackId ? null : state.activeStackId,
    }));
    // Library entries may have changed (a stack was removed from the
    // home library implicitly via cleanup). Re-list so the Library view
    // reflects reality.
    await get().refreshSkills();
  },

  deployStackToHomeLibrary: async (stackId) => {
    const result = await window.api.deployStackToHomeLibrary(stackId);
    if (result.warning) get().setError(result.warning);
    await get().loadStacks();
    await get().refreshSkills();
  },

  removeStackFromHomeLibrary: async (stackId) => {
    await window.api.removeStackFromHomeLibrary(stackId);
    await get().loadStacks();
    await get().refreshSkills();
  },

  setActiveStack: (activeStackId) => set({ activeStackId }),

  queueSkillForDeploy: (skillName) =>
    set({
      deployQueue: { type: "skill", id: skillName },
      activeTab: "deploy",
      // Reset any takeover screen so the user lands on the Deploy view
      // instead of staying on whatever screen they Send-to-Deploy'd from.
      screen: { kind: "main" },
      // Close any modal that was previously routing to the Deploy flow.
      modal: null,
    }),

  queueStackForDeploy: (stackId) =>
    set({
      deployQueue: { type: "stack", id: stackId },
      activeTab: "deploy",
      screen: { kind: "main" },
      modal: null,
    }),

  clearDeployQueue: () => set({ deployQueue: null }),
}));
