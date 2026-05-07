// Library view — right-pane content only. The LeftRail (with VerticalNav
// + FilterRail) is rendered by App.tsx and stays anchored across tabs.
//
// Layout: card grid (variation C, default) or ⌘K command palette (variation
// D), toggled via the blue two-position slider.

import { useEffect, useMemo } from "react";
import { useAppStore, type LibraryFilter } from "../state/store";
import { LayoutToggle } from "../components/LayoutToggle";
import { SkillCard } from "../components/SkillCard";
import { UpdateBanner } from "../components/UpdateBanner";
import { InstallBar } from "../components/InstallBar";
import { CommandPalette } from "../components/CommandPalette";
import type { Skill } from "../../electron/services/types";

function applyFilter(
  skills: Skill[],
  filter: LibraryFilter,
  updateInfo: Record<string, { hasUpdate: boolean }>,
): Skill[] {
  switch (filter) {
    case "updates":
      return skills.filter((s) => updateInfo[s.name]?.hasUpdate);
    case "bundles":
      return skills.filter((s) => s.isBundle);
    case "local":
      return skills.filter((s) => s.isLocal);
    case "deployed":
      return skills.filter((s) => s.projects.length > 0);
    default:
      return skills;
  }
}

export function LibraryView() {
  const skills = useAppStore((s) => s.skills);
  const isLoading = useAppStore((s) => s.isLoading);
  const filter = useAppStore((s) => s.filter);
  const updateInfo = useAppStore((s) => s.updateInfo);
  const isCheckingUpdates = useAppStore((s) => s.isCheckingUpdates);
  const layout = useAppStore((s) => s.libraryLayout);
  const selectedSkill = useAppStore((s) => s.selectedSkill);
  const setSelectedSkill = useAppStore((s) => s.setSelectedSkill);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const runUpdateCheck = useAppStore((s) => s.runUpdateCheck);
  const openModal = useAppStore((s) => s.openModal);
  const setFilter = useAppStore((s) => s.setFilter);
  const updatingNames = useAppStore((s) => s.updatingNames);
  const stacks = useAppStore((s) => s.stacks);
  const loadStacks = useAppStore((s) => s.loadStacks);
  const queueSkillForDeploy = useAppStore((s) => s.queueSkillForDeploy);

  useEffect(() => {
    refreshSkills();
    refreshProjects();
    // Stacks drive the per-card StackBadge — load them so the indicator
    // is correct even on a fresh app launch where the user hasn't visited
    // the Stacks tab yet.
    loadStacks();
  }, [refreshSkills, refreshProjects, loadStacks]);

  // Map: skill name → stack display names that include it. Built once per
  // stacks-list change, looked up O(1) per card render.
  const stacksBySkillName = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const stack of stacks) {
      for (const skillName of stack.skillIds) {
        if (!m[skillName]) m[skillName] = [];
        m[skillName].push(stack.name);
      }
    }
    return m;
  }, [stacks]);

  const updatesCount = useMemo(
    () => skills.filter((s) => updateInfo[s.name]?.hasUpdate).length,
    [skills, updateInfo],
  );

  const cascadeCount = useMemo(() => {
    let total = 0;
    for (const s of skills) {
      if (updateInfo[s.name]?.hasUpdate) total += s.projects.length;
    }
    return total;
  }, [skills, updateInfo]);

  const visible = useMemo(
    () => applyFilter(skills, filter, updateInfo),
    [skills, filter, updateInfo],
  );

  const handleSendToDeploy = (skill: Skill) => {
    queueSkillForDeploy(skill.name);
  };

  const handleBrowse = (skill: Skill) => {
    window.api.envInfo().then((info) => {
      window.api.openInFinder(`${info.paths.library}/${skill.name}`);
    });
  };

  const handleUpdate = (skill: Skill) => {
    // Triggered from a card — open the Updates screen with this skill
    // pre-selected. They can still tick others before running.
    useAppStore.getState().setScreen({
      kind: "update",
      prefillName: skill.name,
    });
  };

  const handleRemove = (skill: Skill) => {
    openModal({ type: "removeSkill", name: skill.name });
  };

  const handleRollback = (skill: Skill) => {
    openModal({ type: "rollback", name: skill.name });
  };

  const handleOpen = (skill: Skill) => {
    useAppStore.getState().setScreen({ kind: "detail", name: skill.name });
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
        <LayoutToggle />
        <button
          className="sk-btn sm ghost"
          disabled={isCheckingUpdates}
          onClick={() => runUpdateCheck()}
          title="git ls-remote for every skill with a source URL"
        >
          {isCheckingUpdates ? "Checking…" : "Check updates"}
        </button>
      </div>

      {updatesCount > 0 && layout === "cards" && (
        <UpdateBanner
          count={updatesCount}
          cascadeCount={cascadeCount}
          onReview={() =>
            useAppStore.getState().setScreen({ kind: "update" })
          }
        />
      )}

      <InstallBar />

      {layout === "palette" ? (
        // Pass the full skills list, not `visible`. The palette is power-user
        // territory — actions like rollback/update need to find a skill even
        // when the active filter (e.g. "Updates") wouldn't include it. The
        // card grid still respects the filter; only the palette ignores it.
        <CommandPalette skills={skills} updateInfo={updateInfo} />
      ) : (
        <div
          style={{
            // No nested overflow:auto — the parent right-pane scrolls. The
            // 4 px top/bottom padding gives the hover-lift somewhere to go
            // even when content fills the viewport.
            flex: 1,
            minHeight: 0,
            padding: "4px 0",
          }}
        >
          {isLoading && skills.length === 0 ? (
            <EmptyState text="Loading library…" />
          ) : visible.length === 0 ? (
            <EmptyState
              text={
                skills.length === 0
                  ? "Your library is empty. Paste a GitHub URL above to install your first skill."
                  : "No skills match this filter."
              }
              action={
                filter !== "all"
                  ? {
                      label: "Show all skills",
                      onClick: () => setFilter("all"),
                    }
                  : undefined
              }
            />
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 10,
              }}
            >
              {visible.map((skill) => (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  hasUpdate={updateInfo[skill.name]?.hasUpdate ?? false}
                  selected={selectedSkill === skill.name}
                  isUpdating={updatingNames.has(skill.name)}
                  memberOfStacks={stacksBySkillName[skill.name] ?? []}
                  onSelect={() =>
                    setSelectedSkill(
                      selectedSkill === skill.name ? null : skill.name,
                    )
                  }
                  onOpen={() => handleOpen(skill)}
                  onSendToDeploy={() => handleSendToDeploy(skill)}
                  onBrowse={() => handleBrowse(skill)}
                  onUpdate={() => handleUpdate(skill)}
                  onRemove={() => handleRemove(skill)}
                  onRollback={() => handleRollback(skill)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  text,
  action,
}: {
  text: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      style={{
        padding: 40,
        textAlign: "center",
        color: "var(--ink-faint)",
        fontFamily: "var(--read)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div>{text}</div>
      {action && (
        <button
          className="sk-btn sm ghost"
          style={{ marginTop: 12 }}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
