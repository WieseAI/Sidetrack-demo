# Timer-survival test scenario (Phase 0 → Phase 2)

> **Owner:** Phase 2 (time tracking). This document is the *script*;
> Phase 2 automates it. The script proves the brief's "the timer must
> survive everything" requirement (brief AC #3) and the related
> "single-active-timer" rule (AC #4).

## What we are testing

The brief's non-negotiable: **"If I started a timer at 09:00 and
reopen Chrome at 11:00, the timer shows 2 hours. Never lose or drift
tracked time."** Concretely:

1. After the timer has been running for a wall-clock interval, the
   visible elapsed time is `now − start_at` (anchored), not a
   accumulated tick count.
2. A service-worker kill (Chrome can do this at any time after ~30 s
   of inactivity) does **not** reset or pause the timer.
3. A browser restart does **not** reset or pause the timer.
4. Putting the computer to sleep and waking it does **not** reset
   or pause the timer.
5. The single-active-timer rule is honored: starting a timer on
   card B while card A is running closes card A's running entry and
   opens a new one on card B.

## Architectural assumptions this scenario depends on

- The data layer persists the running timer's `start_at` (and the
  card it belongs to), not a tick count. See D-04 in
  [`docs/gsd/01-decisions.md`](../../gsd/01-decisions.md).
- A `chrome.alarms` tick (1-minute floor in production, D-15) wakes
  the service worker so the running timer re-anchors after a kill.
- All mutations go through a single `mutate(fn)` helper that holds a
  serialization lock (D-06, R-01).
- The service worker reconciles state on cold start: if a timer was
  running and `now − last_seen_active > threshold`, it leaves the
  decision to the user-facing prompt in Phase 3; otherwise it
  re-anchors the alarm and continues.

## The test (manual script in Phase 0; automated in Phase 2)

### Setup

1. Build and load the unpacked extension from `dist/`.
2. Open the sidepanel; the empty state is visible.
3. Use the Phase 1 default board to create two cards:
   - Card A: "Survival target"
   - Card B: "Single-active replacement"
4. Verify both cards render with a "Start" button.

### Scenario 1 — service-worker kill while a timer is running

1. Click **Start** on card A. Note the displayed start time
   (HH:MM:SS).
2. Wait 30 s. The sidepanel should show the elapsed time updating
   every second.
3. Open `chrome://serviceworker-internals`, find Sidetrack's
   service worker, and click **Stop**. The service worker is killed.
4. Wait 60 s. (Past the 1-minute alarm floor; the service worker
   should wake up at the next alarm tick and re-anchor.)
5. Open the sidepanel again. The running timer on card A must show
   a non-zero elapsed time equal to the wall-clock time since the
   start, **minus** the time the service worker was dead plus the
   1-minute alarm latency. The total drift must be within ±1 minute
   of the wall-clock interval.
6. **Pass criteria:** elapsed time is within 60 s of the wall-clock
   interval since step 1. Drift greater than 60 s is a fail.

### Scenario 2 — full browser restart while a timer is running

1. Click **Start** on card A. Note the start time.
2. Wait 30 s. Verify the sidepanel shows ~30 s elapsed.
3. Quit Chrome entirely (not just close the window; `Cmd+Q` on macOS,
   close all windows on Win/Linux). Wait 5 minutes.
4. Reopen Chrome. Open the sidepanel. Click on card A.
5. **Pass criteria:** card A's running timer shows an elapsed time
   within 60 s of `5:30` (the 30 s of step 2 plus the 5 min of step
   3). Drift greater than 60 s is a fail. (The "within 60 s" margin
   accounts for the 1-minute alarm floor on the post-restart
   re-anchor; the actual persisted time is the wall-clock value.)

### Scenario 3 — sleep / wake

1. Click **Start** on card A. Note the start time.
2. Wait 1 minute. Verify the sidepanel shows ~60 s elapsed.
3. Put the computer to sleep (close the lid, or `pmset sleepnow` on
   macOS, or `systemctl suspend` on Linux). Wait 10 minutes.
4. Wake the computer. Open the sidepanel.
5. **Pass criteria:** card A's running timer shows an elapsed time
   within 60 s of `11:00` (the 1 min of step 2 plus the 10 min of
   step 3).

### Scenario 4 — single-active-timer rule (AC #4)

1. Click **Start** on card A. Wait 30 s.
2. Click **Start** on card B.
3. **Pass criteria:**
   - Card A's running entry is closed with `endAt = now` and the
     sidepanel shows a toast saying "Timer stopped on card A."
   - Card B has an open running entry starting at the time of the
     click.
   - The persisted `RunningTimer` block references card B (not
     card A).
   - The total tracked time on card A is the elapsed time of the
     first run (~30 s), not 0 and not the time-since-B-was-started.

### Scenario 5 — long-gap cold start (deferred to Phase 3)

This is the R-03 case ("browser was closed for hours"). Phase 0
defers the test to Phase 3 because the user-facing prompt (keep /
trim / stop) is the Phase 3 deliverable. The test exists in
[`docs/issues/03-phase-3-idle-protection.md`](../../issues/03-phase-3-idle-protection.md).

## What this test does **not** cover

- The live idle prompt (Phase 3). Scenarios 5 above.
- Right-click capture (Phase 4).
- Time entries with manual edit/delete (Phase 2's own scope, not the
  survival property).
- Concurrent devices or multiple windows. Sidetrack is a
  single-window, single-user app by design (D-11).

## Implementation notes for Phase 2

- The test runs against the **real extension** in headless Chrome
  via Puppeteer or Playwright. Driving the sidepanel from a Puppeteer
  script is more honest than mocking the chrome.* APIs in
  happy-dom — the survival property is exactly the thing that mocks
  would silently break.
- The CI smoke test for this is a separate concern: Phase 2 may
  decide to run this in a slow lane (≥10 minutes per scenario × 4
  scenarios) on a cron schedule rather than on every PR. The repo
  does not yet have CI; the test can be invoked manually with
  `npm run test:survival` once Phase 2 adds it.
- The "drift must be within 60 s" threshold is the 1-minute alarm
  floor. If Phase 5 introduces a different alarm strategy (e.g. an
  offscreen document with a 1-Hz `setInterval` while the sidepanel
  is open), tighten the threshold accordingly.

## Out-of-band checks the human reviewer should do

- Open the DevTools console on the sidepanel and verify that no
  warnings or errors are logged during any of the four scenarios.
- Open `chrome://extensions`, click "Service worker" on Sidetrack's
  card, and verify the worker console shows the `chrome.alarms`
  re-anchor log after each kill.
- Export the data layer to JSON (brief AC #8) after each scenario
  and verify the `RunningTimer` block has the expected `cardId` and
  `startedAt`.
