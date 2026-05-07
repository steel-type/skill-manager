import { homedir } from "node:os";
import { join } from "node:path";

export const CLAUDE_DIR = join(homedir(), ".claude");
export const CONFIG_PATH = join(CLAUDE_DIR, "skill-manager.json");
export const LIBRARY_PATH = join(CLAUDE_DIR, "skills");
