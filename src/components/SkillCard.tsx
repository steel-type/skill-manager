// A single skill card in the library grid. Ported from
// design-reference/variations/library.jsx LibraryC.Card.

import { OverflowMenu } from "./OverflowMenu";
import type { Skill } from "../../electron/services/types";

interface SkillCardProps {
  skill: Skill;
  hasUpdate: boolean;
  selected: boolean;
  isUpdating: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onDeploy: () => void;
  onBrowse: () => void;
  onUpdate: () => void;
  onRemove: () => void;
  onRollback: () => void;
}

export function SkillCard({
  skill,
  hasUpdate,
  selected,
  isUpdating,
  onSelect,
  onOpen,
  onDeploy,
  onBrowse,
  onUpdate,
  onRemove,
  onRollback,
}: SkillCardProps) {
  const accent = hasUpdate ? "var(--icon-update-bg)" : "var(--paper-2)";
  const badge = (() => {
    if (isUpdating) return { kind: "update", label: "updating…" };
    if (hasUpdate) return { kind: "update", label: "UPDATE" };
    if (skill.isBundle) return { kind: "", label: "bundle" };
    if (skill.isLocal) return { kind: "", label: "local" };
    if (skill.projects.length > 0)
      return {
        kind: "good",
        label: `${skill.projects.length} deployed`,
      };
    return null;
  })();

  return (
    <div
      className={`sk-box skill-card ${selected ? "shadow" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-busy={isUpdating}
      aria-label={`${skill.displayName}${hasUpdate ? " — update available" : ""}${isUpdating ? " — updating" : ""}`}
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        position: "relative",
        background: isUpdating
          ? "var(--card-updating-bg)"
          : selected
            ? "var(--card-selected-bg)"
            : "var(--card-bg)",
        cursor: "pointer",
        minHeight: 116,
        transition: "background 0.18s ease",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div
          className="skill-icon"
          style={{
            width: 36,
            height: 36,
            fontSize: 14,
            background: accent,
          }}
        >
          {skill.displayName.slice(0, 1).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="skill-name"
            style={{
              fontSize: 13,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {skill.displayName}
          </div>
          <div
            className="skill-desc"
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {skill.description ||
              (skill.isBundle ? `bundle · ${skill.bundleSize} skills` : "")}
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: 4,
          marginTop: "auto",
          alignItems: "center",
        }}
      >
        {badge && <span className={`sk-tag ${badge.kind}`}>{badge.label}</span>}
        <div style={{ flex: 1 }} />
        {selected && (
          <button
            className="sk-btn sm"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            title="Open the skill — double-click also works"
          >
            Open
          </button>
        )}
        <button
          className="sk-btn sm"
          onClick={(e) => {
            e.stopPropagation();
            onDeploy();
          }}
        >
          Deploy
        </button>
        <OverflowMenu
          items={[
            { label: "Browse files", onClick: onBrowse },
            {
              label: "Update from GitHub",
              onClick: onUpdate,
              disabled: skill.isLocal,
            },
            {
              label:
                skill.historyCount > 0
                  ? `Roll back… (${skill.historyCount})`
                  : "Roll back…",
              onClick: onRollback,
              disabled: skill.historyCount === 0,
            },
            {
              label: "Remove…",
              onClick: onRemove,
              destructive: true,
            },
          ]}
        />
      </div>
    </div>
  );
}
