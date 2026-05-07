// Sketchy macOS window chrome — wraps the entire app.
// Uses .wf-window / .wf-titlebar from wireframes.css.
//
// Native macOS traffic lights are repositioned (electron/main.ts:
// trafficLightPosition) into the left side of this titlebar, so we
// deliberately do NOT draw decorative ring lights — the OS controls live in
// the same spot the wireframe placed them. We just reserve their footprint
// (~76 px) so the title text doesn't collide.

import { ReactNode } from "react";

interface AppWindowProps {
  title: string;
  children: ReactNode;
}

const TRAFFIC_LIGHT_RESERVE = 76; // 3 lights × ~14px + spacing + inset

export function AppWindow({ title, children }: AppWindowProps) {
  return (
    <div className="wf-window wf">
      <div className="wf-titlebar">
        {/* Reserve space for the native traffic lights on the left.
            Rendered via the OS, not by us — see main.ts trafficLightPosition. */}
        <div
          aria-hidden
          style={{ width: TRAFFIC_LIGHT_RESERVE, flexShrink: 0 }}
        />
        <div className="wf-title">{title}</div>
        <div style={{ width: TRAFFIC_LIGHT_RESERVE, flexShrink: 0 }} />
      </div>
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}
