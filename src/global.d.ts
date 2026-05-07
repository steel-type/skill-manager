import type { SkillManagerApi } from "../electron/preload";

declare global {
  interface Window {
    api: SkillManagerApi;
  }
}

export {};
