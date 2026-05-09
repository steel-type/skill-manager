// Card for a single skill stack in the StacksView grid. Mirrors SkillCard's
// visual language (icon top-left, title + subtitle, description, footer with
// badge + actions) so the two grids feel like siblings.

import type { SkillStack } from "../../electron/services/types";
import { OverflowMenu } from "./OverflowMenu";

interface StackCardProps {
  stack: SkillStack;
  /** How many tracked projects currently host this stack. Drives the
   *  "N deployed" badge in the footer. */
  deploymentCount: number;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onSendToDeploy: () => void;
  onDeployToHomeLibrary: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const STACK_ICON = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="2.5" width="10" height="2.5" rx="0.6" />
    <rect x="2" y="5.75" width="10" height="2.5" rx="0.6" />
    <rect x="2" y="9" width="10" height="2.5" rx="0.6" />
  </svg>
);

export function StackCard({
  stack,
  deploymentCount,
  selected,
  onSelect,
  onOpen,
  onSendToDeploy,
  onDeployToHomeLibrary,
  onEdit,
  onDelete,
}: StackCardProps) {
  const subtitle = `${stack.skillIds.length} skill${stack.skillIds.length === 1 ? "" : "s"}`;
  return (
    <div
      className={`sk-box skill-card ${selected ? "shadow" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${stack.name} — ${subtitle}`}
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
        background: selected ? "var(--card-selected-bg)" : "var(--card-bg)",
        cursor: "pointer",
        minHeight: 116,
        transition: "background 0.18s ease",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div
          className="skill-icon"
          aria-hidden
          style={{
            width: 36,
            height: 36,
            background: "var(--paper-2)",
            color: "var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {STACK_ICON}
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
            {stack.name}
          </div>
          <div
            className="skill-desc"
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {stack.description || subtitle}
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          marginTop: "auto",
          alignItems: "center",
        }}
      >
        <span className="sk-tag">{subtitle}</span>
        {stack.inHomeLibrary && (
          <span
            className="sk-tag good"
            title="Promoted into the home library — discoverable by your primary agent from any project"
          >
            in library
          </span>
        )}
        {deploymentCount > 0 && (
          <span className="sk-tag good">{deploymentCount} deployed</span>
        )}
        <div style={{ flex: 1 }} />
        {selected && (
          <button
            className="sk-btn sm"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            title="Open the stack — double-click also works"
          >
            Open
          </button>
        )}
        <button
          className="sk-btn sm"
          onClick={(e) => {
            e.stopPropagation();
            onSendToDeploy();
          }}
          title="Queue this stack in the Deploy tab"
        >
          Send to Deploy
        </button>
        <OverflowMenu
          items={[
            { label: "Edit composition", onClick: onEdit },
            ...(stack.inHomeLibrary
              ? []
              : [
                  {
                    label: "Add to home library",
                    onClick: onDeployToHomeLibrary,
                  },
                ]),
            { label: "Delete stack…", onClick: onDelete, destructive: true },
          ]}
        />
      </div>
    </div>
  );
}
