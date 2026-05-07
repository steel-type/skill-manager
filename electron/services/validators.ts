// IPC boundary validators. Each user-supplied string is checked here before
// it's allowed near the filesystem or git. Renderer is currently trusted but
// these double as defense-in-depth (a future XSS via SKILL.md description
// would otherwise let renderer code call into main with arbitrary args).

const URL_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
const SKILL_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;
const MAX_SKILL_NAME_LENGTH = 100;
const MAX_URL_LENGTH = 2048;
const MAX_PATH_LENGTH = 4096;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Accept only http(s) URLs. Rejects URLs starting with `--` (which would
 * otherwise be interpreted by git as flags), file://, javascript:, data:,
 * etc. Length-capped to avoid memory pathologies.
 */
export function validateUrl(url: unknown): string {
  if (typeof url !== "string") {
    throw new ValidationError("URL must be a string");
  }
  const trimmed = url.trim();
  if (trimmed.length === 0) throw new ValidationError("URL is empty");
  if (trimmed.length > MAX_URL_LENGTH) {
    throw new ValidationError(`URL too long (${trimmed.length} > ${MAX_URL_LENGTH})`);
  }
  if (!URL_REGEX.test(trimmed)) {
    throw new ValidationError(
      `URL must start with http:// or https:// — got "${trimmed.slice(0, 60)}"`,
    );
  }
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new ValidationError("URL contains control characters");
  }
  // git treats `--`-prefixed values as flags; reject defensively even though
  // the call sites also pass `--` as an argv separator.
  if (trimmed.startsWith("-")) {
    throw new ValidationError("URL cannot start with `-`");
  }
  return trimmed;
}

/**
 * Validate a skill directory name. Disallows path components, control chars,
 * and reserved names that would let a caller traverse out of the library.
 */
export function validateSkillName(name: unknown): string {
  if (typeof name !== "string") {
    throw new ValidationError("Skill name must be a string");
  }
  if (name.length === 0) throw new ValidationError("Skill name is empty");
  if (name.length > MAX_SKILL_NAME_LENGTH) {
    throw new ValidationError(
      `Skill name too long (${name.length} > ${MAX_SKILL_NAME_LENGTH})`,
    );
  }
  if (!SKILL_NAME_REGEX.test(name)) {
    throw new ValidationError(
      `Skill name must match [a-zA-Z0-9._-] — got "${name}"`,
    );
  }
  if (name === "." || name === "..") {
    throw new ValidationError(`Skill name "${name}" is reserved`);
  }
  if (name.startsWith(".")) {
    throw new ValidationError(
      "Skill name cannot start with a dot (reserved for hidden files)",
    );
  }
  return name;
}

/**
 * Validate a project path. Must be absolute, no nulls, length-capped.
 * We don't enforce existence here — that's a runtime concern handled at the
 * operation layer (graceful degradation if the path goes away).
 */
export function validateProjectPath(path: unknown): string {
  if (typeof path !== "string") {
    throw new ValidationError("Project path must be a string");
  }
  if (path.length === 0) throw new ValidationError("Project path is empty");
  if (path.length > MAX_PATH_LENGTH) {
    throw new ValidationError(`Project path too long`);
  }
  if (path.includes("\x00")) {
    throw new ValidationError("Project path contains null byte");
  }
  if (!path.startsWith("/")) {
    throw new ValidationError(`Project path must be absolute — got "${path}"`);
  }
  return path;
}

/**
 * Permissive name validator for commits/SHAs. Allows the same charset as
 * skill names, plus an empty fallback (which the caller will replace with a
 * timestamp).
 */
export function validateCommitToken(token: unknown): string {
  if (token === null || token === undefined) return "";
  if (typeof token !== "string") {
    throw new ValidationError("Commit token must be a string");
  }
  if (token.length === 0) return "";
  if (token.length > 200) throw new ValidationError("Commit token too long");
  if (!SKILL_NAME_REGEX.test(token)) {
    throw new ValidationError("Commit token has invalid characters");
  }
  return token;
}
