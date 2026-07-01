<!-- labels: phase-4, gsd, capture, reports -->

# Phase 4 — Capture & reports

## User story

As a user, I can right-click on any web page (or on a selection) and
send it to Sidetrack's Inbox with the page title and URL attached. I
can also open a simple report view and see where my time went today
and this week, per task and per board.

## Phase goal

Ship the right-click capture flow and the minimal time-report view.

## Scope

- Capture (D-07):
  - `chrome.contextMenus` entry "Add to Sidetrack" on `page` and
    `selection`.
  - Selection variant: card title = the selected text; card
    description includes the page URL and a `source.url` / `source.title`
    pair.
  - Page variant (no selection): card title = the page title.
  - Both go to the Inbox column on the user's default board. The
    default board has an Inbox column from Phase 1 (D-07).
  - Toast confirmation in the sidepanel when the sidepanel is open.
- Reports:
  - "Today" and "This week" views.
  - Per-task totals and per-board totals.
  - Simple list or simple bar chart — pick the minimal thing the
    brief calls "clear list or simple chart" and ship that.
  - Clicking a row jumps to that card.
- `docs/reports/phase-4.md`.

## Out of scope

- Idle prompts (Phase 3).
- Cross-board or cross-time-range analytics.
- Calendar / Jira integrations (the brief is explicit: out of scope).

## Acceptance criteria

- [ ] Brief AC #6 passes: right-click a web page → a card appears
      in Inbox with the title and a link to the page.
- [ ] Selecting text on a page and right-clicking "Add to Sidetrack"
      creates a card whose title is the selected text and whose
      description includes the page URL.
- [ ] The Today report shows accurate per-task and per-board totals
      (sum of `TimeEntry.endAt - TimeEntry.startAt` for entries
      intersecting the day).
- [ ] The This-week report shows accurate totals.
- [ ] Reports handle the empty state well (no entries today → friendly
      empty state, not a blank list).
- [ ] Reports respect the theme.
- [ ] `docs/reports/phase-4.md` exists.

## Dependencies

- [Phase 2 — Time tracking](02-phase-2-time-tracking.md)
- (Independent of Phase 3; both can be parallelized on separate
  branches.)

## Definition of done

The user can capture from the web with one right-click and see a
useful answer to "where did my time go today / this week."
