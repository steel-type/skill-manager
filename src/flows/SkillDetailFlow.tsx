// Skill detail modal — opened by clicking the inline "Open" button on a
// selected card or by double-clicking a card. Shows everything we know
// about the skill: source, install/update timestamps, identifiers, content
// dirs, deployments, snapshot history count, and (for bundles) the nested
// skills inside.
//
// GitHub repo metadata (stars, last-commit-on-remote) is fetched lazily
// from api.github.com when a `github.com/owner/repo` URL is detected.
// The fetch is best-effort; failures are silent and the rest of the modal
// stays useful.

import { useEffect, useMemo, useState } from "react";
import { ScreenShell } from "../components/ScreenShell";
import { useAppStore } from "../state/store";
import type {
  Skill,
  TreeNode,
} from "../../electron/services/types";

interface SkillDetailFlowProps {
  name: string;
}

interface GitHubMeta {
  stargazers_count?: number;
  forks_count?: number;
  pushed_at?: string;
  default_branch?: string;
  description?: string;
}

function tildify(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~");
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  // See CommandPalette.formatRelative — append Z so timestamps without a
  // timezone marker are parsed as UTC, not local.
  const safe = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const t = new Date(safe).getTime();
  if (isNaN(t)) return "—";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function parseGithub(url: string | null): { owner: string; repo: string } | null {
  if (!url) return null;
  const m = url.match(
    /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/,
  );
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

export function SkillDetailFlow({ name }: SkillDetailFlowProps) {
  const setScreen = useAppStore((s) => s.setScreen);
  const skills = useAppStore((s) => s.skills);
  const openModal = useAppStore((s) => s.openModal);
  const queueSkillForDeploy = useAppStore((s) => s.queueSkillForDeploy);
  const setError = useAppStore((s) => s.setError);

  const goBack = () => setScreen({ kind: "main" });

  const skill = useMemo<Skill | undefined>(
    () => skills.find((s) => s.name === name),
    [skills, name],
  );

  const [meta, setMeta] = useState<GitHubMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [tree, setTree] = useState<TreeNode | null>(null);

  // Fetch the skill's directory tree on open. Best-effort.
  useEffect(() => {
    let cancelled = false;
    window.api
      .getSkillTree(name)
      .then((t) => {
        if (!cancelled) setTree(t);
      })
      .catch(() => {
        if (!cancelled) setTree(null);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  // Lazy GitHub metadata fetch. Renderer fetches directly — public repo
  // endpoint is unauthenticated and rate-limited but fine for occasional
  // skill detail views.
  useEffect(() => {
    if (!skill) return;
    const gh = parseGithub(skill.url);
    if (!gh) return;
    setMetaLoading(true);
    let cancelled = false;
    fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setMeta({
          stargazers_count: data.stargazers_count,
          forks_count: data.forks_count,
          pushed_at: data.pushed_at,
          default_branch: data.default_branch,
          description: data.description,
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setMetaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skill?.url]);

  if (!skill) return null;

  const gh = parseGithub(skill.url);

  const handleBrowse = () => {
    window.api.envInfo().then((info) => {
      window.api.openInFinder(`${info.paths.library}/${skill.name}`);
    });
  };

  const handleSource = () => {
    if (skill.url) window.api.openExternal(skill.url);
  };

  const handleDeploy = () => {
    queueSkillForDeploy(skill.name);
  };

  const handleUpdate = () => {
    setScreen({ kind: "update", prefillName: skill.name });
  };

  const handleRollback = () => {
    openModal({ type: "rollback", name: skill.name });
  };

  return (
    <ScreenShell title={skill.displayName} onBack={goBack}>
      <div
        style={{
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          overflow: "auto",
          flex: 1,
        }}
      >
        {/* Header — tags inline directly under the name (no separate
            description subtitle; identifiers/content show as chips on
            the right). Trims a row of vertical real estate so Files has
            room. */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div
            className="skill-icon"
            style={{
              width: 48,
              height: 48,
              fontSize: 18,
              background: "var(--paper-2)",
              flexShrink: 0,
            }}
          >
            {skill.displayName.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {skill.displayName}
              </div>
              {/* Contents chips (identifiers + content dirs) — moved up
                  next to the title so we don't repeat them in a separate
                  CONTENTS section below. */}
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                }}
              >
                {skill.identifiers.map((id) => (
                  <span key={id} className="sk-tag good">
                    {id}
                  </span>
                ))}
                {skill.contentDirs.map((d) => (
                  <span key={d} className="sk-tag">
                    {d}
                  </span>
                ))}
              </div>
            </div>
            <div
              style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}
            >
              {skill.isBundle && (
                <span className="sk-tag">bundle · {skill.bundleSize} inside</span>
              )}
              {skill.isLocal && <span className="sk-tag">local</span>}
              {skill.projects.length > 0 && (
                <span className="sk-tag good">
                  {skill.projects.length} deployed
                </span>
              )}
              {skill.commit && (
                <span className="sk-tag mono">@ {skill.commit}</span>
              )}
            </div>
          </div>
        </div>

        {/* Source / Installed / Last updated — single row, tight gap so
            the metadata sits close to the header instead of floating. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) 1fr 1fr",
            gap: 14,
            marginTop: -2,
          }}
        >
          <Field label="Source">
            {skill.url ? (
              <button
                onClick={handleSource}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  color: "var(--accent)",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  textDecoration: "underline",
                  wordBreak: "break-all",
                }}
                title="Open on GitHub"
              >
                {skill.url}
              </button>
            ) : (
              <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                local — not from a remote
              </span>
            )}
          </Field>
          <Field label="Installed">
            <span style={{ fontSize: 12 }}>
              {relativeTime(skill.installedAt)}
            </span>
          </Field>
          <Field label="Last updated">
            <span style={{ fontSize: 12 }}>
              {skill.updatedAt
                ? relativeTime(skill.updatedAt)
                : "never (since install)"}
            </span>
          </Field>
        </div>

        {/* GitHub stats live on their own line — only present when the
            skill has an upstream URL. Kept out of the metadata grid so
            the three-up Source/Installed/Last-updated layout stays tidy. */}
        {gh && (
          <div>
            <Field label="GitHub">
              {metaLoading && (
                <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                  loading…
                </span>
              )}
              {!metaLoading && meta && (
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    fontSize: 12,
                    flexWrap: "wrap",
                  }}
                >
                  {typeof meta.stargazers_count === "number" && (
                    <span title="stars">
                      ★ {meta.stargazers_count.toLocaleString()}
                    </span>
                  )}
                  {typeof meta.forks_count === "number" && (
                    <span title="forks">
                      ⑂ {meta.forks_count.toLocaleString()}
                    </span>
                  )}
                  {meta.pushed_at && (
                    <span title="last push to default branch">
                      pushed {relativeTime(meta.pushed_at)}
                    </span>
                  )}
                </div>
              )}
              {!metaLoading && !meta && (
                <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                  unavailable (offline or rate-limited)
                </span>
              )}
            </Field>
          </div>
        )}

        {/* File tree — primary content of this view. Has a generous
            min-height so it doesn't get squeezed when the upper sections
            grow, and flex:1 so it fills any remaining vertical space. */}
        {tree && tree.children && tree.children.length > 0 && (
          <>
            <div className="sk-divider soft" />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div className="rail-section" style={{ padding: 0 }}>
                Files
              </div>
              <span
                style={{ fontSize: 11, color: "var(--ink-faint)" }}
              >
                {countNodes(tree)} entries · double-click to reveal in Finder
              </span>
            </div>
            <div
              className="sk-box"
              style={{
                padding: 8,
                fontFamily: "var(--mono)",
                fontSize: 11,
                lineHeight: 1.55,
                minHeight: 360,
                flex: 1,
                overflow: "auto",
                background: "var(--paper-2)",
              }}
            >
              <TreeView root={tree} skillName={skill.name} />
            </div>
          </>
        )}

        {/* Bundle children */}
        {skill.isBundle && skill.nestedSkills.length > 0 && (
          <>
            <div className="sk-divider soft" />
            <div className="rail-section" style={{ padding: 0 }}>
              Skills inside · {skill.nestedSkills.length}
            </div>
            <div
              className="sk-box"
              style={{
                padding: 0,
                overflow: "hidden",
                maxHeight: 240,
                overflowY: "auto",
              }}
            >
              {skill.nestedSkills.map((n, i) => (
                <div
                  key={n.relativePath}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "8px 12px",
                    gap: 10,
                    borderBottom:
                      i < skill.nestedSkills.length - 1
                        ? "1px dashed var(--line-soft)"
                        : "none",
                  }}
                >
                  <div
                    className="skill-icon"
                    style={{ width: 24, height: 24, fontSize: 11 }}
                  >
                    {n.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>
                      {n.name}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        fontFamily: "var(--mono)",
                        color: "var(--ink-faint)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {n.relativePath}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Deployments */}
        {skill.projects.length > 0 && (
          <>
            <div className="sk-divider soft" />
            <div className="rail-section" style={{ padding: 0 }}>
              Deployed to · {skill.projects.length}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {skill.projects.map((p) => (
                <button
                  key={p}
                  onClick={() => window.api.openInFinder(p)}
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    textAlign: "left",
                    padding: "4px 6px",
                    color: "var(--ink)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    borderRadius: 4,
                  }}
                  title={p}
                >
                  📁 {tildify(p)}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Snapshot history count */}
        {skill.historyCount > 0 && (
          <>
            <div className="sk-divider soft" />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
              }}
            >
              <span className="rail-section" style={{ padding: 0 }}>
                Snapshots
              </span>
              <span style={{ color: "var(--ink-soft)" }}>
                {skill.historyCount} previous version
                {skill.historyCount === 1 ? "" : "s"} cached
              </span>
              <button
                className="sk-btn sm ghost"
                onClick={handleRollback}
                style={{ marginLeft: "auto" }}
              >
                Roll back…
              </button>
            </div>
          </>
        )}

        <div style={{ flex: 1, minHeight: 4 }} />

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="sk-btn ghost" onClick={handleBrowse}>
            Browse files
          </button>
          {!skill.isLocal && (
            <button className="sk-btn ghost" onClick={handleUpdate}>
              Update from GitHub
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="sk-btn primary" onClick={handleDeploy}>
            Send to Deploy
          </button>
          <button className="sk-btn" onClick={goBack}>
            Back to library
          </button>
        </div>
      </div>
    </ScreenShell>
  );
}

// ── Tree view ────────────────────────────────────────────────────────────

function countNodes(node: TreeNode): number {
  if (!node.children) return 1;
  return node.children.reduce((acc, c) => acc + countNodes(c), 0);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function TreeView({
  root,
  skillName,
}: {
  root: TreeNode;
  skillName: string;
}) {
  const lines: JSX.Element[] = [];
  const skillIdentifiers = new Set(["SKILL.md", "AGENTS.md"]);

  function render(
    node: TreeNode,
    prefix: string,
    isLast: boolean,
    isRoot: boolean,
  ) {
    const connector = isRoot ? "" : isLast ? "└── " : "├── ";
    const handleClick = async () => {
      const info = await window.api.envInfo();
      const fullPath = `${info.paths.library}/${skillName}${
        node.relativePath ? "/" + node.relativePath : ""
      }`;
      window.api.openInFinder(fullPath);
    };
    const isSkillFile = !node.isDir && skillIdentifiers.has(node.name);
    lines.push(
      <button
        key={`${node.relativePath}-${lines.length}`}
        type="button"
        onDoubleClick={handleClick}
        title={`double-click to reveal ${node.relativePath || skillName} in Finder`}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          padding: "1px 4px",
          color: node.isDir
            ? "var(--ink)"
            : isSkillFile
              ? "var(--accent)"
              : "var(--ink-soft)",
          fontWeight: node.isDir || isSkillFile ? 600 : 400,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          whiteSpace: "pre",
          fontFamily: "var(--mono)",
          fontSize: 11,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--card-selected-bg)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        {prefix}
        {connector}
        {node.isDir ? "📁 " : isSkillFile ? "★ " : ""}
        {node.name}
        {node.isDir ? "/" : ""}
        {!node.isDir && typeof node.size === "number" && node.size > 0 && (
          <span
            style={{
              color: "var(--ink-faint)",
              fontWeight: 400,
              marginLeft: 8,
            }}
          >
            {formatBytes(node.size)}
          </span>
        )}
      </button>,
    );

    if (node.isDir && node.children) {
      const nextPrefix = isRoot
        ? ""
        : prefix + (isLast ? "    " : "│   ");
      node.children.forEach((child, i) => {
        render(child, nextPrefix, i === node.children!.length - 1, false);
      });
    }
  }

  render(root, "", true, true);
  return <div>{lines}</div>;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div className="rail-section" style={{ padding: 0 }}>
        {label}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}
