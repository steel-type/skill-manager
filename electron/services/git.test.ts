import { promises as fs } from "node:fs";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock LIBRARY_PATH onto a tmp tree so git.ts' final cp into the library
// lands somewhere disposable. Mock spawn so no real git process ever runs.
vi.mock("./paths", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const root = path.join(
    os.tmpdir(),
    `skill-manager-git-test-${process.pid}-${Date.now()}`,
  );
  return {
    CLAUDE_DIR: path.join(root, ".claude"),
    LIBRARY_PATH: path.join(root, ".claude", "skills"),
    CONFIG_PATH: path.join(root, ".claude", "skill-manager.json"),
  };
});

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  __args: string[];
  __opts: unknown;
}

const lastSpawn: { args: string[]; opts: unknown }[] = [];
type SpawnHandler = (child: FakeChild) => void;
const spawnHandlers: SpawnHandler[] = [];

function makeFakeChild(args: string[], opts: unknown): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.__args = args;
  child.__opts = opts;
  return child;
}

vi.mock("node:child_process", () => ({
  spawn: vi.fn((_cmd: string, args: string[], opts?: unknown) => {
    const child = makeFakeChild(args, opts);
    lastSpawn.push({ args, opts });
    // Defer to next tick so callers can attach their listeners first.
    const handler = spawnHandlers.shift();
    queueMicrotask(() => handler?.(child));
    return child;
  }),
}));

import { LIBRARY_PATH } from "./paths";
import { CancelledError, checkRemoteSha, cloneToLibrary } from "./git";

beforeEach(() => {
  lastSpawn.length = 0;
  spawnHandlers.length = 0;
});

afterEach(async () => {
  await fs.rm(LIBRARY_PATH, { recursive: true, force: true });
});

/** Plant a fake clone result on disk before triggering close(0) on git clone. */
async function plantTmpClone(args: string[], files: Record<string, string>) {
  // The clone path is the last positional arg. Skip flags starting with `-`
  // and the `--` separator; pick the LAST non-flag positional.
  const positional = args.filter((a) => !a.startsWith("-") && a !== "--");
  const target = positional[positional.length - 1];
  await fs.mkdir(target, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const path = `${target}/${rel}`;
    await fs.mkdir(path.split("/").slice(0, -1).join("/"), { recursive: true });
    await fs.writeFile(path, content);
  }
}

describe("cloneToLibrary", () => {
  it("invokes git clone with --depth 1 and the URL after a -- separator", async () => {
    spawnHandlers.push(async (child) => {
      // Plant a tmp clone so the post-clone copy step has something to pick up.
      await plantTmpClone(child.__args, { "SKILL.md": "hello" });
      child.emit("close", 0);
    });
    // Second spawn = git rev-parse --short HEAD; succeed with no SHA.
    spawnHandlers.push((child) => {
      child.emit("close", 1);
    });

    await cloneToLibrary("https://github.com/x/repo", "repo");

    const cloneCall = lastSpawn[0];
    expect(cloneCall.args).toContain("clone");
    expect(cloneCall.args).toContain("--depth");
    expect(cloneCall.args).toContain("1");
    expect(cloneCall.args).toContain("--");
    // The URL must come AFTER the -- separator so a malicious "--upload-pack"
    // URL can't be parsed as a git flag.
    const sepIdx = cloneCall.args.indexOf("--");
    const urlIdx = cloneCall.args.indexOf("https://github.com/x/repo");
    expect(urlIdx).toBeGreaterThan(sepIdx);
  });

  it("rejects when git clone exits with a non-zero code", async () => {
    spawnHandlers.push((child) => {
      child.stderr.emit("data", Buffer.from("fatal: repository not found\n"));
      child.emit("close", 128);
    });
    await expect(
      cloneToLibrary("https://github.com/x/missing", "missing"),
    ).rejects.toThrow(/repository not found|exited with code 128/i);
  });

  it("rejects with CancelledError when the AbortSignal aborts mid-clone", async () => {
    const controller = new AbortController();
    const killSpy = vi.fn();
    spawnHandlers.push((child) => {
      child.kill = killSpy;
      // Don't emit close — the abort path should kill it.
      controller.abort();
      // After kill, simulate the OS reporting child exit.
      setTimeout(() => child.emit("close", 143), 0);
    });
    await expect(
      cloneToLibrary("https://github.com/x/y", "y", {
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(CancelledError);
    expect(killSpy).toHaveBeenCalledWith("SIGTERM");
  });

  it("captures the short HEAD SHA via a follow-up rev-parse", async () => {
    spawnHandlers.push(async (child) => {
      await plantTmpClone(child.__args, { "SKILL.md": "x" });
      child.emit("close", 0);
    });
    spawnHandlers.push((child) => {
      child.stdout.emit("data", Buffer.from("abcdef0\n"));
      child.emit("close", 0);
    });
    const result = await cloneToLibrary("https://github.com/x/y", "y");
    expect(result.commit).toBe("abcdef0");
  });

  it("filters symbolic links out of the cloned tree", async () => {
    spawnHandlers.push(async (child) => {
      const args = child.__args;
      const positional = args.filter((a) => !a.startsWith("-") && a !== "--");
      const target = positional[positional.length - 1];
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(`${target}/SKILL.md`, "real");
      // Create a symlink — must NOT make it into the library copy.
      await fs.symlink("/etc/passwd", `${target}/dangerous-link`);
      child.emit("close", 0);
    });
    spawnHandlers.push((child) => child.emit("close", 1));

    await cloneToLibrary("https://github.com/x/sym", "sym");

    const dest = `${LIBRARY_PATH}/sym`;
    expect(
      (await fs.readFile(`${dest}/SKILL.md`, "utf8")),
    ).toBe("real");
    await expect(
      fs.lstat(`${dest}/dangerous-link`),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("checkRemoteSha", () => {
  it("returns the first 7 chars of the HEAD SHA on a successful ls-remote", async () => {
    spawnHandlers.push((child) => {
      child.stdout.emit(
        "data",
        Buffer.from("abcdef0123456789\tHEAD\n"),
      );
      child.emit("close", 0);
    });
    const sha = await checkRemoteSha("https://github.com/x/y");
    expect(sha).toBe("abcdef0");
  });

  it("returns null when ls-remote exits non-zero (and after the single retry)", async () => {
    // Two spawns expected: initial + 1 retry.
    spawnHandlers.push((child) => child.emit("close", 128));
    spawnHandlers.push((child) => child.emit("close", 128));
    const sha = await checkRemoteSha("https://github.com/x/y");
    expect(sha).toBeNull();
  });

  it("retries on the first failure and returns the SHA when retry succeeds", async () => {
    spawnHandlers.push((child) => child.emit("close", 128));
    spawnHandlers.push((child) => {
      child.stdout.emit("data", Buffer.from("1234567abcdef\tHEAD\n"));
      child.emit("close", 0);
    });
    const sha = await checkRemoteSha("https://github.com/x/y");
    expect(sha).toBe("1234567");
  });

  it("passes the URL after a -- separator (defense against flag-shaped URLs)", async () => {
    spawnHandlers.push((child) => {
      child.stdout.emit("data", Buffer.from("deadbee0\tHEAD\n"));
      child.emit("close", 0);
    });
    await checkRemoteSha("https://github.com/x/y");
    const args = lastSpawn[0].args;
    const sepIdx = args.indexOf("--");
    const urlIdx = args.indexOf("https://github.com/x/y");
    expect(sepIdx).toBeGreaterThan(-1);
    expect(urlIdx).toBeGreaterThan(sepIdx);
  });
});
