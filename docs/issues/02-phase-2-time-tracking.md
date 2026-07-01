<!-- labels: phase-2, gsd, time-tracking -->

# Phase 2 — Time tracking

## User story

As a user, I can start a timer on any card, see the running timer
prominently in the sidepanel no matter which board I'm on, and trust
that elapsed time is correct after closing the sidepanel, restarting
the browser, or putting the computer to sleep.

## Phase goal

Implement the timer model from D-04, prove the
"timer-must-survive-everything" requirement with an automated test,
and ship the timer UI in the sidepanel.

## Scope

- Extend the data model:
  - `TimeEntry { id, cardId, startAt, endAt, source: 'manual' | 'timer' | 'idle-trim', note? }`
  - `RunningTimer { cardId, startedAt, lastSeenActive }` on the
    persisted root (exactly one or absent — enforced by the
    `mutate(fn)` lock from R-04).
- Service worker:
  - `startTimer(cardId)`: stops any existing running entry
    (creating a closed `TimeEntry` for it), starts a new one.
  - `stopTimer()`: closes the current running entry.
  - On cold start, reconcile state: if a running timer exists and
    `Date.now() - lastSeenActive > threshold`, leave it for Phase 3 to
    handle; otherwise, leave it running and re-register the alarm.
  - `chrome.alarms` tick (1-minute floor) to re-anchor after a
    service-worker kill. Alarm handler is idempotent.
- Sidepanel:
  - Start/stop button on every card.
  - Prominent "running timer" display at the top of the sidepanel,
    showing card title, board/column, and live elapsed time
    (recomputed every second from the anchor).
  - Per-card total tracked time.
  - Per-card "time entries" view (a list of entries) with manual
    edit (change start/end) and delete.
  - Toast when starting a timer on a new card automatically stops
    the previous one.
- Automate the
  `docs/reports/phase-0/timer-survival-test.md` (created in Phase 0)
  scenario from Phase 0. The test must drive the actual extension
  (or a faithful headless harness) and assert the elapsed time is
  correct to the minute after a forced restart.

## Out of scope

- Idle prompts and "trim" UX. The reconciliation on cold start is in
  this phase but the user-facing prompt for the gap is Phase 3.
- Right-click capture, reports.
- Performance at hundreds of cards (Phase 5).

## Acceptance criteria

- [ ] Brief AC #3 passes: start a timer, quit Chrome entirely, wait,
      reopen — elapsed time is correct to the minute.
- [ ] Brief AC #4 passes: start timer on card A, then on card B — A
      stops automatically and the user is informed.
- [ ] Closing and reopening the sidepanel does not change elapsed time.
- [ ] Manually editing an entry's start/end and saving reflects
      immediately in the card's total.
- [ ] The automated timer-survival test from Phase 0 is green in CI
      (or a documented local harness if CI is not yet wired up).
- [ ] `docs/reports/phase-2.md` exists and includes the test output
      and a brief retro of anything that surprised us.

## Dependencies

- [Phase 1 — Data layer & kanban core](01-phase-1-data-layer-and-kanban.md)
- The `docs/reports/phase-0/timer-survival-test.md` scenario from Phase 0

## Definition of done

The brief's AC #3 and AC #4 both pass. The user can use Sidetrack as
a single-user time tracker on top of a kanban board. The
timer-survives-everything promise is enforced by a test, not a
hope.
