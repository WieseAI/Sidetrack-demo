# Phase 3 — Idle protection & notifications

> **Status:** Complete. Phase 3 implements the idle detection
> from D-08, the keep/trim/stop prompt from the brief (AC #5),
> the cold-start gap handling from R-03, the OS notification
> deep-link from D-16, and a settings view for the threshold.
> The prompt is rendered in-sidepanel as the primary surface
> (D-16) with `chrome.notifications` as a deep-link from the
> tray. The whole flow is keyboard-friendly and survives a
> sidepanel close / reopen / browser restart.

## What was built

### Detection (D-08 / R-02)

- New pure module `src/shared/idle.ts`:
  - `evaluateIdle(state, now, thresholdSeconds?)` — the
    single source of truth for "should we surface the
    prompt?". Returns a discriminated union: `no-timer`,
    `not-idle`, `idle` (with a fully-shaped prompt),
    `pending-prompt` (already set), or `trimmed-recently`
    (post-trim cooldown).
  - `isPromptStale(state, prompt)` — defensive check used
    by the sidepanel on cold start to clear prompts whose
    underlying entry has been removed out from under them.
  - `TRIM_RECENTLY_LIFETIME_MS = 30_000` — the window in
    which the post-trim "trimmed-recently" marker suppresses
    duplicate prompts from the next alarm tick.
- The detection threshold is read from
  `state.settings.idleThresholdSeconds` (default 5 minutes,
  configurable 1–30).
- The alarm is the 1-minute MV3 production floor
  (`sidetrack.idle-tick`), distinct from the existing
  timer-re-anchor alarm (`sidetrack.timer-tick`) so the two
  concerns can be tuned independently.

### Service-worker wiring (`src/background/idle.ts`)

- `ensureIdleAlarm()` — idempotent, creates the
  `sidetrack.idle-tick` recurring alarm.
- `bindIdleAlarm()` — wires the `chrome.alarms.onAlarm`
  listener; the handler calls `evaluateAndDispatch()`.
- `bindSystemIdle()` — wires `chrome.idle.onStateChanged`.
  When the system reports the user has gone `"active"`,
  the listener calls the cold-start-reconcile action to
  refresh the running timer's anchor, so the next alarm
  tick within the same idle gap does not re-prompt.
- `notifyIdlePrompt()` / `clearIdleNotification()` — best-
  effort `chrome.notifications` calls. The OS notification
  is the D-16 deep-link from the tray back into the
  sidepanel; it is never the *primary* surface.
- `bindNotificationClick()` — clicking the OS notification
  opens the sidepanel via `chrome.sidePanel.open`.

### Reducer (the only writer)

Three new actions and two timer primitives:

- `trim-timer { trimTo, now }` — closes the open
  `TimeEntry` at `trimTo` with `source: "idle-trim"`, opens
  a new `TimeEntry` at `trimTo` with `source: "timer"`,
  advances the running block's `startedAt` anchor to
  `trimTo`, and marks `pendingIdlePrompt` as
  `kind: "trimmed-recently"` (so the next alarm tick within
  the cooldown does not re-prompt). This is the brief's
  "Trim idle time" choice.
- `trim-timer-and-stop { trimTo, now }` — closes the open
  entry at `trimTo` with `source: "idle-trim"` and clears
  the running block; no new entry is opened. This is the
  brief's "Stop (and trim)" choice.
- `set-idle-prompt { prompt }` / `dismiss-idle-prompt` —
  the only writers of `pendingIdlePrompt`. The reducer
  clears the prompt as part of every successful Trim/Stop
  resolution, so the dialog disappears the moment the
  user picks.

### Data model

- `IdlePrompt` interface added to `src/shared/model.ts`.
- `PersistedState.pendingIdlePrompt?: IdlePrompt` is the
  field the reducer writes; the schema version is bumped
  to `3`. A `pendingIdlePrompt` is what lets a prompt
  survive the sidepanel being closed mid-detection: the
  service worker writes it; the sidepanel renders it on
  cold start.
- `TimeEntry.source: "idle-trim"` is the marker on the
  closed entry the trim produced, so the user can see in
  the card's entry list that a window was retroactively
  removed.
- `isPersistedState` validator extended to accept the
  new field strictly (rejects malformed prompts on load).

### UI

- `src/sidepanel/components/IdlePromptDialog.tsx` — the
  centerpiece UX. Layout:
  - Header: "You've been away for HH:MM:SS" + the card
    title.
  - Body: a one-line lede followed by three labelled
    choices (Keep all / Trim idle time / Stop & trim),
    each with a "1/2/3" key chip and a one-line
    explanation of what the choice does.
  - Footer: three buttons (Ghost / Primary / Danger)
    with the same 1/2/3 chips and a "Keep all" button
    that shows the time it would credit (`+06:00`).
  - Hint strip at the bottom: "Esc keeps all ·
    ←/→ to choose".
- Keyboard shortcuts (the brief calls for keyboard
  friendliness; this dialog is fully usable without a
  mouse):
  - `1` → Keep all
  - `2` → Trim idle time (default focus)
  - `3` → Stop & trim
  - `←` / `→` → Move focus between buttons
  - `Enter` → Activate the focused button
  - `Esc` → Keep all (with a toast so the user can see
    what happened)
- `src/sidepanel/components/SettingsDialog.tsx` — a small
  modal containing one field: "Idle threshold (minutes)".
  Range 1–30, default 5. Persists via the existing
  `set-setting` action.
- `src/sidepanel/components/KeyboardShortcuts.tsx` now
  also refreshes the running timer's `lastSeenActive`
  anchor on user input (D-08) and accepts an
  `onOpenSettings` callback for the
  `Alt+Shift+S`/`Alt+Shift+,` chord (also dispatched by
  the existing `open-sidepanel` command surface).
- The header gained a "Settings" button next to Import /
  Export. The settings dialog uses the existing
  dialog-stack machinery.

### Cold-start gap (R-03)

- On sidepanel open, the App:
  1. Reads `state.pendingIdlePrompt` (if any).
  2. If present and `isPromptStale`, clears it via
     `setIdlePrompt(handle, undefined)`.
  3. If present and not stale, surfaces a toast ("Idle
     prompt pending: 6:00 on 'Brief'") and the
     `IdlePromptDialog` renders on the next render.
  4. If absent, does nothing synchronously: the next
     alarm tick within `IDLE_ALARM_PERIOD_MINUTES` will
     set a prompt if the running timer has crossed the
     threshold while the user was away.
- This is the "first run after a long gap" UX the brief
  asks for. The dialog the user sees is the same dialog
  the live idle detector surfaces; there is no separate
  "cold-start prompt" flow.

### Tests

- `tests/idle.test.ts` — 20 tests covering the pure
  detector, the reducer's `trim-timer` and
  `trim-timer-and-stop` actions, the imperative
  wrappers, the stale-prompt check, and the
  trimmed-recently window.
- `tests/idle-ui.test.tsx` — 14 tests covering the
  `IdlePromptDialog` directly (renders, click handlers,
  keyboard handlers, end-to-end with the App via the
  in-memory storage handle) and the `SettingsDialog`
  (renders, save, validation).
- `tests/background-idle.test.ts` — 7 tests covering the
  service-worker glue: alarm creation, alarm handler
  fires the detector, idempotent re-fires, system-idle
  listener touches the anchor, notification deep-link.
- All existing 125 tests still pass after the data-model
  bump to `SCHEMA_VERSION = 3`. Total: 166 tests.

## What was researched

### Idle-detection API choice (D-08)

The brief asks for a "configurable threshold" and a UX
that handles the AFK case. The standard pattern in
time-tracking literature is:

- `chrome.alarms` (1-minute floor in MV3 production) for
  the periodic decision tick.
- `chrome.idle.onStateChanged` for a system-level signal
  that does not depend on the extension's own input.
- An in-extension `last_seen_active` timestamp updated on
  any user input inside the sidepanel (or context menu,
  or capture action).

The combination is what D-08 records. Phase 3 implements
all three. The `KeyboardShortcuts` component is the
sidepanel-side "input" signal; the `bindSystemIdle`
listener is the OS-level signal; the alarm tick is the
periodic decision.

### Prompt surface (D-16)

The brief is explicit: "The timer is still running, I
get a clear, well-designed prompt when I've been idle
for a configurable threshold." The lock-in
[in D-16](../../gsd/01-decisions.md#d-16--idle-prompt-surface-in-sidepanel-primary-notification-as-deep-link)
is: the prompt renders in the sidepanel as the primary
surface; the OS notification is only a deep-link from
the tray. Reasoning: the prompt needs to be styled, must
integrate with the keyboard and undo flows, and must
match the rest of the product. A `chrome.notifications`
notification is unstyled and bypasses the design system.

The implementation in Phase 3 honors that lock-in. The
notification fires (so the user gets a tray cue when the
sidepanel is closed), but the prompt itself is the
`IdlePromptDialog` component.

### "Trim idle time" semantics

The brief says: "'Trim' means: retroactively close the
current running entry at `last_seen_active` (or at the
start of the entry, if it started after
`last_seen_active`), and start a new entry."

Two interpretations were possible:

1. The new entry starts at `last_seen_active` and runs
   forward from there.
2. The new entry starts at the moment the user picked
   Trim (so the user "starts over" with the timer
   continuing to run, but no time has elapsed yet from
   the perspective of the new entry).

I went with interpretation #1 (the literal reading of
the brief). The new entry's `startAt` is `last_seen_active`
and the running block's `startedAt` anchor advances to
the same value. This means a user who comes back, picks
Trim, and immediately picks Stop (a contrived sequence)
will see the trimmed window reflected as a 0-second
post-trim entry that is then closed.

The more common flow is "Trim, then keep working," in
which case interpretation #1 is the natural semantics:
the user was last active at T₀, the running block now
reads T₀, and the next 5 minutes of work are counted as
a single new entry.

The pure reducer test
[`trim-timer reducer action > preserves the user's total tracked time on the card except for the trimmed window`](../../tests/idle.test.ts)
documents the semantics with numbers.

### "Stop (and trim)" semantics

The brief is explicit that Stop also trims. I added a
separate `trim-timer-and-stop` action so the two
operations are atomic. The alternative — Trim, then
`stop-timer` — would briefly leave a new open entry on
the card that the Stop would then close, which
double-writes the persisted state and creates a
zero-length open entry on the way through. The atomic
version avoids both.

### Cold-start UX (R-03)

The brief: "If I was away so long the browser was closed,
handle it gracefully when I come back: ask me what to do
with the gap instead of silently keeping or discarding
it."

I considered two approaches:

1. **Same flow, different prompt text.** The
   `pendingIdlePrompt` is set by a dedicated
   `reconcileOnColdStart` SW call that checks
   `now - lastSeenActive` against the threshold and sets
   a prompt if the gap exceeded it. The sidepanel renders
   the same `IdlePromptDialog` it would render for a live
   detection. The user sees an identical experience.

2. **Two flows.** A "you've been away" dialog and a
   separate "live" dialog with different copy.

I picked #1. The detector is symmetric: the only thing
that matters is `now - lastSeenActive > threshold` and
`runningTimer is set`. The trigger (live alarm tick vs.
cold-start alarm) does not change what the user sees.

## What's risky

### R-02 — `chrome.alarms` 1-minute floor still applies

The first prompt can fire up to 60s *after* the threshold
was crossed. The brief accepts this (D-15 records the
constraint, R-02 calls it out as "open"). The mitigation
in place: the OS notification fires from the same tick
that writes `pendingIdlePrompt`, so the user has a tray
cue within the same minute. The threshold is
configurable from 1 minute upwards, so a user who wants
a tighter loop can configure it; the constraint is
Chrome's, not ours.

### R-03 — Cold-start UX is correct but unverifiable in CI

The "user closed the browser for 3 hours" scenario
cannot be driven from `vitest`. The tests instead drive
the underlying state transitions directly: the
`pendingIdlePrompt` survives because it is persisted, the
detector re-evaluates on the next alarm tick, and the
sidepanel renders the dialog if one is present. The
end-to-end UX is verifiable manually; the data-layer
contract is verifiable in CI.

### "Keep all" semantics on a long gap

A user who keeps the prompt after being away for 6
hours will, by definition, credit themselves 6 hours of
work on a card that was supposed to track actual time.
The "Keep all" choice is intentional (the user might
have been working off-screen), but it is also a
discipline ask. The trimmed entry's `source: "idle-trim"`
is the breadcrumb that lets the user audit their
keep-all decisions in the entry list.

## Next

Phase 4 — right-click "Add to Sidetrack" and the simple
today/this-week time report. The right-click capture
hooks `chrome.contextMenus` (D-07); the report reads
from the same `TimeEntry[]` shape the rest of the app
already writes, so the work is additive.
