import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIG_PATH,
  configurePaths,
  getClaudeDir,
  getHistoryPath,
  getLibraryPath,
  resetPathsForTest,
} from "./paths";

afterEach(() => {
  resetPathsForTest();
});

describe("paths defaults", () => {
  it("getClaudeDir returns an absolute path inside the user's home", () => {
    const claudeDir = getClaudeDir();
    expect(isAbsolute(claudeDir)).toBe(true);
    expect(claudeDir.startsWith(homedir())).toBe(true);
    expect(claudeDir.endsWith(".claude")).toBe(true);
  });

  it("getLibraryPath defaults to <home>/.claude/skills", () => {
    const lib = getLibraryPath();
    expect(isAbsolute(lib)).toBe(true);
    expect(lib).toBe(join(homedir(), ".claude", "skills"));
  });

  it("getHistoryPath defaults to <home>/.claude/skills-history", () => {
    const hist = getHistoryPath();
    expect(isAbsolute(hist)).toBe(true);
    expect(hist).toBe(join(homedir(), ".claude", "skills-history"));
  });

  it("CONFIG_PATH stays anchored at ~/.claude/skill-manager.json", () => {
    expect(isAbsolute(CONFIG_PATH)).toBe(true);
    expect(CONFIG_PATH.startsWith(homedir())).toBe(true);
    expect(CONFIG_PATH.endsWith("skill-manager.json")).toBe(true);
  });
});

describe("configurePaths", () => {
  it("updates getLibraryPath / getHistoryPath but not getClaudeDir", () => {
    configurePaths({
      libraryPath: "/var/tmp/skills",
      historyPath: "/var/tmp/skills-history",
    });
    expect(getLibraryPath()).toBe("/var/tmp/skills");
    expect(getHistoryPath()).toBe("/var/tmp/skills-history");
    // CLAUDE_DIR isn't relocatable — the app's config home stays put.
    expect(getClaudeDir()).toBe(join(homedir(), ".claude"));
  });

  it("rejects relative library paths", () => {
    expect(() =>
      configurePaths({
        libraryPath: "relative/skills",
        historyPath: "/var/tmp/skills-history",
      }),
    ).toThrow(/absolute/);
  });

  it("rejects relative history paths", () => {
    expect(() =>
      configurePaths({
        libraryPath: "/var/tmp/skills",
        historyPath: "rel/history",
      }),
    ).toThrow(/absolute/);
  });

  it("resetPathsForTest restores defaults", () => {
    configurePaths({
      libraryPath: "/elsewhere/skills",
      historyPath: "/elsewhere/skills-history",
    });
    expect(getLibraryPath()).toBe("/elsewhere/skills");
    resetPathsForTest();
    expect(getLibraryPath()).toBe(join(homedir(), ".claude", "skills"));
  });
});
