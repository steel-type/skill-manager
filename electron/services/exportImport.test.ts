import { describe, expect, it } from "vitest";
import {
  exportSkillJson,
  exportSkillList,
  parseFlexibleImport,
  parseSkillJson,
  parseSkillList,
} from "./exportImport";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SETUP,
  type SkillManagerConfig,
} from "./types";

const baseConfig: SkillManagerConfig = {
  last_project: "",
  skills: {},
  settings: { ...DEFAULT_SETTINGS },
  stacks: [],
  stackDeployments: [],
  setup: DEFAULT_SETUP,
};

describe("exportSkillList", () => {
  it("renders an empty library with the header", () => {
    const md = exportSkillList(baseConfig);
    expect(md).toContain("# My Claude Skills");
    expect(md).toMatch(/0 skills/);
  });

  it("renders URL-backed skills as markdown links", () => {
    const md = exportSkillList({
      ...baseConfig,
      skills: {
        "pdf-tools": {
          url: "https://github.com/anthropic/pdf-tools",
          commit: null,
          installed_at: "",
          updated_at: null,
          projects: [],
        },
      },
    });
    expect(md).toContain(
      "- [pdf-tools](https://github.com/anthropic/pdf-tools)",
    );
  });

  it("marks local skills with the *(local)* suffix", () => {
    const md = exportSkillList({
      ...baseConfig,
      skills: {
        "my-local": {
          url: null,
          commit: null,
          installed_at: "",
          updated_at: null,
          projects: [],
        },
      },
    });
    expect(md).toContain("- my-local *(local)*");
  });

  it("sorts skills alphabetically", () => {
    const md = exportSkillList({
      ...baseConfig,
      skills: {
        zebra: {
          url: "https://example.com/z",
          commit: null,
          installed_at: "",
          updated_at: null,
          projects: [],
        },
        alpha: {
          url: "https://example.com/a",
          commit: null,
          installed_at: "",
          updated_at: null,
          projects: [],
        },
      },
    });
    expect(md.indexOf("alpha")).toBeLessThan(md.indexOf("zebra"));
  });

  it("uses singular 'skill' for one entry", () => {
    const md = exportSkillList({
      ...baseConfig,
      skills: {
        only: {
          url: null,
          commit: null,
          installed_at: "",
          updated_at: null,
          projects: [],
        },
      },
    });
    expect(md).toMatch(/1 skill\b/);
    expect(md).not.toMatch(/1 skills/);
  });
});

describe("parseSkillList", () => {
  it("extracts a single markdown link", () => {
    const result = parseSkillList(
      "- [pdf-tools](https://github.com/anthropic/pdf-tools)",
    );
    expect(result).toEqual([
      { name: "pdf-tools", url: "https://github.com/anthropic/pdf-tools" },
    ]);
  });

  it("extracts multiple markdown links from a list", () => {
    const md = `# My Skills

- [a](https://example.com/a)
- [b](https://example.com/b)
- [c](https://example.com/c)
`;
    const result = parseSkillList(md);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ name: "a", url: "https://example.com/a" });
    expect(result[2]).toEqual({ name: "c", url: "https://example.com/c" });
  });

  it("skips local skills (no URL form)", () => {
    const md = `- [a](https://example.com/a)\n- b *(local)*`;
    const result = parseSkillList(md);
    expect(result).toEqual([
      { name: "a", url: "https://example.com/a" },
    ]);
  });

  it("handles an empty body", () => {
    expect(parseSkillList("")).toEqual([]);
  });

  it("handles bodies without any links", () => {
    expect(parseSkillList("just some text\nno links here")).toEqual([]);
  });

  it("trims whitespace inside the link text and URL", () => {
    expect(
      parseSkillList("- [  a  ](  https://example.com/a  )"),
    ).toEqual([{ name: "a", url: "https://example.com/a" }]);
  });

  it("round-trips: export → parse returns original URL-backed entries (markdown)", () => {
    const config: SkillManagerConfig = {
      ...baseConfig,
      skills: {
        a: {
          url: "https://example.com/a",
          commit: null,
          installed_at: "",
          updated_at: null,
          projects: [],
        },
        b: {
          url: "https://example.com/b",
          commit: null,
          installed_at: "",
          updated_at: null,
          projects: [],
        },
      },
    };
    const md = exportSkillList(config);
    const parsed = parseSkillList(md);
    expect(parsed.map((p) => p.name).sort()).toEqual(["a", "b"]);
  });
});

describe("exportSkillJson", () => {
  it("emits version 1 with sorted URL-backed entries", () => {
    const doc = exportSkillJson({
      ...baseConfig,
      skills: {
        zebra: {
          url: "https://example.com/z",
          commit: "z123abc",
          installed_at: "",
          updated_at: null,
          projects: [],
        },
        alpha: {
          url: "https://example.com/a",
          commit: "a123abc",
          installed_at: "",
          updated_at: null,
          projects: [],
        },
        // Local-only entry — must be skipped, not exported as null URL.
        local: {
          url: null,
          commit: null,
          installed_at: "",
          updated_at: null,
          projects: [],
        },
      },
    });
    expect(doc.version).toBe(1);
    expect(doc.skills.map((s) => s.name)).toEqual(["alpha", "zebra"]);
    expect(doc.skills[0]).toMatchObject({
      name: "alpha",
      url: "https://example.com/a",
      commit: "a123abc",
    });
  });

  it("includes description when the on-disk Skill provides one", () => {
    const doc = exportSkillJson(
      {
        ...baseConfig,
        skills: {
          a: {
            url: "https://example.com/a",
            commit: null,
            installed_at: "",
            updated_at: null,
            projects: [],
          },
        },
      },
      [
        {
          name: "a",
          displayName: "a",
          description: "useful skill",
          url: "https://example.com/a",
          commit: null,
          installedAt: "",
          updatedAt: null,
          projects: [],
          isSkill: true,
          isBundle: false,
          bundleSize: 0,
          identifiers: [],
          contentDirs: [],
          isLocal: false,
          historyCount: 0,
          nestedSkills: [],
        },
      ],
    );
    expect(doc.skills[0].description).toBe("useful skill");
  });
});

describe("parseSkillJson", () => {
  it("parses a v1 document", () => {
    const text = JSON.stringify({
      version: 1,
      exported_at: "2026-01-01",
      skills: [
        { name: "a", url: "https://example.com/a", commit: "abc" },
        { name: "b", url: "https://example.com/b" },
      ],
    });
    const entries = parseSkillJson(text);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      name: "a",
      url: "https://example.com/a",
      commit: "abc",
    });
  });

  it("accepts a bare array (hand-edited share)", () => {
    const text = JSON.stringify([
      { name: "a", url: "https://example.com/a" },
    ]);
    const entries = parseSkillJson(text);
    expect(entries).toEqual([{ name: "a", url: "https://example.com/a" }]);
  });

  it("skips entries without name or url", () => {
    const text = JSON.stringify({
      skills: [
        { name: "ok", url: "https://example.com/a" },
        { name: "", url: "https://example.com/b" },
        { name: "missing-url" },
        null,
        "garbage",
      ],
    });
    expect(parseSkillJson(text)).toEqual([
      { name: "ok", url: "https://example.com/a" },
    ]);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseSkillJson("not json {{")).toThrow(/valid JSON/);
  });

  it("rejects an object without a skills array", () => {
    expect(() => parseSkillJson(JSON.stringify({ foo: "bar" }))).toThrow(
      /'skills'/,
    );
  });

  it("round-trips with exportSkillJson", () => {
    const doc = exportSkillJson({
      ...baseConfig,
      skills: {
        a: {
          url: "https://example.com/a",
          commit: "abc",
          installed_at: "",
          updated_at: null,
          projects: [],
        },
      },
    });
    const parsed = parseSkillJson(JSON.stringify(doc));
    expect(parsed).toEqual([
      { name: "a", url: "https://example.com/a", commit: "abc" },
    ]);
  });
});

describe("parseFlexibleImport", () => {
  it("parses the native v1 export format", () => {
    const result = parseFlexibleImport(
      JSON.stringify({
        version: 1,
        exported_at: "2025-01-01T00:00:00Z",
        skills: [
          { name: "alpha", url: "https://github.com/x/alpha" },
          { name: "beta", url: "https://github.com/x/beta", commit: "abc" },
        ],
      }),
    );
    expect(result.detectedFormat).toBe("native");
    expect(result.skills).toHaveLength(2);
    expect(result.skills[1].commit).toBe("abc");
    expect(result.skipped).toBe(0);
  });

  it("parses the legacy { installed_skills: [...] } app config/preset", () => {
    // The original Python app stored skills under `installed_skills`. Loading
    // such a preset used to throw "Unrecognised JSON shape".
    const result = parseFlexibleImport(
      JSON.stringify({
        installed_skills: [
          { name: "alpha", url: "https://github.com/x/alpha" },
          { name: "beta", url: "https://github.com/x/beta" },
        ],
      }),
    );
    expect(result.detectedFormat).toBe("skills-array");
    expect(result.skills).toHaveLength(2);
    expect(result.skills[0].url).toBe("https://github.com/x/alpha");
  });

  it("parses a bare array of {name, url} entries", () => {
    const result = parseFlexibleImport(
      JSON.stringify([
        { name: "alpha", url: "https://github.com/x/alpha" },
        { name: "beta", url: "https://github.com/x/beta" },
      ]),
    );
    expect(result.detectedFormat).toBe("bare-array");
    expect(result.skills).toHaveLength(2);
  });

  it("parses the codex skill config shape and treats paths as local refs", () => {
    const result = parseFlexibleImport(
      JSON.stringify({
        skills: {
          config: [
            { path: "/Users/me/skills/pdf-tools", enabled: true },
            { path: "/Users/me/skills/docs", enabled: false },
          ],
        },
      }),
    );
    expect(result.detectedFormat).toBe("codex-config");
    expect(result.skills).toEqual([
      {
        name: "pdf-tools",
        url: null,
        localPath: "/Users/me/skills/pdf-tools",
        enabled: true,
      },
      {
        name: "docs",
        url: null,
        localPath: "/Users/me/skills/docs",
        enabled: false,
      },
    ]);
  });

  it("parses an object whose values are URL strings into skill entries keyed by name", () => {
    const result = parseFlexibleImport(
      JSON.stringify({
        "pdf-tools": "https://github.com/anthropic/pdf-tools",
        "docx-helper": "https://github.com/x/docx-helper",
      }),
    );
    expect(result.detectedFormat).toBe("url-map");
    expect(result.skills).toHaveLength(2);
    expect(result.skills.find((s) => s.name === "pdf-tools")?.url).toBe(
      "https://github.com/anthropic/pdf-tools",
    );
  });

  it("parses a nested skills array preserving description / agent / tags", () => {
    const result = parseFlexibleImport(
      JSON.stringify({
        skills: [
          {
            name: "alpha",
            url: "https://github.com/x/alpha",
            description: "alpha doc",
            agent: "claude",
            tags: ["a", "b"],
          },
        ],
      }),
    );
    expect(result.detectedFormat).toBe("skills-array");
    expect(result.skills[0]).toMatchObject({
      name: "alpha",
      url: "https://github.com/x/alpha",
      description: "alpha doc",
      agent: "claude",
      tags: ["a", "b"],
    });
  });

  it("parses line-delimited URLs when input is not valid JSON", () => {
    const result = parseFlexibleImport(
      [
        "https://github.com/x/alpha",
        "https://github.com/x/beta.git",
        "",
        "https://github.com/x/gamma",
      ].join("\n"),
    );
    expect(result.detectedFormat).toBe("url-lines");
    expect(result.skills.map((s) => s.name)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(result.skipped).toBe(0);
  });

  it("counts non-URL lines as skipped when mixed with valid URLs", () => {
    const result = parseFlexibleImport(
      [
        "https://github.com/x/alpha",
        "this is a note",
        "another line that is not a url",
        "https://github.com/x/beta",
      ].join("\n"),
    );
    expect(result.detectedFormat).toBe("url-lines");
    expect(result.skills).toHaveLength(2);
    expect(result.skipped).toBe(2);
  });

  it("throws on empty input rather than silently returning an empty list", () => {
    expect(() => parseFlexibleImport("")).toThrow(/Empty input/);
    expect(() => parseFlexibleImport("   \n\n")).toThrow(/Empty input/);
  });

  it("throws on JSON that doesn't match any recognised shape", () => {
    expect(() => parseFlexibleImport(JSON.stringify({ random: "thing" }))).toThrow(
      /Unrecognised JSON shape/,
    );
  });

  it("throws on plain text with zero detectable URLs", () => {
    expect(() => parseFlexibleImport("hello\nworld\n")).toThrow(
      /No GitHub URLs detected/,
    );
  });

  it("error messages list every supported format", () => {
    try {
      parseFlexibleImport("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toContain("native");
      expect(msg).toContain("codex");
      expect(msg).toContain("url");
      expect(msg).toContain("plain text");
    }
  });

  it("counts entries missing a url as skipped in the skills-array format", () => {
    const result = parseFlexibleImport(
      JSON.stringify({
        skills: [
          { name: "alpha", url: "https://github.com/x/alpha" },
          { name: "noUrl" }, // missing required url
          { url: "https://github.com/x/anon" }, // missing required name
        ],
      }),
    );
    expect(result.skills).toHaveLength(1);
    expect(result.skipped).toBe(2);
  });
});
