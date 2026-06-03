// Top install bar — paste GitHub URL + Install button.
// Submitting opens the InstallFlow modal so the live git log + bundle preview
// take over from there.
//
// Inline URL validation keeps the user from getting an opaque error from
// the modal. The check matches the main-process validator (services/
// validators.ts) — if it changes there, change here.

import { useMemo, useState } from "react";
import { useAppStore } from "../state/store";

const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

function urlError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null; // empty is allowed; submit no-ops
  if (trimmed.length > 2048) return "URL is suspiciously long";
  if (trimmed.startsWith("-")) return "URL cannot start with `-`";
  if (!URL_RE.test(trimmed)) return "Use a full https:// or http:// URL";
  return null;
}

export function InstallBar() {
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [importing, setImporting] = useState(false);
  const openModal = useAppStore((s) => s.openModal);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const setError = useAppStore((s) => s.setError);

  const error = useMemo(() => urlError(url), [url]);
  const showError = touched && !!error;

  const submit = () => {
    setTouched(true);
    const trimmed = url.trim();
    if (!trimmed || error) return;
    openModal({ type: "install", prefillUrl: trimmed });
    setUrl("");
    setTouched(false);
  };

  // Import a skill the user already has on disk — a folder, .zip, or .skill
  // file. The backend extracts archives, finds the SKILL.md root, and names
  // the skill; we just refresh the library on success.
  const importLocal = async () => {
    if (importing) return;
    const picked = await window.api.pickSkillSource();
    if (!picked) return;
    setImporting(true);
    try {
      const result = await window.api.importLocalSkill(picked);
      await refreshSkills();
      setError(`Imported “${result.name}” into your library.`, "generic");
    } catch (err) {
      setError(
        `Import failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          className="sk-input"
          aria-label="GitHub URL"
          aria-invalid={showError}
          aria-describedby={showError ? "install-bar-error" : undefined}
          style={{
            flex: 1,
            fontFamily: "var(--mono)",
            fontSize: 12,
            borderColor: showError ? "var(--warn)" : undefined,
          }}
          placeholder="+ Paste GitHub URL or skill name…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button
          className="sk-btn primary"
          onClick={submit}
          disabled={!url.trim() || !!error}
        >
          Install
        </button>
        <button
          className="sk-btn"
          onClick={importLocal}
          disabled={importing}
          title="Import a skill from a local folder, .zip, or .skill file"
        >
          {importing ? "Importing…" : "Import local…"}
        </button>
      </div>
      {showError && (
        <div
          id="install-bar-error"
          role="alert"
          style={{
            fontSize: 11,
            color: "var(--warn)",
            paddingLeft: 4,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
