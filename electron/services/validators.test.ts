import { describe, expect, it } from "vitest";
import {
  ValidationError,
  validateCommitToken,
  validateProjectPath,
  validateSkillName,
  validateStackName,
  validateUrl,
} from "./validators";

describe("validateUrl", () => {
  it("accepts a normal https GitHub URL", () => {
    expect(validateUrl("https://github.com/anthropic/skills")).toBe(
      "https://github.com/anthropic/skills",
    );
  });

  it("rejects http:// URLs (plaintext clone allows MITM rewrite)", () => {
    expect(() => validateUrl("http://example.com/repo.git")).toThrow(
      ValidationError,
    );
  });

  it("trims whitespace", () => {
    expect(validateUrl("  https://github.com/foo/bar  ")).toBe(
      "https://github.com/foo/bar",
    );
  });

  it("rejects URLs that start with `-` (git-flag injection)", () => {
    expect(() => validateUrl("--upload-pack=evil-cmd")).toThrow(ValidationError);
    expect(() => validateUrl("-x")).toThrow(ValidationError);
  });

  it("rejects URLs that start with `--`", () => {
    expect(() =>
      validateUrl("--upload-pack=/usr/bin/touch /tmp/pwned"),
    ).toThrow(ValidationError);
  });

  it("rejects file://", () => {
    expect(() => validateUrl("file:///etc/passwd")).toThrow(ValidationError);
  });

  it("rejects javascript:", () => {
    expect(() => validateUrl("javascript:alert(1)")).toThrow(ValidationError);
  });

  it("rejects data:", () => {
    expect(() => validateUrl("data:text/html,<script>")).toThrow(ValidationError);
  });

  it("rejects ssh:// and git://", () => {
    expect(() => validateUrl("ssh://git@github.com/foo/bar")).toThrow(
      ValidationError,
    );
    expect(() => validateUrl("git://github.com/foo/bar")).toThrow(ValidationError);
  });

  it("rejects empty string", () => {
    expect(() => validateUrl("")).toThrow(/empty/);
  });

  it("rejects whitespace-only", () => {
    expect(() => validateUrl("   ")).toThrow(/empty/);
  });

  it("rejects non-string types", () => {
    expect(() => validateUrl(123 as unknown)).toThrow(/string/);
    expect(() => validateUrl(null)).toThrow(/string/);
    expect(() => validateUrl(undefined)).toThrow(/string/);
    expect(() => validateUrl({ url: "x" } as unknown)).toThrow(/string/);
  });

  it("rejects URLs with control characters", () => {
    expect(() => validateUrl("https://github.com/foo\x00bar")).toThrow(
      ValidationError,
    );
    expect(() => validateUrl("https://github.com/foo\rbar")).toThrow(
      ValidationError,
    );
  });

  it("rejects URLs over 2048 chars", () => {
    const huge = "https://example.com/" + "a".repeat(2050);
    expect(() => validateUrl(huge)).toThrow(/too long/);
  });
});

describe("validateSkillName", () => {
  it("accepts simple kebab-case", () => {
    expect(validateSkillName("pdf-tools")).toBe("pdf-tools");
  });

  it("accepts dotted names", () => {
    expect(validateSkillName("my.skill")).toBe("my.skill");
  });

  it("accepts underscores and digits", () => {
    expect(validateSkillName("skill_v2")).toBe("skill_v2");
  });

  it("rejects names with `..`", () => {
    expect(() => validateSkillName("..")).toThrow(/reserved/);
  });

  it("rejects bare `.`", () => {
    expect(() => validateSkillName(".")).toThrow(/reserved/);
  });

  it("rejects path components with `/`", () => {
    expect(() => validateSkillName("foo/bar")).toThrow(ValidationError);
  });

  it("rejects path traversal attempts", () => {
    expect(() => validateSkillName("../etc/passwd")).toThrow(ValidationError);
  });

  it("rejects leading dot (would be a hidden file)", () => {
    expect(() => validateSkillName(".hidden")).toThrow(/dot/);
  });

  it("rejects null bytes", () => {
    expect(() => validateSkillName("foo\x00bar")).toThrow(ValidationError);
  });

  it("rejects spaces", () => {
    expect(() => validateSkillName("hello world")).toThrow(ValidationError);
  });

  it("rejects empty string", () => {
    expect(() => validateSkillName("")).toThrow(/empty/);
  });

  it("rejects names over 100 chars", () => {
    expect(() => validateSkillName("a".repeat(101))).toThrow(/too long/);
  });

  it("accepts exactly 100 chars", () => {
    const name = "a".repeat(100);
    expect(validateSkillName(name)).toBe(name);
  });
});

describe("validateStackName", () => {
  it("accepts simple kebab-case", () => {
    expect(validateStackName("my-stack")).toBe("my-stack");
  });

  it("accepts a single lowercase letter", () => {
    expect(validateStackName("a")).toBe("a");
  });

  it("accepts a single digit", () => {
    expect(validateStackName("9")).toBe("9");
  });

  it("accepts digits anywhere", () => {
    expect(validateStackName("v2-tools")).toBe("v2-tools");
  });

  it("accepts exactly 64 chars", () => {
    const id = "a".repeat(64);
    expect(validateStackName(id)).toBe(id);
  });

  it("rejects uppercase letters", () => {
    expect(() => validateStackName("My-Stack")).toThrow(ValidationError);
    expect(() => validateStackName("MYSTACK")).toThrow(ValidationError);
  });

  it("rejects underscores (allowed for skills, not stacks)", () => {
    expect(() => validateStackName("my_stack")).toThrow(ValidationError);
  });

  it("rejects dots (allowed for skills, not stacks)", () => {
    expect(() => validateStackName("my.stack")).toThrow(ValidationError);
  });

  it("rejects leading hyphens", () => {
    expect(() => validateStackName("-stack")).toThrow(ValidationError);
  });

  it("rejects trailing hyphens", () => {
    expect(() => validateStackName("stack-")).toThrow(ValidationError);
  });

  it("rejects consecutive hyphens", () => {
    expect(() => validateStackName("a--b")).toThrow(ValidationError);
    expect(() => validateStackName("foo---bar")).toThrow(ValidationError);
  });

  it("rejects spaces", () => {
    expect(() => validateStackName("my stack")).toThrow(ValidationError);
  });

  it("rejects path components", () => {
    expect(() => validateStackName("foo/bar")).toThrow(ValidationError);
    expect(() => validateStackName("../etc")).toThrow(ValidationError);
  });

  it("rejects empty string", () => {
    expect(() => validateStackName("")).toThrow(/empty/);
  });

  it("rejects names over 64 chars", () => {
    expect(() => validateStackName("a".repeat(65))).toThrow(/too long/);
  });

  it("rejects non-string types", () => {
    expect(() => validateStackName(42 as unknown)).toThrow(/string/);
    expect(() => validateStackName(null)).toThrow(/string/);
  });
});

describe("validateProjectPath", () => {
  it("accepts an absolute Unix path", () => {
    expect(validateProjectPath("/Users/me/code/myapp")).toBe(
      "/Users/me/code/myapp",
    );
  });

  it("rejects a relative path", () => {
    expect(() => validateProjectPath("myapp")).toThrow(/absolute/);
    expect(() => validateProjectPath("./myapp")).toThrow(/absolute/);
    expect(() => validateProjectPath("../parent")).toThrow(/absolute/);
  });

  it("rejects null bytes", () => {
    expect(() => validateProjectPath("/foo\x00bar")).toThrow(/null byte/);
  });

  it("rejects empty string", () => {
    expect(() => validateProjectPath("")).toThrow(/empty/);
  });

  it("rejects non-string types", () => {
    expect(() => validateProjectPath(42 as unknown)).toThrow(/string/);
  });
});

describe("validateCommitToken", () => {
  it("accepts a 7-char SHA", () => {
    expect(validateCommitToken("abc1234")).toBe("abc1234");
  });

  it("accepts a 40-char full SHA", () => {
    const sha = "a".repeat(40);
    expect(validateCommitToken(sha)).toBe(sha);
  });

  it("accepts the pre-<timestamp> fallback we generate", () => {
    expect(validateCommitToken("pre-2026-05-06T14-30-00")).toBe(
      "pre-2026-05-06T14-30-00",
    );
  });

  it("treats null/undefined/empty as empty", () => {
    expect(validateCommitToken(null)).toBe("");
    expect(validateCommitToken(undefined)).toBe("");
    expect(validateCommitToken("")).toBe("");
  });

  it("rejects path components", () => {
    expect(() => validateCommitToken("../../etc/passwd")).toThrow(
      ValidationError,
    );
  });

  it("rejects shell metacharacters", () => {
    expect(() => validateCommitToken("abc;rm")).toThrow(ValidationError);
    expect(() => validateCommitToken("abc`whoami`")).toThrow(ValidationError);
  });
});
