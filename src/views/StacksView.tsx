// Stacks tab — composition surface for named, reusable bundles of skills.
// Targeting decisions (which agent, which project) live in the Deploy tab;
// this view never opens a deploy modal directly.

import { useEffect, useMemo } from "react";
import { useAppStore } from "../state/store";
import { StackCard } from "../components/StackCard";

export function StacksView() {
  const stacks = useAppStore((s) => s.stacks);
  const stackDeployments = useAppStore((s) => s.stackDeployments);
  const loadStacks = useAppStore((s) => s.loadStacks);
  const loadStackDeployments = useAppStore((s) => s.loadStackDeployments);
  const selectedSkill = useAppStore((s) => s.selectedSkill);
  // Reuse `selectedSkill` slot so only one card (skill or stack) is selected
  // at a time across views — avoids two highlights when the user round-trips.
  const setSelectedSkill = useAppStore((s) => s.setSelectedSkill);
  const setActiveStack = useAppStore((s) => s.setActiveStack);
  const setScreen = useAppStore((s) => s.setScreen);
  const openModal = useAppStore((s) => s.openModal);
  const queueStackForDeploy = useAppStore((s) => s.queueStackForDeploy);
  const deployStackToHomeLibrary = useAppStore(
    (s) => s.deployStackToHomeLibrary,
  );
  const setError = useAppStore((s) => s.setError);

  useEffect(() => {
    loadStacks();
    loadStackDeployments();
  }, [loadStacks, loadStackDeployments]);

  const deployCountByStack = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of stackDeployments) {
      counts[d.stackId] = (counts[d.stackId] ?? 0) + 1;
    }
    return counts;
  }, [stackDeployments]);

  const handleOpen = (stackId: string) => {
    setActiveStack(stackId);
    setScreen({ kind: "stackDetail", stackId });
  };

  const handleEdit = (stackId: string) => {
    setScreen({ kind: "editStack", stackId });
  };

  const handleDelete = (stackId: string) => {
    openModal({ type: "deleteStack", stackId });
  };

  return (
    <div
      style={{
        flex: 1,
        padding: 14,
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            fontFamily: "var(--read)",
            fontSize: 13,
            color: "var(--ink-soft)",
          }}
        >
          {stacks.length === 0
            ? "No stacks yet"
            : `${stacks.length} stack${stacks.length === 1 ? "" : "s"}`}
        </div>
        <button
          className="sk-btn sm"
          onClick={() => setScreen({ kind: "createStack" })}
        >
          Create stack
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "4px 0" }}>
        {stacks.length === 0 ? (
          <EmptyState
            onCreate={() => setScreen({ kind: "createStack" })}
          />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 10,
            }}
          >
            {stacks.map((stack) => (
              <StackCard
                key={stack.id}
                stack={stack}
                deploymentCount={deployCountByStack[stack.id] ?? 0}
                selected={selectedSkill === stack.id}
                onSelect={() =>
                  setSelectedSkill(
                    selectedSkill === stack.id ? null : stack.id,
                  )
                }
                onOpen={() => handleOpen(stack.id)}
                onSendToDeploy={() => queueStackForDeploy(stack.id)}
                onDeployToHomeLibrary={() =>
                  deployStackToHomeLibrary(stack.id).catch((err) =>
                    setError(
                      err instanceof Error ? err.message : String(err),
                    ),
                  )
                }
                onEdit={() => handleEdit(stack.id)}
                onDelete={() => handleDelete(stack.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      style={{
        padding: 40,
        textAlign: "center",
        color: "var(--ink-faint)",
        fontFamily: "var(--read)",
        fontSize: 13,
        lineHeight: 1.5,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          fontFamily: "var(--hand)",
          fontSize: 26,
          color: "var(--ink)",
        }}
      >
        No stacks yet
      </div>
      <div style={{ maxWidth: 320 }}>
        Combine skills into reusable stacks and deploy them together with one
        meta-skill that activates the bundle.
      </div>
      <button className="sk-btn sm" onClick={onCreate}>
        Create your first stack
      </button>
    </div>
  );
}
