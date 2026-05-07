import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import { CLAUDE_DIR, CONFIG_PATH, LIBRARY_PATH } from "./paths";

describe("paths constants", () => {
  it("CLAUDE_DIR is absolute and inside the user's home directory", () => {
    expect(isAbsolute(CLAUDE_DIR)).toBe(true);
    expect(CLAUDE_DIR.startsWith(homedir())).toBe(true);
    expect(CLAUDE_DIR.endsWith(".claude")).toBe(true);
  });

  it("LIBRARY_PATH is absolute and ends with /skills", () => {
    expect(isAbsolute(LIBRARY_PATH)).toBe(true);
    expect(LIBRARY_PATH.startsWith(homedir())).toBe(true);
    expect(LIBRARY_PATH.endsWith("/skills")).toBe(true);
  });

  it("CONFIG_PATH is absolute and ends with skill-manager.json", () => {
    expect(isAbsolute(CONFIG_PATH)).toBe(true);
    expect(CONFIG_PATH.startsWith(homedir())).toBe(true);
    expect(CONFIG_PATH.endsWith("skill-manager.json")).toBe(true);
  });

  it("LIBRARY_PATH lives inside CLAUDE_DIR", () => {
    expect(LIBRARY_PATH.startsWith(CLAUDE_DIR)).toBe(true);
  });

  it("CONFIG_PATH lives inside CLAUDE_DIR", () => {
    expect(CONFIG_PATH.startsWith(CLAUDE_DIR)).toBe(true);
  });
});
