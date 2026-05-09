# TODO

Ideas captured during conversations that are not yet scheduled into a sprint.

## Library

- **Filter toggle for the command palette** — Today the palette ignores the
  FilterRail selection and searches the full library. Add a toggle (icon next
  to the LayoutToggle?) so power users who *want* the palette to honour the
  active filter can opt in. Pair with a Settings → Library option for the
  default behaviour (ignore filter / honour filter). Default: ignore filter.

## UI polish (deferred from setup-sprint follow-up)

- **Type scale rationalization** — SetupFlow + a few other places use a
  sprawled set of font sizes (11/12/13/14/17/18/20/22/28/56). The
  ui-ux-pro-max-skill review flagged this as Low severity. Pin to a
  modular scale (skill suggests 12/14/16/18/24/32). Cosmetic; ~30+
  inline `fontSize:` touches across SetupFlow and detail screens.

## Known limitations

- **Single-file agents (cursor) can't deploy package-tier entries** —
  `deployToProject` for cursor expects `<src>/SKILL.md`. Package-tier
  entries (awesome-claude-code-style: `scripts/`, `data/`, no
  identifier) have no SKILL.md, so a cursor deploy of one would fail
  or produce a broken symlink. Skill/bundle tiers work fine.
  Workaround: don't pick cursor as primary if you rely on packages.
  Real fix: when packaging-tier deploys to a single-file agent, write
  a synthesized stub SKILL.md or refuse cleanly with a clear error.

- **`removeStackFromHomeLibrary` IPC + store action have no UI surface** —
  intentionally removed per the "populate, don't toggle" philosophy
  (commit 4d7d946). The path to take a stack out of the home library
  is to delete the stack entirely. If we ever decide power users
  need a way back without deleting, the IPC is ready — just needs a
  Settings → Advanced or stack-detail "danger zone" affordance.

## Hardening

- **MigrationFlow back-button while running** — spec says "not
  cancellable once started." Phase D landed the migration logic but
  we didn't re-verify the back-button is actually disabled mid-run
  in this session. Worth a manual check + maybe a unit test.

- **`scanForExistingSkills` against very deep / very wide trees** —
  `detectSkillType`'s `findNestedSkills` walks the whole tree skipping
  the noise dirs. No depth/breadth cap. A pathological repo (huge
  monorepo cloned as a "skill") could lock the main process. Add a
  cap matching `getSkillTree`'s TREE_MAX_DEPTH/TREE_MAX_NODES.

- **Stress test coverage** — `stress.kendalls-juice.test.ts` covers
  the happy paths + a few error cases. Could expand to:
  - Concurrent deploy of the same stack to two projects
  - Library moved mid-deploy (path validation race)
  - Symlink-back fails after a successful move (partial-success
    path is already handled but lacks a regression test)
  - Migration with a live deployment that uses an absolute symlink
    pointing into the OLD library (do we update those?)

## Out of session scope (parked for later)

- **Push to origin** — branch is 67 commits ahead of `origin/main`.
  Push when ready; no upstream conflicts known.
