<!-- labels: phase-3, gsd, idle, notifications -->

# Phase 3 — Idle protection & notifications

## User story

As a user who forgets to stop timers, I get a clear, well-designed
prompt when I've been idle for a configurable threshold, with real
choices: keep all the time, trim the idle time away, or stop the
timer (also trimmed). When I come back after closing the browser, I'm
asked about the gap, not silently over- or under-counted.

## Phase goal

Implement the detection side from D-08 and the prompt UX from the
brief. This is the *centerpiece UX* of the product, so polish matters
more here than anywhere else.

## Scope

- Detection (D-08, R-02):
  - `last_seen_active` updated on any sidepanel input, context-menu
    use, capture action, or alarm tick where the user just acted.
  - `chrome.idle.onStateChanged` and `getAutoLockDelay()` for a
    system-level signal.
  - 1-minute alarm tick compares `now - last_seen_active` to the
    configured threshold (default 5 minutes, configurable).
- Prompt:
  - Surface the prompt in-sidepanel (the visible surface) and
    optionally via `chrome.notifications` for when the sidepanel is
    closed. Pick one in Phase 0 (D-08) and stick with it.
  - Choices: **Keep all**, **Trim idle time**, **Stop (and trim)**.
  - "Trim" means: retroactively close the current running entry at
    `last_seen_active` (or at the start of the entry, if it started
    after `last_seen_active`), and start a new entry. The transition
    is invisible to the user.
  - "Stop" means: trim, then stop. So the user never has
    accidentally-uncounted idle time.
- Cold-start gap (R-03):
  - On sidepanel open, if a timer was running and the gap is
    `> threshold`, show the same prompt, defaulting to **Trim**.
  - "First run after a long gap" feels like the same prompt as the
    live one, not a different flow.
- Configuration:
  - Idle threshold is configurable in the sidepanel (a small settings
    view, Phase 5 polish). Default = 5 minutes.
  - Persisted in the storage blob.
- Phase 3 report (`docs/reports/phase-3.md`) includes a short UX
  walkthrough of the prompt with screenshots once Phase 5 generates
  them.

## Out of scope

- Reports (Phase 4).
- Right-click capture (Phase 4).
- Anything in the "non-negotiables" the brief already covers.

## Acceptance criteria

- [ ] Brief AC #5 passes: leave the computer with a timer running —
      user gets the idle prompt and "trim idle time" removes exactly
      the idle period from the entry.
- [ ] Brief AC implicit-#3 passes for the cold-start case: starting a
      timer, closing Chrome, returning hours later — user is prompted
      about the gap, with Trim as the default.
- [ ] Threshold is configurable and survives restart.
- [ ] The prompt is keyboard-friendly: arrow keys to choose, Enter
      to confirm, Esc to dismiss (= keep all, with a clear hint).
- [ ] The prompt is reachable when the sidepanel is closed (via
      `chrome.notifications` if that was the chosen surface) and
      clicking the notification re-opens the sidepanel with the
      prompt still pending.
- [ ] `docs/reports/phase-3.md` exists.

## Dependencies

- [Phase 2 — Time tracking](02-phase-2-time-tracking.md)

## Definition of done

The brief's AC #5 passes. The cold-start gap case is handled. The
prompt is the polished centerpiece of the product, not a generic
browser notification.
