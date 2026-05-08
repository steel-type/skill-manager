// Runtime-resolved paths for the skill-manager backend.
//
// Phase A makes the library and history paths configurable so the canonical
// library can live in any agent's native skills directory (or a centralized
// location) instead of always under ~/.claude/skills/. Consumers MUST use
// the getters (not the legacy const exports) so a path change at runtime
// propagates correctly.
//
// CONFIG_PATH stays anchored at ~/.claude/skill-manager.json — the app's
// own config is fixed regardless of where the library lives, so a fresh
// install can find an existing config without being told where to look.

import { homedir } from "node:os";
import { join } from "node:path";
import { isAbsolute } from "node:path";

const DEFAULT_CLAUDE_DIR = join(homedir(), ".claude");
const DEFAULT_LIBRARY_PATH = join(DEFAULT_CLAUDE_DIR, "skills");
const DEFAULT_HISTORY_PATH = join(DEFAULT_CLAUDE_DIR, "skills-history");

interface PathState {
  claudeDir: string;
  libraryPath: string;
  historyPath: string;
}

const state: PathState = {
  claudeDir: DEFAULT_CLAUDE_DIR,
  libraryPath: DEFAULT_LIBRARY_PATH,
  historyPath: DEFAULT_HISTORY_PATH,
};

/** Configure runtime paths from setup. Call once at bootstrap after
 *  loadConfig() determines the persisted setup state. Both paths must be
 *  absolute; relative paths would let bugs cascade into surprising places. */
export function configurePaths(args: {
  libraryPath: string;
  historyPath: string;
}): void {
  if (!isAbsolute(args.libraryPath)) {
    throw new Error(
      `configurePaths: libraryPath must be absolute (got ${args.libraryPath})`,
    );
  }
  if (!isAbsolute(args.historyPath)) {
    throw new Error(
      `configurePaths: historyPath must be absolute (got ${args.historyPath})`,
    );
  }
  state.libraryPath = args.libraryPath;
  state.historyPath = args.historyPath;
}

/** Reset the in-memory paths back to defaults. Used by tests; not
 *  exposed in production flows. */
export function resetPathsForTest(): void {
  state.claudeDir = DEFAULT_CLAUDE_DIR;
  state.libraryPath = DEFAULT_LIBRARY_PATH;
  state.historyPath = DEFAULT_HISTORY_PATH;
}

export function getClaudeDir(): string {
  return state.claudeDir;
}

export function getLibraryPath(): string {
  return state.libraryPath;
}

export function getHistoryPath(): string {
  return state.historyPath;
}

export const CONFIG_PATH = join(DEFAULT_CLAUDE_DIR, "skill-manager.json");
