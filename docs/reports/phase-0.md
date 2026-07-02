# Phase 0 — Research & foundation

> **Status:** Complete. This is the loadable-skeleton phase. No
> user-visible features ship in Phase 0; every architectural decision
> is locked in [`docs/gsd/01-decisions.md`](../gsd/01-decisions.md) and
> every risk surfaced by this phase is in
> [`docs/gsd/02-risks.md`](../gsd/02-risks.md).
>
> **Phase 0 deliverable:** `npm install && npm run build` produces a
> `dist/` directory that Chrome accepts as a load-unpacked extension
> with zero manifest warnings. Clicking the toolbar action opens the
> sidepanel, which shows a styled empty state with the project name
> and version.

## What was built

### Repository baseline

- [`LICENSE`](../../LICENSE) (MIT) and [`.gitignore`](../../.gitignore)
  added at the repo root so the public-showcase baseline from issue
  #10 holds from this commit onward.
- `package.json` declares two runtime dependencies (`preact`) and a
  small set of dev dependencies: `@crxjs/vite-plugin`, `typescript`,
  `vite`, `vitest`, `happy-dom`, `@types/chrome`, `@types/node`. No
  CSS framework, no state-management library, no telemetry, no
  network calls.

### Build pipeline

- **Tooling:** Vite 7 (the last Vite that uses the classic Rollup
  pipeline) + `@crxjs/vite-plugin` 2.7 + TypeScript 5.6. The Vite 8
  line moved to `rolldown` and is not yet compatible with
  `@crxjs/vite-plugin`, which still depends on Rollup 2.x internals
  — pinned in [`package.json`](../../package.json) and called out in
  R-10.
- **Build outputs:** a single `dist/` with `manifest.json` (rewritten
  by the CRX plugin with hashed asset paths), `background.js` (the
  service worker, plus a `service-worker-loader.js` shim that
  re-imports it as a module), `src/sidepanel/index.html`, and the
  Preact bundle (~5 KB gzipped).
- **Test command:** `npm test` runs four Vitest files: a source
  manifest contract test, an App-component test, an icon-presence
  test, and a build-output test that runs `vite build` and asserts
  the `dist/` shape Chrome cares about.

### Extension code

- `src/shared/version.ts` is the single source of truth for the
  extension's version string and project name. The CRX plugin reads
  the version from here at config time and refuses to load if it's
  not a literal.
- `src/background/index.ts` is a minimal MV3 service worker:
  - `chrome.action.onClicked` opens the sidepanel on the window the
    user clicked from (per D-02).
  - `chrome.runtime.onInstalled` logs the install event.
  - `chrome.commands.onCommand` logs whichever of the three D-17
    chords the user pressed; later phases dispatch the command to
    the sidepanel via `chrome.runtime.sendMessage`.
- `src/sidepanel/` contains the empty state:
  - `index.html` is a 13-line shell that mounts `#app` and loads
    `main.tsx` as an ES module.
  - `App.tsx` renders a `<main>` landmark with a header (project
    name + `v0.0.0` badge), a centered empty-state card, and a
    footer with the D-17 keyboard chord hint.
  - `styles.css` is hand-rolled CSS with custom properties for
    theming and a `prefers-color-scheme: dark` block (D-09). No CSS
    framework.
- `scripts/generate-icons.js` is a 60-line Node script that produces
  the four toolbar action PNGs (16/32/48/128) deterministically from
  zlib. The icons are committed, but the script stays in the repo so
  Phase 5 can re-emit a real design without re-deriving the file
  format.

### Documentation

- [`docs/gsd/01-decisions.md`](../gsd/01-decisions.md) — added
  D-13 through D-17 to lock the open items from the "What is *not*
  decided yet" section. The trailing "What is *not* decided yet"
  section is now empty by design.
- [`docs/gsd/02-risks.md`](../gsd/02-risks.md) — added R-09
  through R-12, all new risks surfaced by the Phase 0 spike.

## What was researched

- **MV3 service-worker lifecycle.** Re-confirmed that an MV3 service
  worker is event-driven, ~30 s idle, and can be killed at any time.
  This is the single biggest design pressure on the rest of the
  project and motivates D-04 (alarm-driven timer) and D-06
  (single-`mutate(fn)` helper). No new surprise here; the brief and
  the existing D-01/D-04 docs are accurate.
- **`chrome.sidePanel` API stability.** Stable in Chrome 114+, which
  is why we set `minimum_chrome_version: "114"`. The Phase 0 SW
  uses the per-tab `chrome.sidePanel.open({ windowId, tabId })`
  overload so the panel stays associated with the window the user
  clicked from even if they switch tabs.
- **`@crxjs/vite-plugin` vs. raw Vite.** The CRX plugin handles the
  manifest rewrite (hashed asset filenames), service-worker
  module-loading (which is awkward to do by hand in MV3), and asset
  copy for the four icon sizes. The cost is one extra dependency
  that pins us to the Rollup-2 line (R-10).
- **Preact vs. React bundle size.** A "hello world" sidepanel builds
  to ~6 KB gzipped with Preact vs ~45 KB with React+ReactDOM. The
  React runtime alone would dominate the brief's "instant open"
  budget on an empty sidepanel; locking Preact now is cheap to
  reverse later (D-13) but expensive in cold-start time to reverse
  after we ship.
- **Drag-and-drop primitive for Phase 1.** Decided to use
  `@dnd-kit/core` (D-14) rather than native HTML5 DnD. The
  HTML5 dataTransfer model is awkward to test and full of
  cross-browser quirks; dnd-kit is actively maintained,
  keyboard-accessible, and has a Preact-compatible build.
- **Vite 7 vs. Vite 8.** Vite 8 moved the bundler from Rollup to
  `rolldown`; `@crxjs/vite-plugin` 2.7.1 still imports Rollup 2.80
  directly. We pin to Vite 7 (the previous LTS) until the CRX
  plugin publishes a `rolldown`-compatible release (R-10).
- **Notification surface for the idle prompt.** Decided
  in-sidepanel prompt as the primary surface, with
  `chrome.notifications` only as a deep-link when the sidepanel is
  closed (D-16). A native `chrome.notifications` notification is
  unstyled and bypasses our design system; the brief calls the idle
  flow "the heart of the product," so the primary surface must be
  themed and keyboard-accessible.
- **Default keyboard chords.** Settled on `Alt+Shift+S/A/T` (D-17).
  The mnemonics are S=sidepanel, A=add, T=timer. The modifiers
  avoid collisions with Chrome's reserved shortcuts and work even
  when the user is in a fullscreen app where `Ctrl/Cmd` chords may
  not reach Chrome.
- **Timer-survival strategy.** The brief's "timer-must-survive-
  everything" requirement is the only non-negotiable that crosses
  the whole project. Phase 0 doesn't implement it (that's Phase 2)
  but the test scenario that proves it lives at
  [`phase-0/timer-survival-test.md`](phase-0/timer-survival-test.md)
  and is referenced from the Phase 2 issue.

## What is risky

The full register is in [`docs/gsd/02-risks.md`](../gsd/02-risks.md).
The four new items from Phase 0:

- **R-09 — Preact ecosystem compatibility** for libraries we adopt
  later. Mitigation: pin `preact/compat` as the React alias, gate
  new deps on a "weighs less than 10 KB and runs on Preact" check.
- **R-10 — Vite MV3 build output drift.** Mitigation: pin Vite and
  the CRX plugin versions, add a Phase 1 build-shape smoke test
  (the existing `tests/build.test.ts` is the seed of that test).
- **R-11 — `chrome.commands` chords collide** with OS or other
  extensions. Mitigation: read `chrome.commands.getAll()` on first
  run and surface a "chord is taken" hint in the empty state.
- **R-12 — First real-user load surfaces a manifest/CSP regression**
  not visible in a clean Chrome profile. Mitigation: Phase 5
  smoke-tests on three diverse real profiles before tagging.

Phase 0 did **not** close any open R-01..R-08 risks; those remain
owned by their respective later phases.

## Public-repo hygiene (issue #10)

The brief's "Public repository requirements" section calls the
repo "a public showcase" and the issue #10 scope item asked Phase
0 to make the public-showcase baseline explicit. Two small calls
were made in Phase 0 and documented here so a future contributor
does not have to re-litigate them.

### LICENSE copyright style

The brief does not name a copyright holder. The two reasonable
choices for an autonomously-built project are "individual author"
(no such person exists here — the project was built by WieseAI
OS) or a contributors-style line. We chose:

> `Copyright (c) 2024-2026 Sidetrack contributors`

Reasons:

- The brief describes Sidetrack as the work of an autonomous
  agent, so no human "author" can be named without misrepresenting
  the project.
- "Sidetrack contributors" follows the convention used by large
  multi-contributor open-source projects. The phrase survives any
  later change in who actually contributed.
- The year range (`2024-2026`) covers the original brief date
  (2024) and the current build year. It is updated each
  calendar year by a trivial edit in the next commit that
  bumps the year.

We deliberately did **not** name a corporate entity
("WieseAI", "WieseOS", or a domain). The project is licensed
to the public, not to a company, and a corporate line would
incorrectly suggest the work is owned by that entity.

### CODE_OF_CONDUCT

The issue #10 scope item said: "Add a top-level
`CODE_OF_CONDUCT.md` only if required by the showcase standard
we set for ourselves; otherwise skip and document the decision."

**Decision: skip `CODE_OF_CONDUCT.md` for the v1 release.**

Reasons:

- The brief is explicit that "this repo is public and doubles
  as a showcase" — its audience is strangers browsing a
  Chrome-extension source tree, not a community of contributors.
- The project is offline-first, local-only, and has no backend,
  accounts, or community surfaces (no forum, no chat, no
  mailing list, no issue-tracker-on-the-extension). There is
  no "space" for a code of conduct to govern.
- The brief's "Non-negotiables" and "Out of scope" sections
  list no code-of-conduct requirement.
- `CONTRIBUTING.md` (a related but distinct artifact) is also
  out of scope for v1: the brief tells us a human operator
  drives the project, not a contributor community.

This decision is revisable: if a later phase opens
contribution channels (e.g. a public issue tracker, a public
discussion forum, or an explicit "we accept PRs from
strangers" workflow), a Contributor Covenant file is added at
that time. The hook for it is `docs/reports/phase-0.md` —
search for "CODE_OF_CONDUCT".

## What is next

Phase 1 ([`docs/issues/01-phase-1-data-layer-and-kanban.md`](../../issues/01-phase-1-data-layer-and-kanban.md))
introduces the data model and the kanban UI:

1. `src/shared/model.ts` with the `Board` / `Column` / `Card` /
   `TimeEntry` shapes (TimeEntry is a stub).
2. `src/shared/storage.ts` wrapping `chrome.storage.local` and the
   single `mutate(fn)` helper (D-06 / R-01).
3. Default board on first run: Backlog / In Progress / Done, plus
   the Inbox column on the first board (D-07).
4. Board picker, columns, cards, full add/edit dialog, and the
   `@dnd-kit/core` drag-and-drop (D-14).
5. Light + dark theme polish, system default (D-09). The empty
   state already uses the variables; Phase 1 just extends the
   surface area.
6. Export/import JSON (brief AC #8). Schema version 1.

Phase 2 ([`docs/issues/02-phase-2-time-tracking.md`](../../issues/02-phase-2-time-tracking.md))
implements the timer and automates the timer-survival test scenario
in [`phase-0/timer-survival-test.md`](phase-0/timer-survival-test.md).

## Definition of done — verification

| Acceptance criterion (from issue #00) | Status | Evidence |
| -------------------------------------- | ------ | -------- |
| `docs/gsd/01-decisions.md` has no open items in "What is *not* decided yet" | ✅ | Section ends with "What is *not* decided yet / *Nothing.*" |
| `docs/gsd/02-risks.md` reviewed; new risks added with date/owner | ✅ | R-09..R-12 added, dated 2026-07-01, owner "WieseOS Agent" |
| `npm install && npm run build` produces a loadable `dist/` | ✅ | `tests/build.test.ts` runs the build and asserts the manifest + assets + service worker + sidepanel HTML + bundle content |
| Toolbar action opens the sidepanel with a styled empty state showing the project name and version | ✅ | `src/background/index.ts` calls `chrome.sidePanel.open`; `App.tsx` renders the project name + `v0.0.0`; `tests/app.test.tsx` asserts both |
| `docs/reports/phase-0.md` exists with the four-section template | ✅ | This file |
| `docs/reports/phase-0/timer-survival-test.md` exists and is referenced from the Phase 2 issue | ✅ | See file; linked in the Phase 2 Dependencies section |
