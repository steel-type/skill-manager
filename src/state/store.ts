import { create } from "zustand";
import type {
  AppSettings,
  Skill,
  TrackedProject,
  UpdateInfo,
} from "../../electron/services/types";

export type Tab = "library" | "deploy" | "settings";
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
  | { type: "deploy"; skill: string };

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
  setActiveTab: (activeTab) => set({ activeTab }),

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
}));
