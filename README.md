# Claude Skill Manager

A macOS desktop app for managing [Claude](https://claude.ai) skills — those
`SKILL.md` / `AGENTS.md` folders that Claude Code, Cowork, and the Claude
Agent SDK pull in.

It gives you a real GUI for the things you'd otherwise do by hand:

- **Install** a skill from any GitHub URL (shallow clone, captures commit SHA)
- **Track** every skill's source URL, install/update timestamps, and which
  projects you've copied it into
- **Check for updates** across the whole library in parallel (`git ls-remote`)
- **Update** a skill — and cascade that update into every project where it's
  deployed
- **Roll back** a skill to a previous snapshot (configurable retention; default
  keeps 2 versions per skill)
- **Deploy** a library skill into any project's `.claude/skills/` directory
- **Browse** a skill's files as a tree, with double-click reveal in Finder
- **Bundle support** — repos with multiple `SKILL.md` files are detected and
  expanded
- **Power-user `⌘K` palette** with real command parsing
  (`install`, `deploy <skill> to <project>`, `update --all`, `rollback`,
  `rm`, `list --updates`, `help`, …)
- **Light + Dark themes** — warm cream/terracotta or sharp green-on-black
- **Export / Import** the whole library as a markdown bullet list

Library lives at `~/.claude/skills/`. Config lives at `~/.claude/skill-manager.json`.

## Tech stack

- **Electron 33** + **React 18** + **TypeScript** + **Vite 6**
- **zustand** for renderer state
- Frameless macOS-styled window with native traffic lights repositioned into
  the drawn titlebar (`titleBarStyle: 'hidden'` + `trafficLightPosition`)
- Strict CSP applied via response header injection (electron/main.ts) and a
  belt-and-braces `<meta>` fallback in `index.html`
- All git operations run in the main process via `child_process.spawn`,
  with argv-form arguments and a `--` separator to make URL injection
  impossible

The original v0.1 was a single-file Python + CustomTkinter app — preserved at
`legacy/skill-manager.py` for reference. The new app reads its config and
skill library from the same paths, so existing v0.1 users transition without
migration.

## Requirements

- macOS (chrome and traffic-light controls are macOS-styled)
- Node.js 20+
- `git` on your `PATH`

## Develop

```bash
git clone https://github.com/Steel-Type/skill-manager.git
cd skill-manager
npm install
npm run dev
```

`npm run dev` boots Vite, the Electron main process, and opens the window
with hot reload.

## Test

```bash
npm test            # vitest run — 65+ tests across validators, parsers, IPC
npm run typecheck   # both renderer (src/) and main (electron/) projects
```

The test suite focuses on security-critical code: input validators (URL,
skill name, project path, commit token), markdown export/import round-trip,
the YAML frontmatter parser (including a 5 MB-file stress test).

## Package

```bash
npm run dist
```

Produces `release/Skill Manager-<version>.dmg` with an unsigned `.app`
inside. First launch may need a right-click → Open to bypass Gatekeeper
since it's unsigned.

The icon is generated from `assets/icon.svg` by `scripts/build-icons.sh`,
which uses only macOS-native tools (`qlmanage`, `sips`, `iconutil`) — no
external dependencies. Re-run after editing the SVG.

## Use

1. Paste a GitHub URL into the **Install** bar at the top of the **Library**
   tab. The install screen shows live `git clone` output and a bundle
   preview if the repo contains multiple skills.
2. Click **Deploy** on a skill card to copy it into a project's
   `.claude/skills/` directory.
3. Click **Check updates** to run `git ls-remote` for every URL-backed
   skill. If anything is behind, a yellow banner offers a multi-step
   review → progress → summary screen with cancellation support.
4. Updates cascade to every project the skill is deployed to (toggle in
   **Settings → Behavior**). Each update archives the previous version as
   a snapshot under `~/.claude/skills-history/<name>/<sha>/`, configurable
   in **Settings → Snapshot retention**.
5. Click a skill card to select it; click **Open** (or double-click the
   card) to drop into the Skill Detail screen — full metadata, GitHub
   stats (★ stars, ⑂ forks, last push), file tree, deployments,
   snapshot count.
6. The **Deploy** tab lists every tracked project; remove tracking with
   optional file cleanup.
7. The **Settings** tab exposes paths, behavior toggles, theme switch
   (sun ↔ moon), snapshot retention, and config-file actions.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘K` (or Ctrl+K) | Toggle Library between card grid and command palette |
| `⌘1` / `⌘2` / `⌘3` | Jump to Library / Deploy / Settings |
| Arrow keys + ⏎ in palette | Navigate and trigger commands |
| `Esc` | Close modal, clear command-palette input |

## Security model

- Renderer runs sandboxed (`sandbox: true`) with context isolation and no
  Node integration
- Preload uses `contextBridge` to expose a typed `window.api` surface; no
  `AbortSignal` or other non-cloneable types cross the bridge — cancellation
  uses `streamId` + `cancelOperation` IPC instead
- All user-supplied strings (URLs, skill names, project paths, commits)
  pass through validators in `electron/services/validators.ts` before they
  touch the filesystem or `git`. Reject path-traversal, control chars,
  oversize, and `--`-prefixed values that could be parsed as git flags
- Atomic config writes via tmp + `fs.rename`; corrupt config detection
  with backup-and-recover
- Process-wide config mutex (`withConfigLock`) serialises every
  read-modify-write so parallel operations can't lose each other's edits
- Symlinks are filtered out of clones during `fs.cp` so a malicious repo
  can't smuggle a symlink to `/etc/passwd` into your library
- Strict CSP: `script-src 'self'`, `frame-ancestors 'none'`,
  `object-src 'none'`, `base-uri 'self'`, `connect-src` allow-list
  (Vite HMR in dev, `api.github.com` for stargazer fetches, Google Fonts)
- All `git` children tracked; SIGTERM'd on `before-quit`
- Renderer crash auto-reloads up to 3 times then surfaces a dialog
- Drag-and-drop blocked at both renderer (`dragover`/`drop` preventDefault)
  and main (`will-navigate` guard) layers

## Project layout

```
electron/
├─ main.ts              window lifecycle, IPC, CSP, child-process tracker
├─ preload.ts           typed window.api surface (contextBridge)
├─ operations.ts        high-level operations behind each IPC handler
└─ services/
   ├─ paths.ts          ~/.claude paths
   ├─ types.ts          Skill, AppSettings, Screen, TreeNode, …
   ├─ validators.ts     URL / skill-name / project-path / commit
   ├─ config.ts         load / save / reconcile, atomic writes, mutex
   ├─ skills.ts         frontmatter parser, detect_skill_type, getSkillTree
   ├─ git.ts            clone (with cancellation + symlink filter), ls-remote
   ├─ deploy.ts         copy + cascade to projects
   ├─ history.ts        snapshot archive / list / restore / reconcile
   └─ exportImport.ts   markdown bullet roundtrip

src/
├─ App.tsx              tab + screen routing, theme application, shortcuts
├─ state/store.ts       zustand: tabs, screens, modals, skills, settings
├─ lib/cancellable.ts   AbortController ↔ streamId bridge for IPC
├─ components/
│  ├─ AppWindow.tsx        sketchy macOS chrome
│  ├─ LeftRail.tsx         persistent sidebar (VerticalNav + filters)
│  ├─ VerticalNav.tsx      Library / Deploy / Settings vertical tab strip
│  ├─ FilterRail.tsx       library filter pills + tracked-projects mini-list
│  ├─ ThemeToggle.tsx      sun ↔ moon
│  ├─ ScreenShell.tsx      shared "Back" chrome for full-pane screens
│  ├─ Modal.tsx            generic popup with focus trap
│  ├─ SkillCard.tsx        library card (hover pop, click → Open inline)
│  ├─ OverflowMenu.tsx     ⋯ dropdown
│  ├─ CommandPalette.tsx   ⌘K with real command parsing
│  ├─ LayoutToggle.tsx     cards ↔ palette slider
│  ├─ UpdateBanner.tsx
│  └─ InstallBar.tsx
├─ views/
│  ├─ LibraryView.tsx      card grid + install bar + filter results
│  ├─ DeployView.tsx       tracked projects
│  └─ SettingsView.tsx     paths, behavior, theme, retention
└─ flows/
   ├─ InstallFlow.tsx      modal — paste URL, watch git, see bundle preview
   ├─ UpdateFlow.tsx       SCREEN — 3-step review → progress → summary
   ├─ SkillDetailFlow.tsx  SCREEN — meta, tree, GH stats, deployments
   ├─ RollbackFlow.tsx     modal — pick snapshot, optionally cascade
   ├─ RemoveSkillFlow.tsx  modal — leave / cascade-clean radios
   ├─ RemoveProjectFlow.tsx modal — same pattern for project tracking
   └─ DeployFlow.tsx       modal — pick project, deploy

design-reference/         original wireframes (Skill Manager Wireframes.html, JSX, CSS)
legacy/                   v0.1 Python + CustomTkinter implementation, frozen
assets/                   icon source (SVG) + built .icns
scripts/                  build-icons.sh
DARK_THEME.md             dark theme spec
LIGHT_THEME.md            wireframe-cream spec
```

## Theme system

The app ships with two complete themes; user choice is persisted in
`~/.claude/skill-manager.json` under `settings.theme`.

| | Light (default) | Dark |
|---|---|---|
| Page background | `#fdfcf8` warm cream | `#050505` near-black |
| Surface (sidebar/cards) | `#f5f3ec` | `#111213` |
| Primary ink | `#2a2a2a` | `#f0f2f4` |
| Accent CTA | `#c96442` terracotta | `#3ee07a` green |
| Slider accent | `#3d6e8c` slate blue | `#5ea3d0` lighter slate |
| Heading font | Caveat (hand-drawn) | Caveat (kept for continuity) |
| Body font | Kalam | Kalam |
| Mono | JetBrains Mono | JetBrains Mono |

The dark theme inherits all radii, shadows, and the wireframe shape language
from light — only colors swap. See `LIGHT_THEME.md` and `DARK_THEME.md` for
the full token tables.

## License

MIT — see `LICENSE`.
