<!-- labels: phase-5, gsd, polish, release -->

# Phase 5 — Polish & release quality

## User story

As a first-time user opening Sidetrack from a clean install, I
understand the product within 30 seconds without docs, and as a
keyboard-only user, I can do everything I need without a mouse.

## Phase goal

Ship the polish, accessibility, and the public-readme pass. Self-review
against every requirement in the brief before tagging the release.

## Scope

- First-run experience: a tiny onboarding overlay or empty-state hint
  that points at quick-add, the timer button, and the Inbox column.
- Empty states: every "no cards", "no entries", "no boards", "no
  reports" view is designed, not accidental.
- Error states: storage failures, JSON import errors, etc. all have
  visible, actionable messages.
- Themes: light + dark, system-default, polished contrast (WCAG AA at
  minimum).
- Keyboard shortcuts (D-10):
  - Open sidepanel: a `chrome.commands` chord.
  - Quick-add: a chord while the sidepanel is open.
  - Start/stop timer on the focused card: a chord.
  - Document the chords prominently in the empty state and the README.
- Accessibility pass: keyboard navigation, focus rings, ARIA labels
  on DnD region, announcements on drag start/end and on timer
  start/stop.
- Performance check with a generated 500-card dataset:
  - Sidepanel opens in <200ms on a mid-range laptop.
  - Drag-and-drop stays at 60fps.
  - Timer tick re-render is <1ms.
- Undo for destructive actions (delete board, delete card, delete
  time entry) — toast with Undo for 5 seconds, as the brief hints is
  "researchably standard."
- README as a landing page (per the brief and D-12):
  - What Sidetrack is, in one paragraph.
  - Install instructions (load unpacked).
  - Feature list.
  - Screenshots / GIFs of the sidepanel in action.
  - A clear note: "This project was built autonomously by WieseAI OS
    from the brief in [`sidetrack-brief.md`](../../sidetrack-brief.md)."
- Self-review: go through every line of the brief and every
  acceptance criterion, mark pass/fail, file any gaps as new issues
  before tagging the release.

## Out of scope

- Building features the brief puts out of scope (sync, accounts,
  mobile, etc.). If a polish pass suggests one, that suggestion
  goes in a follow-up issue, not this phase.
- "Infrastructure for later" — the brief is explicit.

## Acceptance criteria

- [ ] Fresh install → user understands and can use the board within
      30 seconds, no docs (brief AC #1).
- [ ] Airplane mode: every prior AC still works with no network
      (brief AC #7).
- [ ] Keyboard-only user can: open sidepanel, quick-add, start/stop
      timer, move a card, delete a card, navigate the report view.
- [ ] All empty/error states are designed.
- [ ] Light + dark themes both look polished.
- [ ] Sidepanel open is <200ms with a 500-card dataset.
- [ ] Drag-and-drop is 60fps with a 500-card dataset.
- [ ] Every brief requirement has a pass/fail in
      `docs/reports/phase-5-self-review.md`.
- [ ] `README.md` is a real landing page with screenshots and
      install instructions.
- [ ] MIT `LICENSE` file is present and matches the brief's
      "MIT license from the first commit" (in practice, added in
      issue #10; this phase verifies it's correct).
- [ ] `docs/reports/phase-5.md` exists.

## Dependencies

- [Phase 1 — Data layer & kanban core](01-phase-1-data-layer-and-kanban.md)
- [Phase 2 — Time tracking](02-phase-2-time-tracking.md)
- [Phase 3 — Idle protection & notifications](03-phase-3-idle-protection.md)
- [Phase 4 — Capture & reports](04-phase-4-capture-and-reports.md)
- [License (MIT) + public-repo hygiene](10-license-and-public-repo-hygiene.md)

## Definition of done

Every numbered brief acceptance criterion has a pass in the
self-review. The README is a real landing page. The product feels
like a product.
