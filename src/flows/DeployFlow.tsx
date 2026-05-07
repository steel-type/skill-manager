// Deploy picker modal — opens when the user clicks "Deploy" on a skill
// card. Shows the most-recently-used project pre-selected and a Browse
// button to pick a different one. Replaces the earlier window.confirm()
// flow which was jarring against the warm theme.

import { useEffect, useMemo, useState } from "react";
import { Modal } from "../components/Modal";
import { useAppStore } from "../state/store";

interface DeployFlowProps {
  skillName: string;
}

function tildify(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

export function DeployFlow({ skillName }: DeployFlowProps) {
  const closeModal = useAppStore((s) => s.closeModal);
  const skills = useAppStore((s) => s.skills);
  const projects = useAppStore((s) => s.projects);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const setError = useAppStore((s) => s.setError);

  const skill = useMemo(
    () => skills.find((s) => s.name === skillName),
    [skills, skillName],
  );

  const settings = useAppStore((s) => s.settings);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  // Mode defaults to the user's saved preference but can be flipped per
  // deploy. Symlink falls back to copy (with a warning) for agents that
  // don't support links — surfaced in `warning` after the deploy returns.
  const [deployMode, setDeployMode] = useState<"copy" | "symlink">(
    settings.default_deploy_mode,
  );
  const [warning, setWarning] = useState<string | null>(null);

  // Pre-fill with the last-used project if it exists; otherwise leave empty
  // and force the user to Browse.
  useEffect(() => {
    let cancelled = false;
    window.api
      .getLastProject()
      .then((p) => {
        if (cancelled) return;
        setSelectedPath(p);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBrowse = async () => {
    const picked = await window.api.pickFolder();
    if (picked) setSelectedPath(picked);
  };

  const performDeploy = async () => {
    if (!selectedPath || !skill) return;
    setRunning(true);
    setWarning(null);
    try {
      const result = await window.api.deploySkill(skill.name, selectedPath, {
        deployMode,
      });
      if (result.warning) setWarning(result.warning);
      await refreshSkills();
      await refreshProjects();
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  };

  if (!skill) return null;

  // Recent projects to choose from — top 3 most-recently-deployed across all
  // skills, plus the active selection if it isn't in the list.
  const recentProjects = projects
    .filter((p) => p.exists)
    .slice(0, 4)
    .map((p) => p.path);

  return (
    <Modal
      open
      title={
        done
          ? "Deployed"
          : running
            ? "Deploying…"
            : "Deploy skill"
      }
      width={520}
      onClose={running ? () => {} : closeModal}
      closeOnBackdrop={!running}
    >
      <div
        style={{
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          flex: 1,
          overflow: "auto",
        }}
      >
        {!done ? (
          <>
            <div style={{ fontSize: 17, fontWeight: 700 }}>
              Deploy{" "}
              <span style={{ fontFamily: "var(--mono)", fontSize: 14 }}>
                {skill.displayName}
              </span>{" "}
              to a project
            </div>
            <div className="hand" style={{ color: "var(--ink-soft)", fontSize: 14 }}>
              copies the library skill into{" "}
              <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                &lt;project&gt;/.claude/skills/{skill.name}/
              </span>
            </div>

            <div className="rail-section" style={{ padding: 0 }}>
              Project path
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                className="sk-input"
                aria-label="Project path"
                placeholder="/path/to/project"
                value={selectedPath}
                onChange={(e) => setSelectedPath(e.target.value)}
                style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 12 }}
              />
              <button className="sk-btn" onClick={handleBrowse}>
                Browse…
              </button>
            </div>

            <div className="rail-section" style={{ padding: 0 }}>
              Mode
            </div>
            <div
              role="radiogroup"
              aria-label="Deploy mode"
              style={{
                display: "flex",
                gap: 6,
                fontSize: 12,
              }}
            >
              <ModeOption
                label="Copy"
                hint="replicate files into the project"
                active={deployMode === "copy"}
                onClick={() => setDeployMode("copy")}
              />
              <ModeOption
                label="Symlink"
                hint="point at the library copy — updates flow through"
                active={deployMode === "symlink"}
                onClick={() => setDeployMode("symlink")}
              />
            </div>

            {recentProjects.length > 0 && (
              <>
                <div className="rail-section" style={{ padding: 0 }}>
                  Recent
                </div>
                <div
                  className="sk-box"
                  style={{
                    padding: 0,
                    overflow: "hidden",
                  }}
                >
                  {recentProjects.map((p, i) => {
                    const isSelected = p === selectedPath;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setSelectedPath(p)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 12px",
                          width: "100%",
                          textAlign: "left",
                          borderBottom:
                            i < recentProjects.length - 1
                              ? "1px dashed var(--line-soft)"
                              : "none",
                          background: isSelected ? "var(--card-selected-bg)" : "transparent",
                          fontFamily: "var(--mono)",
                          fontSize: 12,
                        }}
                      >
                        <span aria-hidden>📁</span>
                        <span style={{ flex: 1 }}>{tildify(p)}</span>
                        {isSelected && (
                          <span
                            style={{
                              fontSize: 10,
                              color: "var(--ink-faint)",
                              fontFamily: "var(--read)",
                            }}
                          >
                            selected
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize: 17, fontWeight: 700 }}>
              Deployed to{" "}
              <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>
                {tildify(selectedPath)}
              </span>
            </div>
            <div className="hand" style={{ color: "var(--good)", fontSize: 15 }}>
              ✓ {skill.displayName}{" "}
              {deployMode === "symlink"
                ? "is now linked into"
                : "is now copied into"}{" "}
              <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                .claude/skills/
              </span>
            </div>
            {warning && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--warn)",
                  fontFamily: "var(--read)",
                }}
              >
                {warning}
              </div>
            )}
          </>
        )}

        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className="sk-btn ghost"
            onClick={closeModal}
            disabled={running}
          >
            {done ? "Close" : "Cancel"}
          </button>
          <div style={{ flex: 1 }} />
          {!done && (
            <button
              className="sk-btn primary"
              disabled={!selectedPath.trim() || running}
              onClick={performDeploy}
            >
              {running ? "Deploying…" : "Deploy"}
            </button>
          )}
          {done && (
            <button
              className="sk-btn"
              onClick={() => window.api.openInFinder(selectedPath)}
            >
              Open in Finder
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ModeOption({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className="sk-btn"
      style={{
        flex: 1,
        textAlign: "left",
        padding: "8px 10px",
        background: active ? "var(--card-selected-bg)" : "transparent",
        borderColor: active ? "var(--accent)" : undefined,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>{hint}</span>
    </button>
  );
}
