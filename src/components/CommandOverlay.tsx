// Global ⌘K command overlay. Wraps CommandPalette in a Modal so the same
// verb parser is reachable from any tab, not just the Library palette
// layout. Auto-dismisses after a successful command run; ESC also closes
// (handled by Modal).

import { useEffect } from "react";
import { Modal } from "./Modal";
import { CommandPalette } from "./CommandPalette";
import { useAppStore } from "../state/store";

interface CommandOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function CommandOverlay({ open, onClose }: CommandOverlayProps) {
  const skills = useAppStore((s) => s.skills);
  const updateInfo = useAppStore((s) => s.updateInfo);
  const refreshSkills = useAppStore((s) => s.refreshSkills);
  const loadStacks = useAppStore((s) => s.loadStacks);

  // Refresh data when the overlay opens — keeps the palette suggestions
  // current even when the user has been editing for a while.
  useEffect(() => {
    if (!open) return;
    refreshSkills();
    loadStacks();
  }, [open, refreshSkills, loadStacks]);

  if (!open) return null;

  return (
    <Modal
      open
      title="Command palette"
      width={520}
      height={520}
      onClose={onClose}
      closeOnBackdrop
    >
      <div
        style={{
          padding: 14,
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <CommandPalette
          skills={skills}
          updateInfo={updateInfo}
          placeholder="type a command — install / deploy / stack / help"
          onCommandRun={onClose}
        />
      </div>
    </Modal>
  );
}
