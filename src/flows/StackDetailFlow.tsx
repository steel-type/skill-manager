// Full-pane stack detail screen — opened from a StackCard click. Mirrors
// SkillDetailFlow's layout (back-breadcrumb shell, sectioned body, action
// footer) so the two screens read as siblings.

import { useEffect, useMemo } from "react";
import { ScreenShell } from "../components/ScreenShell";
import { useAppStore } from "../state/store";

interface StackDetailFlowProps {
  stackId: string;
}

function tildify(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~");
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const safe = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const t = new Date(safe).getTime();
  if (isNaN(t)) return iso;
  return new Date(safe).toLocaleString();
}

const STACK_ICON_LARGE = (
  <svg
    width="24"
    height="24"
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

export function StackDetailFlow({ stackId }: StackDetailFlowProps) {
  const setScreen = useAppStore((s) => s.setScreen);
  const stacks = useAppStore((s) => s.stacks);
  const stackDeployments = useAppStore((s) => s.stackDeployments);
  const skills = useAppStore((s) => s.skills);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const loadStacks = useAppStore((s) => s.loadStacks);
  const loadStackDeployments = useAppStore((s) => s.loadStackDeployments);
  const openModal = useAppStore((s) => s.openModal);
  const queueStackForDeploy = useAppStore((s) => s.queueStackForDeploy);
  const deployStackToHomeLibrary = useAppStore(
    (s) => s.deployStackToHomeLibrary,
  );
  const removeStackFromHomeLibrary = useAppStore(
    (s) => s.removeStackFromHomeLibrary,
  );
  const setError = useAppStore((s) => s.setError);

  useEffect(() => {
    loadStacks();
    loadStackDeployments();
    refreshSkills();
  }, [loadStacks, loadStackDeployments, refreshSkills]);

  const stack = useMemo(
    () => stacks.find((s) => s.id === stackId),
    [stacks, stackId],
  );
  const deployments = useMemo(
    () => stackDeployments.filter((d) => d.stackId === stackId),
    [stackDeployments, stackId],
  );
  const skillsByName = useMemo(
    () => new Map(skills.map((s) => [s.name, s] as const)),
    [skills],
  );

  const goBack = () => setScreen({ kind: "main" });

  if (!stack) {
    return (
      <ScreenShell title="Stack not found" onBack={goBack}>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ink-faint)",
            fontFamily: "var(--read)",
          }}
        >
          No stack with id {stackId}.
        </div>
      </ScreenShell>
    );
  }

  // Pre-flight: nudge users to put a stack in their home library before
  // deploying it to a project. Skipping is fine; we just want them to
  // make a deliberate call rather than silently miss the global path.
  const onSendToDeployClick = () => {
    if (stack.inHomeLibrary) {
      queueStackForDeploy(stack.id);
      return;
    }
    openModal({
      type: "confirm",
      title: "Deploy without placing in home library?",
      body:
        "Stacks in the home library are discoverable by your primary agent from any project automatically. We recommend placing this stack in the home library before deploying to a specific project — you can do both.",
      confirmLabel: "Place in home library + continue",
      cancelLabel: "Skip — go to Deploy",
      onConfirm: async () => {
        await deployStackToHomeLibrary(stack.id);
        queueStackForDeploy(stack.id);
      },
      onCancel: () => {
        queueStackForDeploy(stack.id);
      },
    });
  };

  const footer = (
    <>
      <button
        className="sk-btn ghost"
        onClick={() => openModal({ type: "deleteStack", stackId: stack.id })}
        style={{ color: "var(--warn)", borderColor: "var(--warn)" }}
      >
        Delete stack
      </button>
      <div style={{ flex: 1 }} />
      <button
        className="sk-btn ghost"
        onClick={() => setScreen({ kind: "editStack", stackId: stack.id })}
      >
        Edit composition
      </button>
      {stack.inHomeLibrary ? (
        <button
          className="sk-btn ghost"
          onClick={() =>
            removeStackFromHomeLibrary(stack.id).catch((err) =>
              setError(err instanceof Error ? err.message : String(err)),
            )
          }
          title="Remove from primary agent's global skills dir + flip the Library flag"
        >
          Remove from home library
        </button>
      ) : (
        <button
          className="sk-btn"
          onClick={() =>
            deployStackToHomeLibrary(stack.id).catch((err) =>
              setError(err instanceof Error ? err.message : String(err)),
            )
          }
          title="Wire this stack into your primary agent's global skills so it works in any project"
        >
          Add to home library
        </button>
      )}
      <button
        className="sk-btn"
        onClick={onSendToDeployClick}
        style={{
          background: "var(--accent)",
          color: "var(--on-accent)",
          borderColor: "var(--accent)",
        }}
      >
        Send to Deploy
      </button>
    </>
  );

  return (
    <ScreenShell title={stack.name} onBack={goBack} footerSlot={footer}>
      <div
        style={{
          flex: 1,
          padding: 18,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          minHeight: 0,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div
            className="skill-icon"
            aria-hidden
            style={{
              width: 48,
              height: 48,
              background: "var(--paper-2)",
              color: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {STACK_ICON_LARGE}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                fontFamily: "var(--read)",
                color: "var(--ink)",
              }}
            >
              {stack.name}
            </div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--ink-faint)",
              }}
            >
              {stack.id}
            </div>
            {stack.description && (
              <div
                style={{
                  marginTop: 6,
                  fontFamily: "var(--read)",
                  fontSize: 13,
                  color: "var(--ink-soft)",
                  lineHeight: 1.5,
                }}
              >
                {stack.description}
              </div>
            )}
            <div
              style={{
                marginTop: 6,
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--ink-faint)",
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <span>created {formatTimestamp(stack.createdAt)}</span>
              <span>updated {formatTimestamp(stack.updatedAt)}</span>
            </div>
          </div>
        </div>

        {/* Skills — Edit composition lives in the sticky footer below
            so we don't repeat the action here. */}
        <Section title={`Skills · ${stack.skillIds.length}`}>
          {stack.skillIds.length === 0 ? (
            <div
              style={{
                padding: 12,
                fontSize: 12,
                color: "var(--ink-faint)",
                fontFamily: "var(--read)",
              }}
            >
              No skills yet — open Edit composition to add some.
            </div>
          ) : (
            <div className="sk-box" style={{ padding: 0 }}>
              {stack.skillIds.map((skillName, i) => {
                const s = skillsByName.get(skillName);
                return (
                  <div
                    key={skillName}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderBottom:
                        i < stack.skillIds.length - 1
                          ? "1px dashed var(--line-soft)"
                          : "none",
                    }}
                  >
                    <span
                      style={{
                        width: 22,
                        textAlign: "right",
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: "var(--ink-faint)",
                      }}
                    >
                      {i + 1}.
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "var(--read)",
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        {s?.displayName ?? skillName}
                        {!s && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 11,
                              color: "var(--warn)",
                              fontWeight: 400,
                            }}
                          >
                            missing from library
                          </span>
                        )}
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
                        {s?.url ?? (s?.isLocal ? "local" : "—")}
                      </div>
                      {s?.description && (
                        <div
                          style={{
                            fontFamily: "var(--read)",
                            fontSize: 12,
                            color: "var(--ink-soft)",
                            marginTop: 2,
                          }}
                        >
                          {s.description}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* Deployments */}
        <Section title={`Deployments · ${deployments.length}`}>
          {deployments.length === 0 ? (
            <div
              style={{
                padding: 12,
                fontSize: 12,
                color: "var(--ink-faint)",
                fontFamily: "var(--read)",
              }}
            >
              No projects host this stack yet. Use Send to Deploy below to
              push it to one.
            </div>
          ) : (
            <div className="sk-box" style={{ padding: 0 }}>
              {deployments.map((d, i) => {
                const drift =
                  d.includedSkillIds.length !== stack.skillIds.length ||
                  d.includedSkillIds.some(
                    (id, idx) => id !== stack.skillIds[idx],
                  );
                return (
                  <div
                    key={`${d.projectPath}|${d.agentId}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderBottom:
                        i < deployments.length - 1
                          ? "1px dashed var(--line-soft)"
                          : "none",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 12,
                          color: "var(--ink)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {tildify(d.projectPath)}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 10,
                          color: "var(--ink-faint)",
                        }}
                      >
                        {d.agentId} · {d.deployMode} · deployed{" "}
                        {formatTimestamp(d.timestamp)} ·{" "}
                        {d.includedSkillIds.length} member
                        {d.includedSkillIds.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    {drift && (
                      <span
                        className="sk-tag"
                        title="The stack composition has changed since this deployment. Re-deploy to push the latest meta-skill."
                        style={{
                          color: "var(--warn)",
                          borderColor: "var(--warn)",
                        }}
                      >
                        drift
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>

      </div>
    </ScreenShell>
  );
}

function Section({
  title,
  rightSlot,
  children,
}: {
  title: string;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          className="rail-section"
          style={{ padding: 0, fontSize: 11, flex: 1 }}
        >
          {title}
        </div>
        {rightSlot}
      </div>
      {children}
    </section>
  );
}
