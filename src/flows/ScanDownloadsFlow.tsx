// Scan-downloads flow modal — walk a folder (default ~/Downloads) for skill
// candidates, show them with checkboxes, batch-import the selection.
//
// The "scan" is read-only — nothing lands in the library until the user
// clicks Import. The import phase reuses the existing importLocalSkill
// pipeline per item, so .skill/.zip extraction and frontmatter handling
// stay in one place.

import { useEffect, useMemo, useState } from "react";
import { Modal } from "../components/Modal";
import { useAppStore } from "../state/store";
import type { SkillCandidate } from "../../electron/services/scanFolder";
import type { BatchImportResult } from "../../electron/operations";

type Phase = "scanning" | "ready" | "importing" | "done" | "error";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = (Date.now() - then) / (1000 * 60 * 60 * 24);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 30) return `${Math.floor(days)} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

export function ScanDownloadsFlow() {
  const closeModal = useAppStore((s) => s.closeModal);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const setError = useAppStore((s) => s.setError);

  const [folder, setFolder] = useState<string>("");
  const [candidates, setCandidates] = useState<SkillCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("scanning");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<BatchImportResult | null>(null);

  const runScan = async (target: string) => {
    setPhase("scanning");
    setErrorMsg(null);
    try {
      const found = await window.api.scanFolderForSkills(target);
      setCandidates(found);
      setSelected(new Set(found.map((c) => c.path)));
      setPhase("ready");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  // Initial scan: fetch the default folder, then walk it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const def = await window.api.defaultScanFolder();
        if (cancelled) return;
        setFolder(def);
        await runScan(def);
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const changeFolder = async () => {
    const picked = await window.api.pickFolder();
    if (!picked) return;
    setFolder(picked);
    await runScan(picked);
  };

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === candidates.length) setSelected(new Set());
    else setSelected(new Set(candidates.map((c) => c.path)));
  };

  const runImport = async () => {
    const paths = candidates
      .filter((c) => selected.has(c.path))
      .map((c) => c.path);
    if (paths.length === 0) return;
    setPhase("importing");
    try {
      const res = await window.api.importLocalSkillsBatch(paths);
      setResult(res);
      await refreshSkills();
      setPhase("done");
      if (res.imported > 0) {
        setError(
          `Imported ${res.imported} skill${res.imported === 1 ? "" : "s"} from ${folder}.`,
          "generic",
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const allChecked = useMemo(
    () => candidates.length > 0 && selected.size === candidates.length,
    [candidates.length, selected.size],
  );

  return (
    <Modal
      open={true}
      title="Scan for downloaded skills"
      width={580}
      onClose={closeModal}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
          }}
        >
          <span style={{ color: "var(--ink-mute)" }}>Scanning:</span>
          <code
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={folder}
          >
            {folder || "—"}
          </code>
          <button
            className="sk-btn"
            onClick={changeFolder}
            disabled={phase === "scanning" || phase === "importing"}
          >
            Change…
          </button>
        </div>

        {phase === "scanning" && (
          <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>
            Looking for SKILL.md folders and .skill/.zip archives…
          </div>
        )}

        {phase === "error" && (
          <div role="alert" style={{ fontSize: 12, color: "var(--warn)" }}>
            {errorMsg}
          </div>
        )}

        {phase === "ready" && candidates.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>
            No skill folders or archives found in this folder. Try picking a
            different one, or download a .skill / .zip first.
          </div>
        )}

        {(phase === "ready" || phase === "importing") &&
          candidates.length > 0 && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: "var(--ink-mute)",
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                  />
                  Select all ({candidates.length})
                </label>
                <span>{selected.size} selected</span>
              </div>
              <div
                style={{
                  maxHeight: 320,
                  overflowY: "auto",
                  border: "1px solid var(--rule)",
                  borderRadius: 6,
                }}
              >
                {candidates.map((c) => (
                  <label
                    key={c.path}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      borderBottom: "1px solid var(--rule)",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.path)}
                      onChange={() => toggle(c.path)}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "var(--mono)",
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.displayName}
                      </div>
                      <div
                        style={{
                          color: "var(--ink-mute)",
                          fontSize: 10,
                          marginTop: 2,
                        }}
                      >
                        {c.kind === "folder" ? "folder" : "archive"} ·{" "}
                        {formatSize(c.sizeBytes)} ·{" "}
                        {formatRelativeTime(c.modifiedAt)}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}

        {phase === "done" && result && (
          <div style={{ fontSize: 12 }}>
            <div style={{ marginBottom: 8 }}>
              <strong>{result.imported}</strong> imported,{" "}
              <strong>{result.failed}</strong> failed.
            </div>
            {result.failed > 0 && (
              <div
                style={{
                  maxHeight: 160,
                  overflowY: "auto",
                  border: "1px solid var(--rule)",
                  borderRadius: 6,
                  padding: 8,
                }}
              >
                {result.items
                  .filter((i) => i.error)
                  .map((i) => (
                    <div
                      key={i.sourcePath}
                      style={{ marginBottom: 6, fontSize: 11 }}
                    >
                      <code style={{ fontFamily: "var(--mono)" }}>
                        {i.sourcePath.split("/").pop()}
                      </code>
                      <div style={{ color: "var(--warn)", marginTop: 2 }}>
                        {i.error}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 4,
          }}
        >
          <button className="sk-btn" onClick={closeModal}>
            {phase === "done" ? "Close" : "Cancel"}
          </button>
          {(phase === "ready" || phase === "error") && (
            <button
              className="sk-btn primary"
              onClick={runImport}
              disabled={selected.size === 0 || candidates.length === 0}
            >
              Import {selected.size > 0 ? `${selected.size} ` : ""}selected
            </button>
          )}
          {phase === "importing" && (
            <button className="sk-btn primary" disabled>
              Importing…
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
