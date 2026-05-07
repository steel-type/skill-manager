// Remove tracked project confirmation modal — choose whether to leave the
// .claude/skills/ dir alone or delete deployed skill folders. Mirrors
// design-reference/variations/flows.jsx DeployRemoveConfirm.

import { useMemo, useState } from "react";
import { Modal } from "../components/Modal";
import { useAppStore } from "../state/store";

interface RemoveProjectFlowProps {
  path: string;
}

export function RemoveProjectFlow({ path }: RemoveProjectFlowProps) {
  const closeModal = useAppStore((s) => s.closeModal);
  const projects = useAppStore((s) => s.projects);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const setError = useAppStore((s) => s.setError);

  const project = useMemo(
    () => projects.find((p) => p.path === path),
    [projects, path],
  );
  const [cleanFiles, setCleanFiles] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);

  if (!project) return null;
  const skillNames = project.skillNames;

  const onConfirm = async () => {
    setRunning(true);
    try {
      await window.api.removeProjectTracking(path, cleanFiles);
      await refreshSkills();
      await refreshProjects();
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  };

  return (
    <Modal
      open
      title="Remove project — confirm"
      width={560}
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
          minHeight: 0,
          overflow: "auto",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700 }}>
          Remove{" "}
          <span style={{ fontFamily: "var(--mono)", fontSize: 14 }}>
            {path.replace(/^\/Users\/[^/]+/, "~")}
          </span>{" "}
          from tracking?
        </div>
        <div className="hand" style={{ color: "var(--ink-soft)", fontSize: 15 }}>
          stops cascading updates. doesn't touch the project itself unless you
          ask.
        </div>

        <div className="rail-section" style={{ padding: 0 }}>
          What about installed skills?
        </div>
        <div
          className="sk-box"
          style={{
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <Radio
            checked={!cleanFiles}
            onClick={() => setCleanFiles(false)}
            title="Leave skills installed"
            hint={
              <>
                files in{" "}
                <span style={{ fontFamily: "var(--mono)" }}>.claude/skills/</span>{" "}
                stay put — useful if you migrated the project
              </>
            }
          />
          <div className="sk-divider soft" />
          <Radio
            checked={cleanFiles}
            onClick={() => setCleanFiles(true)}
            emphasis
            title={
              <>
                Remove deployed skills{" "}
                <span style={{ color: "var(--warn)" }}>
                  and clean directory
                </span>
              </>
            }
            hint="delete the listed folders below from disk"
          />
        </div>

        {cleanFiles && skillNames.length > 0 && (
          <>
            <div className="rail-section" style={{ padding: 0 }}>
              Will delete · {skillNames.length} folder
              {skillNames.length === 1 ? "" : "s"}
            </div>
            <div
              className="sk-box"
              style={{
                padding: 0,
                fontFamily: "var(--mono)",
                fontSize: 11,
              }}
            >
              {skillNames.map((name, i) => (
                <div
                  key={name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "8px 12px",
                    borderBottom:
                      i < skillNames.length - 1
                        ? "1px dashed var(--line-soft)"
                        : "none",
                    gap: 8,
                  }}
                >
                  <span style={{ color: "var(--warn)", fontSize: 14 }}>⚠</span>
                  <span style={{ flex: 1 }}>
                    {path.replace(/^\/Users\/[^/]+/, "~")}/.claude/skills/{name}
                  </span>
                </div>
              ))}
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: "var(--warn)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I understand these deletions are permanent.
            </label>
          </>
        )}

        <div style={{ flex: 1, minHeight: 0 }} />
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className="sk-btn ghost"
            onClick={closeModal}
            disabled={running}
          >
            Cancel
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="sk-btn"
            style={{
              background: cleanFiles ? "var(--warn)" : "var(--ink)",
              color: "white",
              borderColor: cleanFiles ? "var(--warn)" : "var(--ink)",
            }}
            disabled={running || (cleanFiles && !confirmed)}
            onClick={onConfirm}
          >
            {running
              ? "Removing…"
              : cleanFiles
                ? `Untrack + delete ${skillNames.length} →`
                : "Untrack only"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Radio({
  checked,
  emphasis,
  onClick,
  title,
  hint,
}: {
  checked: boolean;
  emphasis?: boolean;
  onClick: () => void;
  title: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <label
      onClick={onClick}
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        cursor: "pointer",
        background: emphasis && checked ? "var(--highlight)" : "transparent",
        margin: emphasis && checked ? -8 : 0,
        padding: emphasis && checked ? 8 : 0,
        borderRadius: 6,
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "1.5px solid var(--line)",
          background: checked ? "var(--ink)" : "var(--paper)",
          marginTop: 2,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "white",
            }}
          />
        )}
      </span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        {hint && (
          <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{hint}</div>
        )}
      </div>
    </label>
  );
}
