// Tiny structured logger. JSON-lines per event so a bug-report attachment
// is machine-readable; one file per UTC date; rotated by day naturally
// (no inline retention sweep — log volume is low, and the user can wipe
// older files from Settings → Logs → Reveal in Finder).
//
// No external deps. Writes are best-effort: a failed log write must never
// turn into a user-visible error or take down the IPC handler that fired
// it. We fall back to console silently.

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

function ymd(now = new Date()): string {
  // YYYY-MM-DD in UTC. ISO date avoids ambiguity across timezones in
  // attached log files.
  return now.toISOString().slice(0, 10);
}

let cachedLogDir: string | null = null;
function logsDir(): string {
  if (cachedLogDir) return cachedLogDir;
  try {
    cachedLogDir = join(app.getPath("userData"), "logs");
  } catch {
    // Pre-ready or in a non-Electron test runner — punt to a tmp dir.
    cachedLogDir = join(process.cwd(), ".logs");
  }
  return cachedLogDir;
}

let mkdirPromise: Promise<void> | null = null;
async function ensureLogsDir(): Promise<string> {
  const dir = logsDir();
  if (!mkdirPromise) {
    mkdirPromise = fs.mkdir(dir, { recursive: true }).then(
      () => undefined,
      () => undefined,
    );
  }
  await mkdirPromise;
  return dir;
}

export async function getLogsDir(): Promise<string> {
  return await ensureLogsDir();
}

async function writeLine(level: LogLevel, message: string, fields?: LogFields) {
  const ts = new Date().toISOString();
  const record = JSON.stringify({ ts, level, message, ...fields });
  try {
    const dir = await ensureLogsDir();
    const file = join(dir, `skillbase-${ymd()}.log`);
    await fs.appendFile(file, record + "\n", { encoding: "utf8", mode: 0o600 });
  } catch {
    // Last-resort fallback so we never lose a useful diagnostic.
    // eslint-disable-next-line no-console
    console.error("[logger] write failed:", record);
  }
  if (level === "error" || level === "warn") {
    // Also surface to the parent console so `npm start` shows it live.
    // eslint-disable-next-line no-console
    console[level === "error" ? "error" : "warn"](record);
  }
}

export function logDebug(message: string, fields?: LogFields): void {
  void writeLine("debug", message, fields);
}
export function logInfo(message: string, fields?: LogFields): void {
  void writeLine("info", message, fields);
}
export function logWarn(message: string, fields?: LogFields): void {
  void writeLine("warn", message, fields);
}
export function logError(message: string, fields?: LogFields): void {
  void writeLine("error", message, fields);
}

/** Convenience: log an error object and return its message so callers can
 *  re-throw with the same string they recorded. */
export function logException(scope: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logError(`${scope}: ${message}`, { scope, stack });
  return message;
}
