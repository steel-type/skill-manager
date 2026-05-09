# Skillbase Rewrite Plan

> Living doc. Decisions get pinned here as they're made. Revise freely.

## Goal

Ship a desktop app that does everything Skillbase does today but is **dramatically smaller** (target <80 MB installed) and **truly cross-platform** (macOS / Windows / Linux), without losing the wireframe aesthetic, Stacks, the deployment ledger, snapshots/rollback, or the Setup/Migration flows.

Secondary goal: stay in TypeScript end-to-end so AI-assisted velocity (currently ~5,000 LOC/active-day) doesn't drop.

## Constraints (don't break these)

- **Config compatibility** — the existing `~/.claude/skill-manager.json` (and the stack/setup data inside) must load unchanged. Existing users install the new app and keep working.
- **UI parity** — same React tree, same theme tokens (Light/Dark), same wireframe shape language. Components port without redesign.
- **Test parity** — the existing vitest suite (validators, parser, stacks collisions, etc.) keeps running against the ported code.
- **Security parity** — the same input validation, atomic writes, config mutex, child-process tracking, and CSP guarantees survive the port.
- **No regressions in the six currently-supported agents** (claude, codex, gemini, continue, cursor, cline).

## Recommended stack: Tauri + Bun sidecar

> **Status: PROPOSED — not yet ratified. Push back if you want to try a different combo first.**

**Why this combo:**

- **Tauri shell** (Rust, ~5 MB) hosts the OS-native webview — WebKit on Mac, WebView2 on Windows, WebKitGTK on Linux. We barely write Rust; we use Tauri's templates.
- **Bun sidecar** runs all of `electron/services/*.ts` essentially as-is. Bun is ABI-compatible with Node for our usage (file I/O, child_process, JSON, fetch). No Rust port of the service layer.
- **React frontend** ships into the webview unchanged.
- **Total bundle**: ~65 MB (Tauri host ~5 MB + Bun runtime ~30 MB + your code/assets ~5 MB + per-platform webview ~25 MB). 6× smaller than Electron.
- **AI velocity**: maximal — your code stays in TypeScript.

**Why not pure Tauri (Rust services):**
- Rust port of ~10K LOC of services is real engineering work — Claude is weaker at Rust than TS.
- Bundle goes from ~65 MB to ~15 MB for the privilege. Trade not worth it given your pace.

**Why not Wails:**
- Go is AI-friendly but you'd still rewrite services in Go. Same lift as the Rust port, smaller velocity penalty.
- Bun-sidecar lets us keep TS — strictly better.

**Why not single Bun binary + system tray:**
- ~50 MB cross-platform binary, but loses native window chrome (browser-tab UX, no traffic lights).
- Skillbase's polish is part of the product.

## What ports as-is (no rewrite)

| Layer | Files | Action |
|---|---|---|
| React tree | `src/App.tsx`, all components/views/flows | Copy. CSS works unchanged. |
| State | `src/state/store.ts` (zustand) | Copy. |
| Theme | LIGHT_THEME.md, DARK_THEME.md, all CSS vars | Copy. WebKit may need spot-fixes (font rendering, scrollbars). |
| Service layer | `electron/services/*.ts` (~10K LOC) | Copy. Bun runs them. Update IPC adapter only. |
| Tests | `electron/services/*.test.ts` | Copy. Bun runs vitest. |
| Validators | `electron/services/validators.ts` | Copy. |
| Frontmatter parser | `electron/services/skills.ts` | Copy. |
| Stack logic | `electron/services/stacks.ts` | Copy. |

**Estimated ~85% of code ports verbatim.**

## What needs work

### 1. IPC adapter (renderer ↔ Bun sidecar)

**Today (Electron):** `electron/preload.ts` exposes `window.api` via `contextBridge`. Renderer calls `window.api.installSkill(url)` → IPC → main process.

**Tomorrow (Tauri+Bun):** Renderer calls Tauri's `invoke('install_skill', {url})` → Tauri shell → forwards to Bun sidecar via stdio JSON-RPC → Bun runs the service handler → reply.

Effort: ~1–2 days. The `window.api` surface is well-defined; we just swap the transport. The sidecar pattern is documented; main risk is the JSON-RPC plumbing.

### 2. Window chrome

**Today:** Frameless macOS window with traffic lights repositioned via Electron's `titleBarStyle: 'hidden'` + `trafficLightPosition`.

**Tomorrow:** Tauri exposes window decoration controls (`decorations: false`, custom titlebar). The CSS-drawn titlebar in `AppWindow.tsx` mostly survives; the platform-specific code paths (traffic lights vs Windows minimize/maximize/close) get factored into a `<WindowControls/>` component with a per-platform implementation.

Effort: ~1 day. xingkongliang's Tauri skills-manager already solved this; reference their code.

### 3. Sidecar bundling

Bun's `bun build --compile` produces a single-file binary per OS. Tauri's `tauri.conf.json` has a `bundle.externalBin` field for sidecars — point it at the compiled Bun binary per target triple.

Build pipeline: `bun build src/sidecar/main.ts --compile --target=bun-darwin-arm64 --outfile=dist-sidecar/skillbase-sidecar-darwin-arm64`. Repeat for `darwin-x64`, `windows-x64`, `linux-x64`. CI matrix.

Effort: ~1 day to wire up. Mostly config.

### 4. Cross-platform parity

- **Fonts** — Caveat + Kalam render differently in WebKit vs Chromium. Audit: open the spike app on Mac and verify the wireframe aesthetic survives. If it looks weird, swap to a font-pair that renders identically across webviews (worst case: swap Caveat for a different hand-drawn font).
- **Scrollbars** — WebKit ignores most `::-webkit-scrollbar` styling rules. Audit FilterRail and any custom-scrolled containers; use `scrollbar-width` + `scrollbar-color` (cross-browser standard) instead.
- **Focus rings** — slight visual differences. Acceptable.
- **macOS-specific build tools** — `qlmanage`, `iconutil`, `sips` (used in `build-icons.sh`) are macOS-only. For cross-platform icon building, swap to `electron-icon-maker` or a platform-agnostic sharp/png-to-icon pipeline. (Or accept that icon-building stays on Mac-host since Mac devs are the only ones likely doing it.)

Effort: ~2–3 days of audit + spot-fixes spread across the port.

### 5. Build + release pipeline

- **Today:** electron-builder produces a Mac DMG via `npm run dist`.
- **Tomorrow:** `tauri build` produces per-platform installers — DMG on Mac, MSI/NSIS on Windows, AppImage/deb/rpm on Linux. Add a GitHub Actions matrix for Mac/Win/Linux. Each pushes its artifact to the release.

Effort: ~1 day. Tauri's CI templates are off-the-shelf.

## Phasing

### Phase A — Spike (1–2 days, before committing to the rewrite)

Time-box. Do not port everything yet.

- Set up a fresh Tauri project alongside the current repo.
- Copy `src/views/LibraryView.tsx`, `src/components/SkillCard.tsx`, theme CSS, and the install flow.
- Stand up a minimal Bun sidecar that handles 2–3 IPC commands: `listSkills`, `installSkill`, `getSettings`.
- Wire JSON-RPC between Tauri shell and Bun sidecar.
- Build for Mac. Verify:
  - Wireframe aesthetic survives WebKit
  - SkillCard hover/click behavior works
  - Install flow completes end-to-end
  - Bundle is in the 60–80 MB range
- Try a Windows build via GitHub Actions (or a VM). Verify nothing looks visually broken.

**Decision gate:** if the spike feels right, commit to Phase B. If WebKit breaks something we can't fix cheaply, fall back to "ship Electron Win/Linux builds" plan.

### Phase B — Port (1–2 weeks)

Service layer, view by view. Suggested order (smallest blast radius first):

1. `validators.ts` + tests → run inside Bun sidecar
2. `config.ts` + tests
3. `paths.ts`, `agents.ts`, `setup.ts`
4. `git.ts` (child_process — needs verification on Windows where `git.exe` not always on PATH)
5. `skills.ts` (frontmatter parser + bundle detection)
6. `deploy.ts`
7. `stacks.ts`
8. `history.ts` + `migration.ts`
9. `exportImport.ts`
10. Renderer: every view + flow, in dep order

Each commit is one service or one view, fully ported with tests passing. Atomic commits make rollback easy.

### Phase C — Cross-platform polish + release (3–5 days)

- GitHub Actions matrix: Mac arm64, Mac x64 (or Mac universal), Windows x64, Linux x64
- Each platform: smoke-test the full Skillbase + Stacks + deploy flow
- Audit font rendering, scrollbar styling, focus rings on all three OSes
- Update README install section: "Download for your platform" with three buttons
- Cut v0.3.0 release with all four artifacts attached

## Migration path for existing users

The schema in `~/.claude/skill-manager.json` is JSON. Bun reads it identically to Node. **No migration code needed** — the new app picks up the existing config on first launch.

The only edge case: macOS users who installed the Electron `Skillbase.app` will end up with two Skillbase apps if they install v0.3.0 alongside. Recommend: add a one-time "uninstall the old Skill Manager.app from /Applications" line to the v0.3.0 release notes.

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| WebKit renders Caveat/Kalam fuzzy on Mac | Medium | Audit during Phase A spike. Worst case: swap to a font that renders identically (Patrick Hand, Caveat Brush). |
| Bun sidecar IPC has weird latency or crashes | Low–Medium | Phase A spike validates the pattern. Fallback: rewrite the sidecar in a small Tauri command set in Rust (loses some velocity but ships). |
| WebView2 on Windows has surprise CSS bugs | Medium | Phase A spike tests Windows. WebView2 = Edge Chromium, so probably fine, but verify scrollbars + flexbox + transforms. |
| WebKitGTK on Linux has bigger bugs than WebView2 | Medium–High | Linux is the trailing platform. Accept "tier 2 support" if blocking issues emerge — ship Mac + Windows first, Linux as best-effort. |
| `git.exe` not on Windows PATH | Medium | `git` ships with Git for Windows; bundled installers add to PATH. Document the requirement; detect at startup and surface a clear "install git" message. |
| Bun's `child_process.spawn` semantics differ from Node on edge cases | Low | All git ops go through one wrapper (`git.ts`); test there. Bun aims for Node compat; small deltas are fixable in the wrapper. |
| Rust toolchain required to build locally | Low | Tauri's `cargo build` is one-time setup; CI handles the rest. Document in README. |

## Estimated timeline

Calibrated to your demonstrated throughput (~5K LOC/active-day, AI-assisted, clear scope):

- **Phase A (spike)**: 1–2 active days
- **Phase B (port)**: 5–8 active days
- **Phase C (cross-platform polish + release)**: 2–3 active days

**Total: ~8–13 active days.** Calendar time depends on how many days you actually code.

If Rust ramp is needed for Tauri-specific work (window chrome quirks, sidecar config): add ~2 days. Most of the rewrite avoids Rust entirely.

## Success criteria

Skillbase v0.3.0 ships when:

- [ ] All current vitest tests pass against the ported codebase running in Bun
- [ ] Mac DMG, Windows MSI, Linux AppImage all install and run
- [ ] First-run Setup completes end-to-end on each platform
- [ ] Library + Install flow works on each platform
- [ ] Stacks: create / edit / delete / deploy works on each platform
- [ ] Snapshot + rollback works on each platform
- [ ] Bundle size <80 MB installed on Mac (target ~65 MB)
- [ ] Existing `~/.claude/skill-manager.json` configs load without migration
- [ ] No `damaged-and-can't-be-opened` Gatekeeper issue (ad-hoc-signed at minimum)
- [ ] README install section updated with three platform downloads

## Open questions to ratify

1. **Stack acceptance** — Tauri + Bun sidecar, or push back to a different combo (pure Tauri, Wails, stay-on-Electron-with-cross-platform)?
2. **App rename** — "Skillbase" is now the productName. Repo stays at `Steel-Type/skill-manager`, or rename the repo too?
3. **Apple Developer Program** ($99/year) — buy in for v0.3.0 to get real notarization, or stay ad-hoc-signed for free?
4. **Linux tier** — first-class support from day one, or tier-2 best-effort while Mac+Windows mature?
5. **Auto-updater** — defer to v0.4.0, or wire up Tauri's updater in Phase C? (Adds ~2–3 days but compounds: every future release auto-rolls.)

---

Last updated: 2026-05-09
