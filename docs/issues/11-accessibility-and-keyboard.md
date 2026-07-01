<!-- labels: meta, gsd, accessibility, keyboard -->

# Accessibility & keyboard pass

## User story

As a keyboard-only user (or a screen-reader user), I can use every
feature of Sidetrack without a mouse, and every interactive element
has a clear, programmatic name.

## Phase goal

Make the product usable by a keyboard-only user end to end, with
WCAG AA contrast in both themes and screen-reader announcements on
state changes that aren't visually obvious.

## Scope

- Every interactive element has an accessible name and a visible
  focus ring.
- DnD region has proper ARIA labels and announces drag start/end.
- Timer start/stop and single-active-timer stop announcements
  (toast + ARIA live region) are wired up consistently.
- The idle prompt (Phase 3) is fully keyboard-operable: arrow keys
  to choose, Enter to confirm, Esc to keep all.
- The reports view (Phase 4) is navigable by keyboard with a
  reasonable tab order.
- The idle threshold setting (Phase 3) is keyboard-operable.
- Contrast: every text-on-background pair in light and dark themes
  is at least WCAG AA (4.5:1 for normal text, 3:1 for large text).
- `prefers-reduced-motion` is honored: drag animations and timer
  pulse collapse to instant changes.

## Out of scope

- Full WCAG AAA — we target AA only.
- Screen-reader-specific features beyond what comes "for free"
  with semantic HTML and ARIA labels.

## Acceptance criteria

- [ ] Keyboard-only walkthrough of the brief's AC #1, #2, #3, #4,
      #5, #6, #8 passes.
- [ ] Automated contrast check (e.g. `axe-core` or a documented
      manual check) reports no AA violations in either theme.
- [ ] `prefers-reduced-motion` is honored on all animations.

## Dependencies

- [Phase 5 — Polish & release quality](05-phase-5-polish-and-release.md)
  (this is the final pass; many of the *features* this issue
  accesses are introduced in earlier phases).

## Definition of done

A keyboard-only user can complete the brief's full acceptance test
suite. A screen reader announces the same state changes a sighted
user would notice.
