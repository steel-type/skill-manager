// Full-pane screen for creating or editing a skill stack. Routed via
// `screen.kind === "createStack" | "editStack"` from App.tsx — no modal
// chrome, just the right pane and a Back breadcrumb. Targeting decisions
// (agents, projects, mode) never happen here; the user picks members +
// meta, then queues the stack into Deploy via "Send to Deploy".

import { useEffect, useMemo, useRef, useState } from "react";
import { ScreenShell } from "../components/ScreenShell";
import { useAppStore } from "../state/store";

interface CreateStackFlowProps {
  /** Stack id being edited, or undefined for create mode. */
  editingStackId?: string;
}

// Mirror of validators.ts STACK_ID_REGEX so the user gets inline feedback
// without an IPC round-trip per keystroke. Kept in sync manually — tests
// over there guarantee the canonical truth.
const STACK_ID_REGEX = /^[a-z0-9](?:-?[a-z0-9])*$/;

function makeStackId(rawName: string): string {
  return rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function CreateStackFlow({ editingStackId }: CreateStackFlowProps) {
  const setScreen = useAppStore((s) => s.setScreen);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const stacks = useAppStore((s) => s.stacks);
  const skills = useAppStore((s) => s.skills);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const createStack = useAppStore((s) => s.createStack);
  const updateStackComposition = useAppStore(
    (s) => s.updateStackComposition,
  );
  const setError = useAppStore((s) => s.setError);
  const loadStacks = useAppStore((s) => s.loadStacks);

  const isEdit = !!editingStackId;
  const editing = useMemo(
    () =>
      editingStackId ? stacks.find((s) => s.id === editingStackId) : undefined,
    [stacks, editingStackId],
  );

  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [selected, setSelected] = useState<string[]>(editing?.skillIds ?? []);
  const [search, setSearch] = useState("");
  const [running, setRunning] = useState(false);
  const idEdited = useRef(false);
  const [stackId, setStackId] = useState<string>(editing?.id ?? "");

  // Auto-derive id from name on every keystroke unless the user has hand-
  // typed an id (no advanced disclosure exposed yet, but the toggle is
  // wired so we can add it without touching the form below).
  useEffect(() => {
    if (idEdited.current) return;
    if (isEdit) return; // Don't rename existing stacks.
    setStackId(makeStackId(name));
  }, [name, isEdit]);

  useEffect(() => {
    refreshSkills();
  }, [refreshSkills]);

  const goBack = () => {
    if (running) return;
    if (isEdit && editingStackId) {
      // Came from the StackDetailFlow → return there.
      setScreen({ kind: "stackDetail", stackId: editingStackId });
    } else {
      // Came from the Stacks tab.
      setScreen({ kind: "main" });
      setActiveTab("stacks");
    }
  };

  const idValid = stackId.length > 0 && STACK_ID_REGEX.test(stackId);
  const idCollision =
    !isEdit && idValid && stacks.some((s) => s.id === stackId);
  const idError = !idValid
    ? "Use lowercase letters, digits, and single hyphens only."
    : idCollision
      ? `A stack with id "${stackId}" already exists.`
      : null;

  const filteredSkills = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.displayName.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q),
    );
  }, [skills, search]);

  const toggleSkill = (skillName: string) => {
    setSelected((prev) =>
      prev.includes(skillName)
        ? prev.filter((s) => s !== skillName)
        : [...prev, skillName],
    );
  };

  const move = (skillName: string, direction: -1 | 1) => {
    setSelected((prev) => {
      const i = prev.indexOf(skillName);
      if (i < 0) return prev;
      const j = i + direction;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const preview = useMemo(() => {
    const description_ =
      description.trim() || `Skill stack: ${name || "untitled"}`;
    const lines = [
      "---",
      `name: ${stackId || "<id>"}`,
      `description: ${description_}`,
      "---",
      `# ${name || "Untitled stack"}`,
      "",
      "This stack activates:",
      ...(selected.length === 0
        ? ["_(no skills configured)_"]
        : selected.map((id) => `- ${id}`)),
    ];
    return lines.join("\n");
  }, [name, description, stackId, selected]);

  const canSubmit =
    !running &&
    name.trim().length > 0 &&
    selected.length > 0 &&
    description.trim().length <= DESCRIPTION_MAX &&
    (isEdit || (idValid && !idCollision));

  const onSubmit = async () => {
    setRunning(true);
    try {
      if (isEdit && editingStackId) {
        await updateStackComposition(editingStackId, selected);
        await loadStacks();
        setScreen({ kind: "stackDetail", stackId: editingStackId });
      } else {
        const created = await createStack(
          name.trim(),
          description.trim(),
          selected,
        );
        // Drop the user into the freshly-created stack's detail screen so
        // they can deploy it or edit further without navigating back.
        setScreen({ kind: "stackDetail", stackId: created.id });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  };

  return (
    <ScreenShell
      title={isEdit ? `Edit ${editing?.name ?? "stack"}` : "New stack"}
      onBack={goBack}
      rightSlot={
        <button
          className="sk-btn"
          disabled={!canSubmit}
          onClick={onSubmit}
          style={{
            background: canSubmit ? "var(--accent)" : "var(--paper-2)",
            color: canSubmit ? "var(--on-accent)" : "var(--ink-faint)",
            borderColor: canSubmit ? "var(--accent)" : "var(--line-soft)",
          }}
        >
          {running
            ? isEdit
              ? "Saving…"
              : "Creating…"
            : isEdit
              ? "Save changes"
              : "Create stack"}
        </button>
      }
    >
      <div
        style={{
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Label>Name</Label>
            <input
              type="text"
              value={name}
              disabled={isEdit}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Stack"
              style={inputStyle}
            />
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                fontFamily: "var(--mono)",
                color: idError ? "var(--warn)" : "var(--ink-faint)",
              }}
            >
              id: {stackId || "—"} {idError && `· ${idError}`}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Label>Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder='Describe what this stack does AND when to activate it. Example: "TypeScript and React debugging stack. Use when the user mentions TypeScript errors, React rendering issues, or asks about hooks."'
              rows={3}
              maxLength={DESCRIPTION_MAX}
              style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
            />
            <DescriptionFeedback value={description} />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* Skill picker */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minHeight: 0,
            }}
          >
            <Label>Skills · {selected.length} selected</Label>
            {selected.length > 0 && (
              <div
                className="sk-box"
                style={{
                  padding: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  background: "var(--paper-2)",
                  maxHeight: 160,
                  overflow: "auto",
                }}
              >
                {selected.map((skillName, i) => (
                  <div
                    key={skillName}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 6px",
                      fontSize: 12,
                      fontFamily: "var(--mono)",
                    }}
                  >
                    <span style={{ width: 18, color: "var(--ink-faint)" }}>
                      {i + 1}.
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>{skillName}</span>
                    <ReorderButton
                      label="↑"
                      ariaLabel={`Move ${skillName} up`}
                      disabled={i === 0}
                      onClick={() => move(skillName, -1)}
                    />
                    <ReorderButton
                      label="↓"
                      ariaLabel={`Move ${skillName} down`}
                      disabled={i === selected.length - 1}
                      onClick={() => move(skillName, 1)}
                    />
                    <ReorderButton
                      label="✕"
                      ariaLabel={`Remove ${skillName} from stack`}
                      onClick={() => toggleSkill(skillName)}
                    />
                  </div>
                ))}
              </div>
            )}
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search library…"
              style={inputStyle}
            />
            <div
              className="sk-box"
              style={{
                flex: 1,
                minHeight: 0,
                overflow: "auto",
                padding: 4,
              }}
            >
              {filteredSkills.length === 0 && (
                <div
                  style={{
                    padding: 16,
                    textAlign: "center",
                    fontSize: 12,
                    color: "var(--ink-faint)",
                  }}
                >
                  No skills match "{search}".
                </div>
              )}
              {filteredSkills.map((skill) => {
                const checked = selected.includes(skill.name);
                return (
                  <label
                    key={skill.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSkill(skill.name)}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: checked ? 600 : 400,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {skill.displayName}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 10,
                          color: "var(--ink-faint)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {skill.isLocal ? "local" : skill.url ?? "—"}
                      </div>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Meta-skill preview */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              minHeight: 0,
            }}
          >
            <Label>Meta-skill preview</Label>
            <pre
              className="sk-box"
              style={{
                flex: 1,
                minHeight: 0,
                overflow: "auto",
                background: "var(--paper-2)",
                padding: 12,
                fontFamily: "var(--mono)",
                fontSize: 11,
                lineHeight: 1.5,
                color: "var(--ink)",
                whiteSpace: "pre-wrap",
                margin: 0,
              }}
            >
              {preview}
            </pre>
          </div>
        </div>
      </div>
    </ScreenShell>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  fontSize: 13,
  fontFamily: "var(--read)",
  color: "var(--ink)",
  background: "var(--paper)",
  border: "1.5px solid var(--line)",
  borderRadius: 6,
  outline: "none",
  boxSizing: "border-box",
};

// Per agentskills.io specification:
// https://agentskills.io/specification — description must be 1-1024 chars
// and "should describe both what the skill does and when to use it.
// Should include specific keywords that help agents identify relevant
// tasks." We surface this contract via a live counter + a soft warning
// when no trigger phrasing is detected.
const DESCRIPTION_MAX = 1024;
const DESCRIPTION_SOFT_MIN = 60;
const TRIGGER_KEYWORDS =
  /(\buse when\b|\bwhen the user\b|\btriggers?\b|\bmentions?\b|\basks? about\b|\bworking with\b|\bactivate\b)/i;

function DescriptionFeedback({ value }: { value: string }) {
  const trimmed = value.trim();
  const len = trimmed.length;
  const overLimit = len > DESCRIPTION_MAX;
  const tooShort = len > 0 && len < DESCRIPTION_SOFT_MIN;
  const noTrigger = len > 0 && !TRIGGER_KEYWORDS.test(trimmed);
  const counterColor = overLimit
    ? "var(--warn)"
    : len > DESCRIPTION_MAX * 0.8
      ? "var(--warn)"
      : "var(--ink-faint)";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        marginTop: 4,
        fontSize: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "var(--ink-faint)" }}>
          Per <span style={{ fontFamily: "var(--mono)" }}>agentskills.io</span>:
          describe what + when. The description is how agents decide to load
          this stack.
        </span>
        <span style={{ color: counterColor, fontFamily: "var(--mono)" }}>
          {len}/{DESCRIPTION_MAX}
        </span>
      </div>
      {tooShort && (
        <span style={{ color: "var(--warn)" }}>
          ⚠ Very short — agents may under-trigger this stack.
        </span>
      )}
      {noTrigger && !tooShort && (
        <span style={{ color: "var(--warn)" }}>
          ⚠ No trigger phrasing detected. Add &ldquo;Use when…&rdquo; or
          &ldquo;When the user mentions…&rdquo; so agents know when to
          activate.
        </span>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rail-section"
      style={{ padding: 0, marginBottom: 4, fontSize: 11 }}
    >
      {children}
    </div>
  );
}

function ReorderButton({
  label,
  ariaLabel,
  disabled,
  onClick,
}: {
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 22,
        height: 22,
        padding: 0,
        background: "var(--paper)",
        border: "1px solid var(--line-soft)",
        borderRadius: 4,
        fontFamily: "var(--mono)",
        fontSize: 11,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.35 : 1,
        color: "var(--ink)",
      }}
    >
      {label}
    </button>
  );
}
