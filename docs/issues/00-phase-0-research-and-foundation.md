<!-- labels: phase-0, gsd, research -->

# Phase 0 — Research & foundation

## User story

As a user opening Sidetrack for the first time, I see a polished, working
sidepanel in under 30 seconds and the developer can describe exactly which
Chrome APIs power it and why.

## Phase goal

Lock every architectural decision, scaffold the repo, ship a loadable
skeleton extension with an empty sidepanel, and prove the
timer-survives-everything strategy with a written test scenario.

## Scope

- Research and document, in [`docs/gsd/01-decisions.md`](../gsd/01-decisions.md):
  - Chrome extension architecture for the current stable Chrome
    (Manifest V3, service-worker lifecycle, sidepanel API).
  - Storage options for this kind of data
    (`chrome.storage.local` vs. IndexedDB vs. OPFS) and our choice.
  - Notification and idle-detection APIs (`chrome.alarms`,
    `chrome.idle`, `chrome.notifications`).
  - Context menus (`chrome.contextMenus`) for the Phase 4 capture
    feature, so we know the API is available before we commit to it.
  - Build tooling (Vite + TypeScript, MV3-compatible output).
  - UI library (Preact vs. React) — pick one, record why.
  - Drag-and-drop approach for Phase 1 (HTML5 DnD vs. a library).
- Lock the decisions and update `01-decisions.md`'s "What is *not*
  decided yet" section to empty.
- Set up the repo:
  - `manifest.json` (MV3), `package.json`, `tsconfig.json`, `vite.config.ts`.
  - `src/background/` for the service worker.
  - `src/sidepanel/` for the sidepanel UI.
  - `src/shared/` for the data model and `mutate(fn)` helper.
  - `docs/reports/phase-0.md` summarizing what was built, what was
    researched, what's risky, what's next.
- Empty sidepanel renders, toolbar action opens it, the extension loads
  unpacked in a clean Chrome profile with zero console errors.
- Write a "timer-survives-everything" test scenario as a Markdown
  document under `docs/reports/phase-0/timer-survival-test.md`. This is
  the script Phase 2 will automate.

## Out of scope

- Any user-visible feature. This phase ends with a **loadable skeleton**,
  not a usable product.
- Performance benchmarking at scale. That happens in Phase 1 / Phase 5.
- Choosing the final idle-threshold default. We pick "configurable,
  sensible default" here; the number itself is finalized in Phase 3.

## Acceptance criteria

- [x] `docs/gsd/01-decisions.md` is updated with the final decision on
      every open sub-decision in its "What is *not* decided yet" list.
- [x] `docs/gsd/02-risks.md` has been reviewed and any new risks
      surfaced by this phase's research are added.
- [x] `npm install && npm run build` produces a `dist/` that Chrome
      accepts as a load-unpacked extension with no warnings about
      manifest fields.
- [x] Clicking the toolbar action opens the sidepanel, which shows a
      styled empty state with the project name and version.
- [x] `docs/reports/phase-0.md` exists and follows the "what was
      built / what you researched / what's risky / what's next" template
      from the brief.
- [x] The `docs/reports/phase-0/timer-survival-test.md` test scenario
      exists and is referenced from the Phase 2 issue.

## Dependencies

- None. This is the first phase.

## Definition of done

A reviewer can clone the repo, run `npm install && npm run build`, load
`dist/` in `chrome://extensions` (Developer mode → Load unpacked), and
see the empty sidepanel. The reviewer can read `01-decisions.md` and
`02-risks.md` and be confident the team knows what it's doing.
