import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

// Per-suite tmp tree under tmpdir() so we never write into the real
// ~/.claude/skills-history. paths.* values mocked at top.
vi.mock("./paths", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const root = path.join(
    os.tmpdir(),
    `skill-manager-history-test-${process.pid}-${Date.now()}`,
  );
  return {
    CLAUDE_DIR: path.join(root, ".claude"),
    LIBRARY_PATH: path.join(root, ".claude", "skills"),
    CONFIG_PATH: path.join(root, ".claude", "skill-manager.json"),
  };
});

import { CLAUDE_DIR, LIBRARY_PATH } from "./paths";
import {
  archiveSkillVersion,
  clearHistory,
  HISTORY_PATH,
  listHistory,
  pruneHistory,
  reconcileHistory,
  restoreSnapshot,
  totalHistorySize,
} from "./history";

const SNAPSHOT_ROOT = HISTORY_PATH;

async function plantSkill(name: string, content: string): Promise<void> {
  const dir = join(LIBRARY_PATH, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, "SKILL.md"), content);
}

beforeEach(async () => {
  await fs.mkdir(LIBRARY_PATH, { recursive: true });
  await fs.mkdir(SNAPSHOT_ROOT, { recursive: true });
});

afterEach(async () => {
  await fs.rm(CLAUDE_DIR, { recursive: true, force: true });
});

describe("archiveSkillVersion", () => {
  it("moves the live library copy into skills-history/<name>/<commit>/", async () => {
    await plantSkill("alpha", "v1");
    const snap = await archiveSkillVersion("alpha", "abc1234");
    expect(snap).not.toBeNull();
    expect(snap!.commit).toBe("abc1234");
    const moved = await fs.readFile(
      join(SNAPSHOT_ROOT, "alpha", "abc1234", "SKILL.md"),
      "utf8",
    );
    expect(moved).toBe("v1");
    // Live copy should be gone (it was renamed, not copied).
    await expect(
      fs.stat(join(LIBRARY_PATH, "alpha")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns null when the skill does not exist on disk", async () => {
    const snap = await archiveSkillVersion("ghost", "deadbeef");
    expect(snap).toBeNull();
  });

  it("synthesizes a stable commit label when none is provided", async () => {
    await plantSkill("beta", "no-commit");
    const snap = await archiveSkillVersion("beta", null);
    expect(snap).not.toBeNull();
    expect(snap!.commit).toMatch(/^pre-/);
  });

  it("file-safe-replaces commit chars in the on-disk snapshot path", async () => {
    await plantSkill("gamma", "g");
    const snap = await archiveSkillVersion("gamma", "../bad commit/!");
    expect(snap).not.toBeNull();
    // The stored commit string round-trips as-is for config integrity, but
    // the snapshot directory must use a sanitized name so the bad chars
    // can't escape the per-skill history root.
    const skillRoot = join(SNAPSHOT_ROOT, "gamma");
    const entries = await fs.readdir(skillRoot);
    expect(entries).toHaveLength(1);
    // No slashes ⇒ can't escape the per-skill root. (Dots are preserved by
    // the sanitizer but harmless inside a single segment.)
    expect(entries[0]).not.toContain("/");
    expect(entries[0]).not.toContain(" ");
  });

  it("overwrites a stale snapshot at the same commit (rare but possible after rollback)", async () => {
    await plantSkill("delta", "first");
    await archiveSkillVersion("delta", "same-sha");
    // Re-plant the live copy so we can archive again under the same commit.
    await plantSkill("delta", "second");
    const snap = await archiveSkillVersion("delta", "same-sha");
    expect(snap).not.toBeNull();
    const stored = await fs.readFile(
      join(SNAPSHOT_ROOT, "delta", "same-sha", "SKILL.md"),
      "utf8",
    );
    expect(stored).toBe("second");
  });
});

describe("pruneHistory", () => {
  it("keeps the N most recent and removes older snapshot directories", async () => {
    // Plant three snapshot dirs directly so we control timestamps.
    const make = async (commit: string) => {
      const dir = join(SNAPSHOT_ROOT, "kappa", commit);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(join(dir, "SKILL.md"), commit);
    };
    await make("oldest");
    await make("middle");
    await make("newest");
    const history = [
      { commit: "oldest", archived_at: "2025-01-01T00:00:00Z" },
      { commit: "middle", archived_at: "2025-02-01T00:00:00Z" },
      { commit: "newest", archived_at: "2025-03-01T00:00:00Z" },
    ];
    const kept = await pruneHistory("kappa", history, 2);
    expect(kept.map((s) => s.commit)).toEqual(["newest", "middle"]);
    await expect(
      fs.stat(join(SNAPSHOT_ROOT, "kappa", "oldest")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (await fs.stat(join(SNAPSHOT_ROOT, "kappa", "newest"))).isDirectory(),
    ).toBe(true);
  });

  it("returns an empty list when retain is 0 and removes every snapshot", async () => {
    await fs.mkdir(join(SNAPSHOT_ROOT, "lambda", "abc"), { recursive: true });
    const kept = await pruneHistory(
      "lambda",
      [{ commit: "abc", archived_at: "2025-01-01T00:00:00Z" }],
      0,
    );
    expect(kept).toEqual([]);
    await expect(
      fs.stat(join(SNAPSHOT_ROOT, "lambda", "abc")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("listHistory", () => {
  it("returns entries newest-first with size + existence info", async () => {
    const make = async (commit: string, body: string) => {
      const dir = join(SNAPSHOT_ROOT, "mu", commit);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(join(dir, "SKILL.md"), body);
    };
    await make("a", "a");
    await make("b", "bb");
    const list = await listHistory("mu", [
      { commit: "a", archived_at: "2025-01-01T00:00:00Z" },
      { commit: "b", archived_at: "2025-03-01T00:00:00Z" },
    ]);
    expect(list[0].commit).toBe("b");
    expect(list[1].commit).toBe("a");
    expect(list.every((e) => e.exists)).toBe(true);
    expect(list[1].sizeBytes).toBeGreaterThan(0);
  });

  it("flags missing snapshot dirs with exists:false and 0 bytes", async () => {
    const list = await listHistory("nu", [
      { commit: "missing", archived_at: "2025-01-01T00:00:00Z" },
    ]);
    expect(list[0].exists).toBe(false);
    expect(list[0].sizeBytes).toBe(0);
  });

  it("returns empty when given undefined or empty history", async () => {
    expect(await listHistory("none", undefined)).toEqual([]);
    expect(await listHistory("none", [])).toEqual([]);
  });
});

describe("restoreSnapshot", () => {
  it("replaces the live library copy with the snapshot's contents", async () => {
    // Plant a live copy and a snapshot to roll back to.
    await plantSkill("xi", "live");
    const snapDir = join(SNAPSHOT_ROOT, "xi", "older");
    await fs.mkdir(snapDir, { recursive: true });
    await fs.writeFile(join(snapDir, "SKILL.md"), "older");

    await restoreSnapshot("xi", "older");

    const restored = await fs.readFile(
      join(LIBRARY_PATH, "xi", "SKILL.md"),
      "utf8",
    );
    expect(restored).toBe("older");
  });

  it("throws a clear error when the snapshot directory is missing", async () => {
    await expect(restoreSnapshot("pi", "nope")).rejects.toThrow(
      /Snapshot not found/,
    );
  });
});

describe("clearHistory", () => {
  it("removes the entire skills-history/<name>/ tree", async () => {
    await fs.mkdir(join(SNAPSHOT_ROOT, "rho", "a"), { recursive: true });
    await fs.mkdir(join(SNAPSHOT_ROOT, "rho", "b"), { recursive: true });
    await clearHistory("rho");
    await expect(
      fs.stat(join(SNAPSHOT_ROOT, "rho")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("reconcileHistory", () => {
  it("removes per-skill folders that are no longer referenced", async () => {
    await fs.mkdir(join(SNAPSHOT_ROOT, "orphan", "abc"), { recursive: true });
    const result = await reconcileHistory(new Map());
    expect(result.removedDirs).toBe(1);
    await expect(
      fs.stat(join(SNAPSHOT_ROOT, "orphan")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes per-snapshot dirs that are not in the referenced set", async () => {
    await fs.mkdir(join(SNAPSHOT_ROOT, "sigma", "keep"), { recursive: true });
    await fs.mkdir(join(SNAPSHOT_ROOT, "sigma", "drop"), { recursive: true });
    const result = await reconcileHistory(
      new Map([["sigma", new Set(["keep"])]]),
    );
    expect(result.removedDirs).toBe(1);
    expect(
      (await fs.stat(join(SNAPSHOT_ROOT, "sigma", "keep"))).isDirectory(),
    ).toBe(true);
    await expect(
      fs.stat(join(SNAPSHOT_ROOT, "sigma", "drop")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns zeroed counts when there is no history dir at all", async () => {
    await fs.rm(SNAPSHOT_ROOT, { recursive: true, force: true });
    const result = await reconcileHistory(new Map());
    expect(result).toEqual({ removedDirs: 0, freedBytes: 0 });
  });
});

describe("totalHistorySize", () => {
  it("returns the cumulative byte count across every snapshot", async () => {
    const a = join(SNAPSHOT_ROOT, "tau", "a");
    const b = join(SNAPSHOT_ROOT, "tau", "b");
    await fs.mkdir(a, { recursive: true });
    await fs.mkdir(b, { recursive: true });
    await fs.writeFile(join(a, "SKILL.md"), "abc");
    await fs.writeFile(join(b, "SKILL.md"), "defgh");
    const total = await totalHistorySize();
    expect(total).toBe(8); // 3 + 5
  });

  it("returns 0 when the history tree is empty / missing", async () => {
    await fs.rm(SNAPSHOT_ROOT, { recursive: true, force: true });
    expect(await totalHistorySize()).toBe(0);
  });
});
