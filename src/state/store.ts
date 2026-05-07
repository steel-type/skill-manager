import { create } from "zustand";
import type {
  AppSettings,
  DeployRequest,
  Skill,
  SkillStack,
  StackDeployment,
  TrackedProject,
  UpdateInfo,
} from "../../electron/services/types";

export type Tab = "library" | "stacks" | "deploy" | "settings";
export type LibraryFilter =
  | "all"
  | "updates"
  | "bundles"
  | "local"
  | "deployed";
export type LibraryLayout = "cards" | "palette";

export type ModalState =
  | null
  | { type: "install"; prefillUrl?: string }
  | { type: "removeSkill"; name: string }
  | { type: "removeProject"; path: string }
  | { type: "rollback"; name: string }
  | { type: "deploy"; skill: string }
  | { type: "deleteStack"; stackId: string };

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
  lastError: string | null;

  refreshSkills: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  runUpdateCheck: () => Promise<void>;
  setUpdateInfo: (info: Record<string, UpdateInfo>) => void;
  setError: (msg: string | null) => void;

  // Names of skills currently being updated. Drives the inline "updating…"
  // pip on SkillCard so users get immediate visual feedback even when the
  // modal happens to be elsewhere on screen or just closed.
  updatingNames: Set<string>;
  markUpdating: (name: string) => void;
  unmarkUpdating: (name: string) => void;

  // Modals — all driven by a single discriminated union for predictability.
  modal: ModalState;
  openModal: (m: NonNullable<ModalState>) => void;
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
  ) => Promise<void>;
  deleteStack: (stackId: string, cleanup: boolean) => Promise<void>;
  setActiveStack: (stackId: string | null) => void;
  queueSkillForDeploy: (skillName: string) => void;
  queueStackForDeploy: (stackId: string) => void;
  clearDeployQueue: () => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  auto_check_updates: false,
  cascade_updates: true,
  confirm_before_remove: true,
  show_resource_only: false,
  default_layout: "cards",
  update_history_retention: 2,
  theme: "light",
  default_deploy_mode: "copy",
};

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
  lastError: null,

  refreshSkills: async () => {
    set({ isLoading: true, lastError: null });
    try {
      const skills = await window.api.listSkills();
      set({ skills, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  refreshProjects: async () => {
    try {
      const projects = await window.api.listProjects();
      set({ projects });
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) });
    }
  },

  runUpdateCheck: async () => {
    if (get().isCheckingUpdates) return;
    set({ isCheckingUpdates: true, lastError: null });
    try {
      const updateInfo = await window.api.checkUpdates();
      set({ updateInfo, isCheckingUpdates: false });
    } catch (err) {
      set({
        isCheckingUpdates: false,
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setUpdateInfo: (updateInfo) => set({ updateInfo }),
  setError: (lastError) => set({ lastError }),

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
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),

  screen: { kind: "main" },
  setScreen: (screen) => set({ screen }),

  settings: DEFAULT_SETTINGS,
  loadSettings: async () => {
    try {
      const settings = await window.api.getSettings();
      set({ settings, libraryLayout: settings.default_layout });
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) });
    }
  },
  updateSettings: async (partial) => {
    try {
      const settings = await window.api.setSettings(partial);
      set({ settings });
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) });
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
      set({ lastError: err instanceof Error ? err.message : String(err) });
    }
  },

  loadStackDeployments: async () => {
    try {
      const stackDeployments = await window.api.getStackDeployments();
      set({ stackDeployments });
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) });
    }
  },

  createStack: async (name, description, skillIds) => {
    const stack = await window.api.createStack(name, description, skillIds);
    set((state) => ({ stacks: [...state.stacks, stack] }));
    return stack;
  },

  updateStackComposition: async (stackId, skillIds) => {
    const result = await window.api.updateStackComposition(stackId, skillIds);
    set((state) => ({
      stacks: state.stacks.map((s) =>
        s.id === stackId ? result.stack : s,
      ),
    }));
    // Refresh deployments since includedSkillIds and timestamp changed.
    await get().loadStackDeployments();
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
