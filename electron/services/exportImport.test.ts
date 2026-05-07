import { describe, expect, it } from "vitest";
import { exportSkillList, parseSkillList } from "./exportImport";
import type { SkillManagerConfig } from "./types";

const baseConfig: SkillManagerConfig = {
  last_project: "",
  skills: {},
  settings: {
    auto_check_updates: false,
    cascade_updates: true,
    confirm_before_remove: true,
    show_resource_only: false,
    default_layout: "cards",
    update_history_retention: 2,
    theme: "light",
  } as const,
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

  it("round-trips: export → parse returns original URL-backed entries", () => {
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
