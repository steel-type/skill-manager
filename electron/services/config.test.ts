import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Per-suite temp dir under tmpdir() with mocked paths.* values, so the real
// ~/.claude/skill-manager.json is never touched.
vi.mock("./paths", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const root = path.join(
    os.tmpdir(),
    `skill-manager-config-test-${process.pid}-${Date.now()}`,
  );
  return {
    CLAUDE_DIR: path.join(root, ".claude"),
    LIBRARY_PATH: path.join(root, ".claude", "skills"),
    CONFIG_PATH: path.join(root, ".claude", "skill-manager.json"),
  };
});

import { CONFIG_PATH, LIBRARY_PATH } from "./paths";
import {
  loadConfig,
  reconcileConfig,
  saveConfig,
  withConfigLock,
} from "./config";
import { DEFAULT_SETTINGS } from "./types";
import { dirname } from "node:path";

beforeEach(async () => {
  await fs.mkdir(dirname(CONFIG_PATH), { recursive: true });
});

afterEach(async () => {
  // Wipe the whole faux ~/.claude tree between tests so each starts clean.
  await fs.rm(dirname(CONFIG_PATH), { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns defaults when the file does not exist", async () => {
    const config = await loadConfig();
    expect(config.last_project).toBe("");
    expect(config.skills).toEqual({});
    expect(config.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("reads and parses an existing valid config", async () => {
    const stored = {
      last_project: "/Users/test/proj",
      skills: {
        alpha: {
          url: "https://github.com/x/alpha",
          commit: "abcd123",
          installed_at: "2025-01-01T00:00:00",
          updated_at: "2025-02-01T00:00:00",
          projects: ["/p1"],
        },
      },
      settings: { ...DEFAULT_SETTINGS, theme: "dark" as const },
    };
    await fs.writeFile(CONFIG_PATH, JSON.stringify(stored));
    const config = await loadConfig();
    expect(config.last_project).toBe("/Users/test/proj");
    expect(config.skills.alpha.url).toBe("https://github.com/x/alpha");
    expect(config.settings.theme).toBe("dark");
  });

  it("fills in missing settings keys with defaults", async () => {
    await fs.writeFile(
      CONFIG_PATH,
      JSON.stringify({ skills: {}, settings: { theme: "dark" } }),
    );
    const config = await loadConfig();
    expect(config.settings.theme).toBe("dark");
    expect(config.settings.auto_check_updates).toBe(
      DEFAULT_SETTINGS.auto_check_updates,
    );
    expect(config.settings.cascade_updates).toBe(
      DEFAULT_SETTINGS.cascade_updates,
    );
  });

  it("migrates the old installed_skills[] shape into skills{}", async () => {
    await fs.writeFile(
      CONFIG_PATH,
      JSON.stringify({
        installed_skills: [
          { name: "old-one", url: "https://github.com/x/old-one" },
          { name: "old-two", url: null },
        ],
      }),
    );
    const config = await loadConfig();
    expect(Object.keys(config.skills).sort()).toEqual(["old-one", "old-two"]);
    expect(config.skills["old-one"].url).toBe("https://github.com/x/old-one");
    expect(config.skills["old-two"].url).toBeNull();
  });

  it("backs up a corrupt file and recovers with defaults", async () => {
    await fs.writeFile(CONFIG_PATH, "{ this is not valid json");
    const config = await loadConfig();
    expect(config.skills).toEqual({});
    // The corrupt file should have been renamed to a sibling.
    const dir = dirname(CONFIG_PATH);
    const entries = await fs.readdir(dir);
    expect(entries.some((e) => e.includes("corrupt"))).toBe(true);
  });
});

describe("saveConfig", () => {
  it("writes valid JSON that round-trips", async () => {
    const config = {
      last_project: "/p",
      skills: {
        beta: {
          url: null,
          commit: null,
          installed_at: "2025-01-01T00:00:00",
          updated_at: null,
          projects: [],
        },
      },
      settings: DEFAULT_SETTINGS,
    };
    await saveConfig(config);
    const text = await fs.readFile(CONFIG_PATH, "utf8");
    expect(JSON.parse(text)).toEqual(config);
  });

  it("creates the parent directory when it does not exist", async () => {
    // Wipe the parent so saveConfig has to mkdir it.
    await fs.rm(dirname(CONFIG_PATH), { recursive: true, force: true });
    await saveConfig({
      last_project: "",
      skills: {},
      settings: DEFAULT_SETTINGS,
    });
    const stat = await fs.stat(CONFIG_PATH);
    expect(stat.isFile()).toBe(true);
  });

  it("uses an atomic tmp+rename so the existing file survives a write failure", async () => {
    // Pre-seed a known good config.
    const original = {
      last_project: "/original",
      skills: {},
      settings: DEFAULT_SETTINGS,
    };
    await saveConfig(original);

    // Force JSON.stringify to throw mid-save (simulates a serialization
    // failure during a write that has already been started).
    const stringifySpy = vi
      .spyOn(JSON, "stringify")
      .mockImplementationOnce(() => {
        throw new Error("simulated serialize failure");
      });

    await expect(
      saveConfig({
        last_project: "/should-not-land",
        skills: {},
        settings: DEFAULT_SETTINGS,
      }),
    ).rejects.toThrow();

    stringifySpy.mockRestore();

    // Original config still intact.
    const text = await fs.readFile(CONFIG_PATH, "utf8");
    expect(JSON.parse(text).last_project).toBe("/original");

    // No tmp files left behind.
    const entries = await fs.readdir(dirname(CONFIG_PATH));
    expect(entries.some((e) => e.includes(".tmp-"))).toBe(false);
  });
});

describe("withConfigLock", () => {
  it("serializes concurrent calls in FIFO order", async () => {
    const order: string[] = [];
    const a = withConfigLock(async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push("a");
      return "a";
    });
    const b = withConfigLock(async () => {
      order.push("b");
      return "b";
    });
    await Promise.all([a, b]);
    expect(order).toEqual(["a", "b"]);
  });

  it("rejected operation does not poison subsequent locks", async () => {
    const failing = withConfigLock(async () => {
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");
    const ok = await withConfigLock(async () => "still works");
    expect(ok).toBe("still works");
  });
});

describe("reconcileConfig", () => {
  it("adds entries for skills present on disk but missing from config", async () => {
    await fs.mkdir(`${LIBRARY_PATH}/found-skill`, { recursive: true });
    const initial = {
      last_project: "",
      skills: {},
      settings: DEFAULT_SETTINGS,
    };
    const reconciled = await reconcileConfig(initial);
    expect(reconciled.skills["found-skill"]).toBeDefined();
    expect(reconciled.skills["found-skill"].url).toBeNull();
  });

  it("removes config entries for skills no longer on disk", async () => {
    await fs.mkdir(LIBRARY_PATH, { recursive: true });
    const initial = {
      last_project: "",
      skills: {
        ghost: {
          url: null,
          commit: null,
          installed_at: "2025-01-01T00:00:00",
          updated_at: null,
          projects: [],
        },
      },
      settings: DEFAULT_SETTINGS,
    };
    const reconciled = await reconcileConfig(initial);
    expect(reconciled.skills.ghost).toBeUndefined();
  });

  it("prunes project paths that no longer exist", async () => {
    await fs.mkdir(`${LIBRARY_PATH}/keep`, { recursive: true });
    const aliveProject = `${LIBRARY_PATH}/__live_project__`;
    await fs.mkdir(aliveProject, { recursive: true });
    const initial = {
      last_project: "",
      skills: {
        keep: {
          url: null,
          commit: null,
          installed_at: "2025-01-01T00:00:00",
          updated_at: null,
          projects: [aliveProject, "/this/does/not/exist"],
        },
      },
      settings: DEFAULT_SETTINGS,
    };
    const reconciled = await reconcileConfig(initial);
    expect(reconciled.skills.keep.projects).toEqual([aliveProject]);
  });

  it("ignores hidden directories like .git inside the library root", async () => {
    await fs.mkdir(`${LIBRARY_PATH}/.git`, { recursive: true });
    await fs.mkdir(`${LIBRARY_PATH}/visible`, { recursive: true });
    const reconciled = await reconcileConfig({
      last_project: "",
      skills: {},
      settings: DEFAULT_SETTINGS,
    });
    expect(reconciled.skills[".git"]).toBeUndefined();
    expect(reconciled.skills.visible).toBeDefined();
  });
});
