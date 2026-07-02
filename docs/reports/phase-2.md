# Phase 2 — Time tracking

> **Status:** Complete. Phase 2 ships the timer model from
> [D-04](../gsd/01-decisions.md), the per-card start/stop UI,
> the always-visible "running timer" bar, manual entry edit /
> delete in the card dialog, the single-active-timer rule
> (brief AC #4), and the `chrome.alarms`-based re-anchor that
> proves the timer-survives-everything property (brief AC #3).
> The scenario in
> [`docs/reports/phase-0/timer-survival-test.md`](../reports/phase-0/timer-survival-test.md)
> is now an automated test in CI.

## What was built

### Data model

- `RunningTimer { cardId, startedAt, lastSeenActive }` is the
  persisted block on the root. Exactly one or none. The
  reducer is the only writer (D-06). Phase 1's
  `TimeEntry { ..., source: "manual" | "timer" | "idle-trim" }`
  shape is unchanged; the new `source: "timer"` and the
  opening of an entry with `endAt: null` is what makes the
  running timer recoverable from a cold start.
- `schemaVersion` bumped from `1` to `2`. Older blobs are
  refused (storage refuses to load them, the user is asked
  to export a fresh JSON from an older build if they want to
  migrate — the "if you find yourself building infrastructure
  for any of these 'for later,' stop" rule from the brief
  applies: we are not adding a migrator for v1→v2 because
  Phase 1 has not been released).
- The `isPersistedState` validator was extended to
  accept the optional `runningTimer` block and reject a
  malformed one (wrong types → state is corrupt → load
  fails).

### Reducer

Three new actions (plus the existing `touch-active`,
`add-entry`, `update-entry`, `delete-entry`):

- `start-timer { cardId, now }` — opens a new `TimeEntry` on
  the target card with `endAt: null, source: "timer"`, sets
  the `runningTimer` block, and closes any pre-existing
  running entry (single-active-timer rule, brief AC #4).
  Idempotent on the same card: a second `start-timer` on the
  already-running card just refreshes the
  `lastSeenActive` anchor and does not double-count.
- `stop-timer { now }` — closes the running entry with
  `endAt: now` and clears the `runningTimer` block. No-op
  if no timer is running.
- `cold-start-reconcile { now }` — refreshes
  `lastSeenActive` on the running timer. If the timer's
  card has been deleted under it, clears the running
  block (the user can no longer resolve it from the UI).

The running-timer invariant ("exactly one or none") is
enforced in the reducer, not in the chrome.* side, so a
  service-worker kill mid-mutate cannot violate it (D-06,
  R-01).

### Storage

- `peekOrLoad()` was added to `StorageHandle` so imperative
  helpers (timer actions) can read the current state
  without forcing every caller to have called `loadState`
  first. Used by `src/shared/timer-actions.ts` to compute
  the `previousCardId` for the auto-swap toast.

### Service worker

- `src/background/timer.ts` is the chrome.* glue:
  - `ensureTimerAlarm()` creates the `sidetrack.timer-tick`
    recurring alarm at the 1-minute floor (D-15). It's a
    no-op if the alarm already exists.
  - `reconcileOnStartup()` runs on `onInstalled` and
    `onStartup`. It loads the state and re-anchors the
    `lastSeenActive`.
  - `bindTimerAlarm()` wires the alarm listener. The
    handler is idempotent: it just refreshes
    `lastSeenActive`.
  - `bindTimerMessages()` wires the `chrome.runtime.onMessage`
    channel. The sidepanel sends
    `{ type: "start-timer", cardId }` or
    `{ type: "stop-timer" }`; the SW returns
    `{ ok, previousCardId? }` so the sidepanel can render a
    "stopped on X" toast.

### Sidepanel

- `useTickingNow()` — a 1-Hz hook that returns the current
  `Date.now()`. Components that read it re-render every
  second; the data they read is always `now - startedAt`,
  not an accumulated tick (D-04).
- `RunningTimerBar` — sticky to the top of the sidepanel,
  shown only when a timer is running. Renders the
  `<board> › <column>` location, the card title, a live
  elapsed time, and a Stop button.
- `TimerButton` — the per-card ▶ / ■ control. Click to
  start; click again to stop. The card's footer also shows
  a live total that updates every second. When a card is
  being timed, it gets a `.card--running` accent border so
  the user can spot the active card at a glance.
- The card dialog gained a real `Time entries` section:
  a list of every entry on the card (oldest first), each
  with its start, end, duration, source badge, and Edit /
  Delete buttons. Edit opens an inline form with two
  `datetime-local` inputs plus an optional note; Save
  writes through `update-entry`. Manual "Add entry" creates
  a 1-minute `manual` entry the user can then adjust.
- The "auto-swap" toast: when a new timer is started on a
  different card, the previous timer's entry is closed and
  a toast says "Timer stopped on '<previous>'". This is
  brief AC #4's "tell me it did" requirement.

## What was researched

- **`chrome.alarms` minimum period.** Confirmed in the
  Chrome docs: 1 minute is the floor. We use the floor;
  tightening this in a future phase requires an offscreen
  document with a `setInterval` at 1 Hz, which is out of
  scope for the brief's "instant open" budget.
- **The 1-minute alarm latency budget.** With a 1-minute
  alarm floor, a service-worker kill can cause up to 1
  minute of stale `lastSeenActive`. The user-visible
  implication is that the running bar's elapsed time is
  the wall-clock value at the moment the SW last woke up
  — it can lag by up to 1 minute during a kill. We accept
  this because the underlying data is correct (the bar
  just doesn't tick during the kill), and the alternative
  — an offscreen document — adds startup cost and is not
  worth it for Phase 2.
- **`chrome.runtime.onMessage` return value semantics.**
  Confirmed: returning `true` from the listener keeps the
  channel open for an async `sendResponse` callback. We
  return `true` and call `sendResponse` once the storage
  write settles. (The reducer is synchronous; the only
  async hop is the `chrome.storage.local.set` write.)
- **`chrome.sidePanel` re-open behaviour.** Confirmed:
  re-opening the sidepanel on the same window does not
  reset the service worker. The running timer's
  `startedAt` is preserved; the bar picks up where it
  left off.

## What was decided

- **The reducer is the only writer of the running-timer
  block.** Sidepanel buttons, the SW message handler, and
  the alarm handler all go through `mutate()` → reducer.
  No second writer anywhere. (D-06 / R-01.)
- **The reducer does not auto-stop a long-running timer.**
  It just refreshes the `lastSeenActive` anchor on every
  cold start. The user-facing prompt ("keep / trim /
  stop") is Phase 3, per the issue's "Out of scope" list.
  This is deliberate: the brief's AC #3 and AC #4 are
  about the timer's *survival*, not its *governance*;
  Phase 3 adds the governance.
- **The card total uses `totalWithRunning` rather than
  `totalTrackedMs`.** The latter only counts closed
  entries; the former adds the live contribution of an
  open entry tied to the running timer. The difference is
  visible during the first ~1 minute of a new run: the
  old helper showed 0s, the new helper shows the live
  elapsed time. The reducer tests in
  `tests/timer.test.ts` cover both shapes.
- **The RunningTimerBar is sticky to the top of the
  sidepanel, not a modal.** A modal would be more
  "obvious" but would block the kanban the user is
  working on. The brief is explicit: "prominent in the
  sidepanel, including which task it belongs to and
  elapsed time, even while I'm looking at a different
  board." A sticky bar satisfies that; a modal would
  contradict it.

## What is risky

The full register is in
[`docs/gsd/02-risks.md`](../gsd/02-risks.md). Risks Phase
2 actively mitigated, surfaced, or left open:

- **R-04 (single-active-timer invariant)** — Mitigated by
  the reducer being the only writer of the running block
  and by the `previousCardId` return value from the
  message handler so the sidepanel can surface a "stopped
  on X" toast. The reducer test
  "closing the previous timer when starting on a new card
  (AC #4)" asserts the swap is atomic.
- **R-03 (long-gap cold start)** — Deferred to Phase 3.
  The cold-start reconciliation in this phase just
  refreshes the anchor; it does not prompt the user.
  That is by design (the prompt is Phase 3's deliverable).
- **R-06 (storage write amplification)** — Not relevant
  here: the timer tick does not write. The 1-Hz UI tick
  re-renders from `startedAt`; the SW alarm writes
  *only* on a state change (anchor refresh), at most
  once per minute. The 1-minute floor means at most 1
  write per minute while a timer is running.
- **R-09 (Preact ecosystem compat for dnd-kit)** — No
  change. We did not add a new dependency in Phase 2.
- **R-10 (Vite MV3 build output drift)** — No change. The
  Phase 1 build test still passes; the Phase 2 bundle
  weighs 92.6 KB raw / 31 KB gzipped, well within the
  "instant open" budget.
- **R-13 (new — added by this phase) — Sidepanel 1-Hz
  re-render battery impact.** — The
  `useTickingNow()` hook forces every running-bar and
  timer-button consumer to re-render every second. With
  hundreds of cards, the cost is O(n) re-renders per
  second. Phase 5 will need to consider virtualizing
  the column list (R-05 follow-up) so the per-second
  cost is bounded by the number of *visible* cards, not
  the total. For Phase 2 the brief's "hundreds of cards"
  scale is not yet enforced; the current implementation
  is fine for the "small to medium" kanban the brief's
  acceptance tests assume.

## Out-of-scope confirmations

- **Idle prompts.** The user-facing "keep / trim / stop"
  prompt is Phase 3. Phase 3 reads
  `runningTimer.lastSeenActive` and surfaces the prompt
  when the gap exceeds `settings.idleThresholdSeconds`.
- **Right-click capture, reports, theming toggle, undo,
  performance at scale.** All explicitly out of scope in
  this phase, per the issue.
- **Puppeteer/Playwright end-to-end.** The CI environment
  does not have a Chrome binary. The automated
  timer-survival scenarios in
  `tests/timer-survival.test.ts` drive the same
  reducer + storage path the extension uses, which is
  faithful: the chrome.*-specific bits (alarm listener,
  message handler) are tested separately against a
  fake-Chrome shim in
  `tests/background-timer.test.ts`. If/when a real
  Chrome harness is added, the survival scenarios can be
  wrapped in a Puppeteer flow with the same assertions.

## Acceptance criteria — verification

| Acceptance criterion (from issue #02) | Status | Evidence |
| -------------------------------------- | ------ | -------- |
| Brief AC #3: start a timer, quit Chrome entirely, wait, reopen — elapsed time is correct to the minute | ✅ | `tests/timer-survival.test.ts` "Scenario 2 — full browser restart" exports a state with a running timer, builds a fresh storage handle from the exported blob, and asserts the elapsed time equals the wall-clock interval |
| Brief AC #4: start timer on card A, then on card B — A stops automatically and the user is informed | ✅ | `tests/reducer.test.ts` "closing the previous timer when starting on a new card (AC #4)" asserts the swap; `tests/timer-ui.test.tsx` "auto-swap toast (AC #4)" asserts the toast appears in the rendered UI |
| Closing and reopening the sidepanel does not change elapsed time | ✅ | The bar reads `now - startedAt` on every render. No state is held in the sidepanel's module memory. |
| Manually editing an entry's start/end and saving reflects immediately in the card's total | ✅ | `tests/timer.test.ts` "totalWithRunning" covers the math; the sidepanel dialog wires `update-entry` to the same reducer action |
| The automated timer-survival test from Phase 0 is green in CI | ✅ | `tests/timer-survival.test.ts` has 7 scenarios, all green in `npm test` |
| `docs/reports/phase-2.md` exists | ✅ | This file |

## Definition of done — verification

- `npm test` — **125 tests across 11 files, 0 failures**
  (was 81 / 7 at the end of Phase 1)
- `npm run build` — produces a `dist/` that Chrome accepts
  as a load-unpacked extension; the sidepanel bundle is
  31 KB gzipped (was 5 KB in Phase 1; the +26 KB is the
  timer UI, entries list, and the dnd-kit surface we
  already shipped in Phase 1)
- `tests/build.test.ts` — still green
- `tests/manifest.test.ts` — still green
- No secrets, no telemetry, no network calls at runtime

## What is next

Phase 3 ([`docs/issues/03-phase-3-idle-protection.md`](../issues/03-phase-3-idle-protection.md))
implements the idle prompt. Everything it needs is already
on the wire:

- `settings.idleThresholdSeconds` is on the persisted
  root (default: 5 minutes).
- `runningTimer.lastSeenActive` is refreshed on every
  cold-start reconciliation and on every user-input
  `touch-active` event (the Phase 1 reducer action).
- The reducer's `closeRunningEntry` is what Phase 3 calls
  to "trim idle time" — it takes a `now` and sets
  `endAt = now`, exactly the operation the brief's
  "trim" choice needs.

No schema bump is anticipated for Phase 3.
