// Variation D — power-user ⌘K interface. Real command parsing now:
//
//   install <url>                  → clone & open InstallFlow
//   deploy <skill>                 → open DeployFlow for that skill
//   deploy <skill> to <project>    → run the deploy directly
//   update --all                   → check + open UpdateFlow
//   update <skill>                 → open UpdateFlow pre-filled
//   list <filter>                  → set the FilterRail filter (cards mode)
//   rm <skill> | remove <skill>    → open RemoveSkillFlow
//   rollback <skill>               → open RollbackFlow
//   browse <skill> | open <skill>  → reveal the library folder in Finder
//   check                          → run the remote update check
//   help                           → show every command in the suggestions
//
// Suggestions are context-aware: typing `deploy ` lists skills, typing
// `deploy frontend ` lists tracked projects + an "open picker" fallback.
// ↑↓ moves the selection, ⏎ / Tab triggers it (fills the input for
// multi-step commands; runs immediately for terminal commands).
//
// Skills below the suggestions also filter live by the raw query so users
// see what their input is matching even mid-command.

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../state/store";
import type {
  Skill,
  TrackedProject,
  UpdateInfo,
} from "../../electron/services/types";

interface CommandPaletteProps {
  skills: Skill[];
  updateInfo: Record<string, UpdateInfo>;
  /** Called after a suggestion's `run` resolves successfully. The global
   *  CommandOverlay uses this to dismiss itself once a command lands; the
   *  in-Library palette layout passes nothing (it stays open). */
  onCommandRun?: () => void;
  /** Optional placeholder override — the overlay shows a different hint
   *  than the in-Library palette. */
  placeholder?: string;
}

interface Suggestion {
  display: string;
  detail?: string;
  /** Fills the input with this value. Used for multi-step commands. */
  fill?: string;
  /** Runs immediately. Used for terminal commands. */
  run?: () => void | Promise<void>;
}

const RECOGNISED_VERBS = new Set([
  "install",
  "deploy",
  "update",
  "list",
  "rm",
  "remove",
  "rollback",
  "browse",
  "open",
  "check",
  "help",
]);

const FILTER_KEYS = ["all", "updates", "bundles", "local", "deployed"] as const;

function tildify(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~");
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  // Append Z if the stamp lacks a timezone marker — older config entries
  // and the previous nowIso() output stripped the Z, which JavaScript then
  // parses as local time and misreads UTC stamps.
  const safe = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const then = new Date(safe).getTime();
  if (isNaN(then)) return "—";
  const diff = Date.now() - then;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function CommandPalette({
  skills,
  updateInfo,
  onCommandRun,
  placeholder,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const projects = useAppStore((s) => s.projects);
  const openModal = useAppStore((s) => s.openModal);
  const setScreen = useAppStore((s) => s.setScreen);
  const setFilter = useAppStore((s) => s.setFilter);
  const setLibraryLayout = useAppStore((s) => s.setLibraryLayout);
  const runUpdateCheck = useAppStore((s) => s.runUpdateCheck);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const setStoreError = useAppStore((s) => s.setError);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset selection any time the input changes (suggestion list shifts).
  useEffect(() => {
    setSelectedIdx(0);
    setError(null);
  }, [query]);

  const suggestions: Suggestion[] = useMemo(
    () =>
      buildSuggestions({
        input: query,
        skills,
        projects,
        updateInfo,
        actions: {
          openModal,
          setScreen,
          setFilter,
          setLibraryLayout,
          runUpdateCheck,
          refreshSkills,
          refreshProjects,
          setStoreError,
          setQuery,
          setError,
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, skills, projects, updateInfo],
  );

  const visibleIdx = Math.min(selectedIdx, Math.max(0, suggestions.length - 1));

  // Library list is always filtered by the raw query so users see what
  // their typing is matching, regardless of whether they've started a
  // verb yet.
  const libraryMatches = useMemo(
    () => filterSkillsByQuery(skills, query),
    [skills, query],
  );

  const trigger = (s: Suggestion | undefined) => {
    if (!s) return;
    if (s.run) {
      Promise.resolve(s.run())
        .then(() => onCommandRun?.())
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
        });
    } else if (s.fill !== undefined) {
      setQuery(s.fill);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        const len = s.fill?.length ?? 0;
        inputRef.current?.setSelectionRange(len, len);
      });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      trigger(suggestions[visibleIdx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        flex: 1,
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          border: "1.5px solid var(--line)",
          borderRadius: 6,
          background: "var(--paper-2)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 13,
            color: "var(--accent)",
          }}
        >
          ›
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            placeholder ?? 'search or type a command — "help" for the list'
          }
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: "var(--mono)",
            fontSize: 13,
            color: "var(--ink)",
          }}
        />
        <span className="sk-tag mono">⏎ run</span>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            fontSize: 11,
            color: "var(--warn)",
            padding: "0 4px",
            fontFamily: "var(--mono)",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--mono)",
          color: "var(--ink-faint)",
          textTransform: "uppercase",
          padding: "4px 4px 0",
        }}
      >
        Suggestions · {suggestions.length}
      </div>
      <div
        ref={listRef}
        className="sk-box"
        style={{
          padding: 0,
          overflow: "auto",
          flexShrink: 0,
          maxHeight: 220,
        }}
      >
        {suggestions.length === 0 && (
          <div
            style={{
              padding: 12,
              fontSize: 11,
              color: "var(--ink-faint)",
              fontStyle: "italic",
            }}
          >
            no matches — try{" "}
            <span style={{ fontFamily: "var(--mono)" }}>help</span>
          </div>
        )}
        {suggestions.map((s, i) => {
          const active = i === visibleIdx;
          return (
            <button
              key={`${s.display}-${i}`}
              type="button"
              onClick={() => trigger(s)}
              onMouseEnter={() => setSelectedIdx(i)}
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                textAlign: "left",
                padding: "6px 12px",
                borderBottom:
                  i < suggestions.length - 1
                    ? "1px dashed var(--line-soft)"
                    : "none",
                background: active ? "var(--card-selected-bg)" : "transparent",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  flex: 1,
                  color: active ? "var(--ink)" : "var(--ink-soft)",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {s.display}
              </div>
              {s.detail && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--ink-faint)",
                    paddingLeft: 12,
                  }}
                >
                  {s.detail}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--mono)",
          color: "var(--ink-faint)",
          textTransform: "uppercase",
          padding: "4px 4px 0",
        }}
      >
        Library · {libraryMatches.length}
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          fontFamily: "var(--mono)",
          fontSize: 11,
          lineHeight: 1.7,
          color: "var(--ink-soft)",
          minHeight: 0,
        }}
      >
        {libraryMatches.map((skill) => {
          const info = updateInfo[skill.name];
          const tag = info?.hasUpdate
            ? { label: "UPDATE", color: "var(--accent)" }
            : skill.isBundle
              ? { label: "bundle", color: "var(--ink-faint)" }
              : skill.isLocal
                ? { label: "local", color: "var(--ink-faint)" }
                : {
                    label: formatRelative(skill.updatedAt ?? skill.installedAt),
                    color: "var(--ink-faint)",
                  };
          const trail = skill.isBundle
            ? `${skill.bundleSize} inside`
            : skill.projects.length === 0
              ? "—"
              : `${skill.projects.length} deploy${skill.projects.length === 1 ? "" : "s"}`;
          return (
            <div
              key={skill.name}
              style={{ display: "flex", gap: 12, padding: "1px 4px" }}
            >
              <span
                style={{
                  flex: "0 0 22ch",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--ink)",
                }}
              >
                {skill.name}
              </span>
              <span style={{ flex: "0 0 8ch", color: tag.color }}>
                {tag.label}
              </span>
              <span style={{ flex: 1 }}>{trail}</span>
            </div>
          );
        })}
        {libraryMatches.length === 0 && (
          <div
            style={{
              padding: 16,
              color: "var(--ink-faint)",
              fontStyle: "italic",
            }}
          >
            No matches.
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          fontSize: 10,
          fontFamily: "var(--mono)",
          color: "var(--ink-faint)",
          borderTop: "1px solid var(--line-soft)",
          paddingTop: 6,
        }}
      >
        <span>↑↓ navigate</span>
        <span>⏎ run / fill</span>
        <span>tab autocomplete</span>
        <span>esc clear</span>
      </div>
    </div>
  );
}

// ── Suggestion engine ────────────────────────────────────────────────────

interface BuildArgs {
  input: string;
  skills: Skill[];
  projects: TrackedProject[];
  updateInfo: Record<string, UpdateInfo>;
  actions: {
    openModal: ReturnType<typeof useAppStore.getState>["openModal"];
    setScreen: ReturnType<typeof useAppStore.getState>["setScreen"];
    setFilter: ReturnType<typeof useAppStore.getState>["setFilter"];
    setLibraryLayout: ReturnType<typeof useAppStore.getState>["setLibraryLayout"];
    runUpdateCheck: ReturnType<typeof useAppStore.getState>["runUpdateCheck"];
    refreshSkills: ReturnType<typeof useAppStore.getState>["refreshSkills"];
    refreshProjects: ReturnType<typeof useAppStore.getState>["refreshProjects"];
    setStoreError: ReturnType<typeof useAppStore.getState>["setError"];
    setQuery: (s: string) => void;
    setError: (s: string | null) => void;
  };
}

function filterSkillsByQuery(skills: Skill[], query: string): Skill[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  // Strip a leading verb so "deploy frontend" still surfaces frontend-design
  const stripped = q.replace(
    /^(install|deploy|update|list|rm|remove|rollback|browse|open|check|help)\s*/,
    "",
  );
  const needle = stripped || q;
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(needle) ||
      s.displayName.toLowerCase().includes(needle) ||
      s.description.toLowerCase().includes(needle),
  );
}

function getAllCommands(actions: BuildArgs["actions"]): Suggestion[] {
  return [
    {
      display: "install <url>",
      detail: "clone a GitHub repo into your library",
      fill: "install ",
    },
    {
      display: "deploy <skill>",
      detail: "deploy a skill to a project",
      fill: "deploy ",
    },
    {
      display: "update <skill> | --all",
      detail: "pull updates and cascade to deployments",
      fill: "update ",
    },
    {
      display: "list <filter>",
      detail: "filter library: --all / --updates / --bundles / --local / --deployed",
      fill: "list ",
    },
    {
      display: "rm <skill>",
      detail: "remove a skill from the library",
      fill: "rm ",
    },
    {
      display: "rollback <skill>",
      detail: "restore a previous snapshot",
      fill: "rollback ",
    },
    {
      display: "browse <skill>",
      detail: "open the skill folder in Finder",
      fill: "browse ",
    },
    {
      display: "check",
      detail: "git ls-remote across every URL-backed skill",
      run: () => actions.runUpdateCheck(),
    },
    { display: "help", detail: "show this list", fill: "help" },
  ];
}

function tokenize(input: string): { tokens: string[]; trailingSpace: boolean } {
  const trimmedLeft = input.replace(/^\s+/, "");
  if (trimmedLeft === "") return { tokens: [], trailingSpace: false };
  const trailingSpace = /\s$/.test(input);
  const tokens = trimmedLeft.trim().split(/\s+/);
  return { tokens, trailingSpace };
}

function findSkill(skills: Skill[], name: string): Skill | undefined {
  return skills.find(
    (s) => s.name === name || s.displayName.toLowerCase() === name.toLowerCase(),
  );
}

function buildSuggestions(args: BuildArgs): Suggestion[] {
  const { input, skills, projects, updateInfo, actions } = args;
  const { tokens, trailingSpace } = tokenize(input);

  // Empty input → starter commands.
  if (tokens.length === 0) return getAllCommands(actions);

  const verb = tokens[0].toLowerCase();

  // Unknown verb → fall back to fuzzy command match (so typing "ins"
  // still surfaces "install"). If nothing matches, return [].
  if (!RECOGNISED_VERBS.has(verb)) {
    const all = getAllCommands(actions);
    const lc = verb.toLowerCase();
    const matched = all.filter((c) =>
      c.display.toLowerCase().includes(lc),
    );
    if (matched.length > 0) return matched;
    // Otherwise: show skill matches as inline actionable suggestions
    // (deploy / browse the matching skill).
    const filtered = filterSkillsByQuery(skills, input).slice(0, 6);
    return filtered.flatMap((s) => [
      {
        display: `deploy ${s.name}`,
        detail: "open the deploy picker",
        run: () =>
          actions.openModal({ type: "deploy", skill: s.name }),
      },
      {
        display: `browse ${s.name}`,
        detail: "open in Finder",
        run: () => browseSkill(s.name),
      },
    ]);
  }

  if (verb === "help") return getAllCommands(actions);

  if (verb === "check") {
    return [
      {
        display: "check",
        detail: "git ls-remote for every URL-backed skill",
        run: () => actions.runUpdateCheck(),
      },
    ];
  }

  if (verb === "install") {
    const partial = tokens[1] ?? "";
    if (!partial && trailingSpace === false) {
      return [
        {
          display: "install <url>",
          detail: "type a https:// URL",
          fill: "install ",
        },
      ];
    }
    if (partial && /^https?:\/\//.test(partial)) {
      return [
        {
          display: `install ${partial}`,
          detail: "open the install modal with this URL",
          run: () =>
            actions.openModal({ type: "install", prefillUrl: partial }),
        },
      ];
    }
    return [
      {
        display: `install ${partial || "<url>"}`,
        detail: "URL must start with http:// or https://",
      },
    ];
  }

  if (verb === "deploy") {
    return suggestDeploy(tokens, trailingSpace, args);
  }

  if (verb === "update") {
    return suggestUpdate(tokens, trailingSpace, args);
  }

  if (verb === "list") {
    return suggestList(tokens, trailingSpace, args);
  }

  if (verb === "rm" || verb === "remove") {
    return suggestSkillTarget(
      tokens,
      trailingSpace,
      skills,
      "rm",
      (skill) =>
        actions.openModal({ type: "removeSkill", name: skill.name }),
      "remove this skill",
    );
  }

  if (verb === "rollback") {
    const eligible = skills.filter((s) => s.historyCount > 0);
    return suggestSkillTarget(
      tokens,
      trailingSpace,
      eligible,
      "rollback",
      (skill) =>
        actions.openModal({ type: "rollback", name: skill.name }),
      "open the rollback picker",
      "no skills with snapshots — set retention >0 in Settings first",
    );
  }

  if (verb === "browse" || verb === "open") {
    return suggestSkillTarget(
      tokens,
      trailingSpace,
      skills,
      verb,
      (skill) => browseSkill(skill.name),
      "reveal in Finder",
    );
  }

  return [];
}

function browseSkill(name: string): void {
  window.api.envInfo().then((info) => {
    window.api.openInFinder(`${info.paths.library}/${name}`);
  });
}

/**
 * Generic helper for verbs of the shape `<verb> <skill>` where <skill> is
 * a single token argument.
 */
function suggestSkillTarget(
  tokens: string[],
  trailingSpace: boolean,
  skills: Skill[],
  verbForFill: string,
  onPicked: (s: Skill) => void,
  detail: string,
  emptyHint = "no skills available",
): Suggestion[] {
  const partial = tokens.slice(1).join(" ");
  // No arg yet → list all
  if (partial === "" && !trailingSpace) {
    return [
      {
        display: `${verbForFill} <skill>`,
        detail,
        fill: `${verbForFill} `,
      },
      ...skills.slice(0, 8).map((s) => ({
        display: `${verbForFill} ${s.name}`,
        detail,
        run: () => onPicked(s),
      })),
    ];
  }
  if (partial === "" && trailingSpace) {
    if (skills.length === 0) {
      return [{ display: `${verbForFill} —`, detail: emptyHint }];
    }
    return skills.slice(0, 12).map((s) => ({
      display: `${verbForFill} ${s.name}`,
      detail,
      run: () => onPicked(s),
    }));
  }
  // Partial → filter
  const lc = partial.toLowerCase();
  const matches = skills
    .filter((s) => s.name.toLowerCase().includes(lc))
    .slice(0, 12);
  if (matches.length === 0) {
    return [
      {
        display: `${verbForFill} ${partial}`,
        detail: "no matching skill",
      },
    ];
  }
  // Exact match → terminal action
  const exact = matches.find((s) => s.name === partial);
  if (exact && !trailingSpace) {
    return [
      {
        display: `${verbForFill} ${exact.name}`,
        detail,
        run: () => onPicked(exact),
      },
      ...matches
        .filter((m) => m.name !== exact.name)
        .map((s) => ({
          display: `${verbForFill} ${s.name}`,
          detail,
          run: () => onPicked(s),
        })),
    ];
  }
  return matches.map((s) => ({
    display: `${verbForFill} ${s.name}`,
    detail,
    run: () => onPicked(s),
  }));
}

function suggestDeploy(
  tokens: string[],
  trailingSpace: boolean,
  args: BuildArgs,
): Suggestion[] {
  const { skills, projects, actions } = args;
  // Forms:
  //   deploy
  //   deploy <partial-skill>
  //   deploy <skill>
  //   deploy <skill> to
  //   deploy <skill> to <partial-project>
  //   deploy <skill> to <project>
  const rest = tokens.slice(1);
  const toIdx = rest.findIndex((t) => t.toLowerCase() === "to");

  // Stage 1 — picking the skill
  if (toIdx === -1) {
    const skillPartial = rest.join(" ");
    // No skill yet
    if (skillPartial === "" && !trailingSpace) {
      return [
        {
          display: "deploy <skill>",
          detail: "pick a skill",
          fill: "deploy ",
        },
        ...skills.slice(0, 8).map((s) => ({
          display: `deploy ${s.name}`,
          detail: "open the deploy picker",
          run: () => actions.openModal({ type: "deploy", skill: s.name }),
        })),
      ];
    }
    if (skillPartial === "" && trailingSpace) {
      return skills.slice(0, 12).map((s) => ({
        display: `deploy ${s.name}`,
        detail: "open the deploy picker",
        run: () => actions.openModal({ type: "deploy", skill: s.name }),
      }));
    }
    const lc = skillPartial.toLowerCase();
    const matches = skills.filter((s) => s.name.toLowerCase().includes(lc));
    const exact = matches.find((s) => s.name === skillPartial);
    if (exact && !trailingSpace) {
      // Single complete skill name → offer "open picker" + "to <project>" route
      return [
        {
          display: `deploy ${exact.name}`,
          detail: "open the deploy picker",
          run: () =>
            actions.openModal({ type: "deploy", skill: exact.name }),
        },
        {
          display: `deploy ${exact.name} to <project>`,
          detail: "specify a project inline",
          fill: `deploy ${exact.name} to `,
        },
      ];
    }
    if (matches.length === 0) {
      return [
        {
          display: `deploy ${skillPartial}`,
          detail: "no matching skill",
        },
      ];
    }
    return matches.slice(0, 12).map((s) => ({
      display: `deploy ${s.name}`,
      detail: "open the deploy picker",
      run: () => actions.openModal({ type: "deploy", skill: s.name }),
    }));
  }

  // Stage 2 — past the `to` keyword, optionally with a `for <agent>` suffix
  // for multi-agent deploys. Recognised forms:
  //   deploy <skill> to <project>                  → claude (default)
  //   deploy <skill> to <project> for <agent>      → that agent only
  //   deploy <skill> to <project> for all          → every supported agent
  const skillName = rest.slice(0, toIdx).join(" ").trim();
  const skill = findSkill(skills, skillName);
  if (!skill) {
    return [
      {
        display: `deploy ${skillName} to …`,
        detail: "skill not found",
      },
    ];
  }
  const restPastTo = rest.slice(toIdx + 1);
  const forIdx = restPastTo.findIndex((t) => t.toLowerCase() === "for");
  const projectTokens =
    forIdx === -1 ? restPastTo : restPastTo.slice(0, forIdx);
  const agentTokens =
    forIdx === -1 ? [] : restPastTo.slice(forIdx + 1);
  const projectPartial = projectTokens.join(" ").trim();
  const agentPartial = agentTokens.join(" ").trim().toLowerCase();

  // If `for` is present we need both a complete project path AND an agent
  // hint to actually run; otherwise fall back to the path-completion UI.
  if (forIdx !== -1 && projectPartial && /^(~|\/)/.test(projectPartial)) {
    const expanded = expandTilde(projectPartial);
    if (agentPartial === "all") {
      return [
        {
          display: `deploy ${skill.name} to ${tildify(expanded)} for all`,
          detail: "deploy to every supported agent",
          run: () => deployNow(skill.name, expanded, args, "__all__"),
        },
      ];
    }
    if (agentPartial.length > 0) {
      return [
        {
          display: `deploy ${skill.name} to ${tildify(expanded)} for ${agentPartial}`,
          detail: `deploy to ${agentPartial}`,
          run: () =>
            deployNow(skill.name, expanded, args, agentPartial),
        },
      ];
    }
    // `for ` typed but no agent yet — hint completion.
    return [
      {
        display: `deploy ${skill.name} to ${tildify(expanded)} for <agent>`,
        detail: "agent id (claude, codex, gemini, cursor, continue, cline) or 'all'",
        fill: `deploy ${skill.name} to ${projectPartial} for `,
      },
    ];
  }

  if (projectPartial === "" && !trailingSpace) {
    return [
      {
        display: `deploy ${skill.name} to <project>`,
        detail: "type a path or pick from tracked projects",
        fill: `deploy ${skill.name} to `,
      },
    ];
  }
  // Suggest tracked projects matching the partial
  const lc = projectPartial.toLowerCase();
  const projectMatches = projects.filter(
    (p) =>
      p.path.toLowerCase().includes(lc) ||
      tildify(p.path).toLowerCase().includes(lc),
  );

  const out: Suggestion[] = projectMatches.slice(0, 8).map((p) => ({
    display: `deploy ${skill.name} to ${tildify(p.path)}`,
    detail: `${p.skillCount} skill${p.skillCount === 1 ? "" : "s"} already there`,
    run: () => deployNow(skill.name, p.path, args),
  }));

  // Always offer "execute as typed" if the partial looks like an absolute path
  if (/^(~|\/)/.test(projectPartial)) {
    const expanded = expandTilde(projectPartial);
    if (!projectMatches.some((p) => p.path === expanded)) {
      out.unshift({
        display: `deploy ${skill.name} to ${tildify(expanded)}`,
        detail: "deploy to this path",
        run: () => deployNow(skill.name, expanded, args),
      });
    }
  }

  if (out.length === 0) {
    return [
      {
        display: `deploy ${skill.name} to ${projectPartial || "<project>"}`,
        detail: "type a full path or pick from tracked projects",
      },
    ];
  }
  return out;
}

function expandTilde(p: string): string {
  if (p.startsWith("~/")) {
    // Resolve via env-info path. We don't have process.env here; use a
    // best-guess HOME from the env-info IPC if we ever cache it. For now,
    // pass the literal — the main process won't accept it (validator
    // requires absolute), surfacing an error the user can correct.
    return p;
  }
  return p;
}

// Hardcoded fallback agent list used by `for all`. Kept in sync with the
// main-process AGENTS map; if a new agent is added there and this list is
// stale, "for all" simply won't include it — UI surfaces a warning per
// agent that fails, which is the correct degradation.
const ALL_AGENT_IDS = [
  "claude",
  "codex",
  "gemini",
  "cursor",
  "continue",
  "cline",
];

function deployNow(
  name: string,
  path: string,
  args: BuildArgs,
  agentSpec?: string,
): void {
  // The validator on the main side rejects non-absolute paths, so a `~`
  // shorthand will fail there. Surface that gracefully.
  if (!path.startsWith("/")) {
    args.actions.setError(
      "Project path must be absolute (start with /). Use the deploy picker if you need to browse.",
    );
    return;
  }
  const targets =
    agentSpec === "__all__"
      ? ALL_AGENT_IDS
      : agentSpec
        ? [agentSpec]
        : ["claude"];
  // Run sequentially — the deploy IPC writes to the config under a lock,
  // so parallel calls would just queue anyway and clearer error messages
  // come from finishing one before starting the next.
  (async () => {
    try {
      const warnings: string[] = [];
      for (const agentId of targets) {
        const result = await window.api.deploySkill(name, path, { agentId });
        if (result.warning) warnings.push(result.warning);
      }
      await args.actions.refreshSkills();
      await args.actions.refreshProjects();
      args.actions.setQuery("");
      if (warnings.length > 0) {
        args.actions.setStoreError(warnings.join("\n"));
      }
    } catch (err) {
      args.actions.setError(
        err instanceof Error ? err.message : String(err),
      );
    }
  })();
}

function suggestUpdate(
  tokens: string[],
  trailingSpace: boolean,
  args: BuildArgs,
): Suggestion[] {
  const { skills, updateInfo, actions } = args;
  const partial = tokens.slice(1).join(" ");
  const eligible = skills.filter((s) => !s.isLocal);

  // No arg yet → suggest --all + skills
  if (partial === "" && !trailingSpace) {
    const items: Suggestion[] = [
      {
        display: "update --all",
        detail: "open the bulk Update flow",
        run: () => actions.setScreen({ kind: "update" }),
      },
    ];
    items.push(
      ...eligible.slice(0, 8).map((s) => ({
        display: `update ${s.name}`,
        detail: updateInfo[s.name]?.hasUpdate
          ? "update available — open Update flow"
          : "open Update flow for this skill",
        run: () =>
          actions.setScreen({ kind: "update", prefillName: s.name }),
      })),
    );
    return items;
  }
  if (partial === "--all") {
    return [
      {
        display: "update --all",
        detail: "open the bulk Update flow",
        run: () => actions.setScreen({ kind: "update" }),
      },
    ];
  }
  const lc = partial.toLowerCase();
  if (lc === "-" || lc === "--") {
    return [
      {
        display: "update --all",
        detail: "open the bulk Update flow",
        fill: "update --all",
      },
    ];
  }
  const matches = eligible.filter((s) => s.name.toLowerCase().includes(lc));
  if (matches.length === 0) {
    return [
      {
        display: `update ${partial}`,
        detail: "no URL-backed skill matches",
      },
    ];
  }
  return matches.slice(0, 12).map((s) => ({
    display: `update ${s.name}`,
    detail: updateInfo[s.name]?.hasUpdate
      ? "update available"
      : "open Update flow",
    run: () =>
      actions.setScreen({ kind: "update", prefillName: s.name }),
  }));
}

function suggestList(
  tokens: string[],
  trailingSpace: boolean,
  args: BuildArgs,
): Suggestion[] {
  const { actions } = args;
  const partial = (tokens[1] ?? "").replace(/^--/, "");
  const matches = FILTER_KEYS.filter((k) => k.startsWith(partial));
  const apply = (key: (typeof FILTER_KEYS)[number]) => () => {
    actions.setLibraryLayout("cards");
    actions.setFilter(key);
    actions.setQuery("");
  };
  if (partial === "" && !trailingSpace) {
    return FILTER_KEYS.map((k) => ({
      display: `list --${k}`,
      detail:
        k === "all"
          ? "show every skill"
          : `filter to ${k} only (switches to cards view)`,
      run: apply(k),
    }));
  }
  if (matches.length === 0) {
    return [
      {
        display: `list --${partial}`,
        detail: "unknown filter",
      },
    ];
  }
  return matches.map((k) => ({
    display: `list --${k}`,
    detail: `filter to ${k} (switches to cards view)`,
    run: apply(k),
  }));
}
