# Phase 4 — Capture & reports

> **Status:** Complete. Phase 4 ships the right-click "Add to
> Sidetrack" flow (D-07), the Inbox destination for captures
> (brief AC #6), the selection variant of capture, the
> "Today" and "This week" reports with per-task and per-board
> totals (the brief's "where did my time go today / this
> week?" question), a clean empty state for both reports,
> themed styling, and a sidepanel toast + OS notification
> pair so the user gets a confirmation whether the sidepanel
> is open or closed. All work happens through the existing
> `chrome.runtime` and `chrome.storage` message bus; no new
> permissions were added (the `contextMenus` and
> `notifications` permissions are already in the manifest
> from Phase 0/3).

## What was built

### Data model

- `Card.source?: { url, title, selection?, capturedAt }` —
  the provenance blob the capture flow writes onto the new
  card. Optional on the type, optional on the persisted
  shape; old cards have `undefined` and the UI handles that
  case.
- New reducer action: `capture-card { columnId, title,
  description?, source? }`. Identical to `create-card` but
  accepts a `description` and a `source`. The reducer
  sanitizes the `source` defensively: a payload missing the
  required `url` / `title` / `capturedAt` is dropped (the
  card is still created, just without the source). The
  reducer is the only writer of cards (D-06); the SW is
  plumbing.
- `schemaVersion` bumped from `3` to `4`. The shape of the
  persisted state is unchanged at the top level (only the
  optional `Card.source` field is new), so the validator in
  `isPersistedState` does not need a new branch. Older v3
  blobs are refused on load (the same forward-compat
  strategy Phases 1–3 used); we are pre-release so no
  migration is shipped.

### Capture plumbing (`src/background/capture.ts`)

- `ensureContextMenus()` — idempotently registers two
  `chrome.contextMenus` items: a page-scoped "Add to
  Sidetrack" and a selection-scoped "Add selection to
  Sidetrack." Called from `chrome.runtime.onInstalled` so
  the menu is available before the user opens the
  sidepanel.
- `bindContextMenuClicks()` — wires the click handler at
  module load (idempotent).
- `handleContextMenuClick(info, tab)` — the pure entry
  point. Pulls the page URL/title from the click payload,
  picks the right title (selection > page title > URL) and
  description (the page URL on page-capture, the page URL
  on selection-capture), looks up the Inbox column from the
  persisted state, calls into the reducer, and fires the
  side effects. Returns `{ ok, cardId?, reason? }` so the
  test harness can drive it without `chrome.*`.
- Side effects on a successful capture:
  1. `chrome.notifications` is fired (best-effort) so a
     user with the sidepanel closed still sees a tray cue.
  2. `chrome.runtime.sendMessage` posts a
     `card-captured` message to the sidepanel so it can
     surface a toast and (when the sidepanel is open) open
     the card's detail dialog.
- Defensive: capture is a no-op when the URL is missing
  (`reason: "no-url"`) or when the Inbox column has been
  deleted (`reason: "no-inbox"`). The test harness asserts
  both no-op paths.

### Capture plumbing (`src/sidepanel/App.tsx`)

- A new `chrome.runtime.onMessage` listener handles
  `card-captured` messages from the SW:
  - Surfaces a "Captured: <title>" success toast.
  - Switches the active board to the board that owns the
    new card, so the user lands in the right place.
  - Opens the card's detail dialog so the user can
    refine the title / description / due date with one
    extra click.
- The listener is added in a `useEffect` and torn down on
  unmount; it reads the live `state` from the storage
  subscription so it knows which board owns the new card
  (no race with the SW's write).

### Reports (`src/shared/reports.ts`)

The reports module is a pure, total function
`computeReport(state, range, now) → Report` over the
persisted state. It returns:

- `range`, `startMs`, `endMs` — the window the report
  covers. The window is computed in the user's *local*
  time zone (a user in UTC-08 who opens "Today" at 23:30
  local gets today's window, not the UTC day that has
  already rolled over).
- `totalMs` — the sum of every card's contribution.
- `perTask: ReportRow[]` — the per-card list, sorted
  desc by `totalMs`. Each row carries `cardId`,
  `cardTitle`, `totalMs`, and a `share` (0..1) used by
  the CSS bar.
- `perBoard: ReportBoardRow[]` — the per-board rollup,
  sorted desc by `totalMs`. Each row carries `boardId`,
  `boardName`, `totalMs`, `share`.
- `hasAny: boolean` — `true` iff `totalMs > 0`. Drives
  the empty state in the UI.

The brief's "where did my time go today / this week?"
maps to two ranges: `today` (local-time 00:00–24:00) and
`this-week` (local-time Monday 00:00 to next Monday
00:00; the brief doesn't specify a week-start, so I went
with the ISO week — Monday).

The "intersecting" semantics for an entry are explicit
and live in `entryContributionMs`:

- An entry contributes the portion of its duration that
  falls inside the range. An open entry (the running
  timer) is treated as ending at `now` and is split at
  the range boundary the same way a closed entry is.
  This means a card that has been running for 6 hours
  and the user opens the Today report at 14:00 only sees
  the 14:00 contribution — which is what the brief means
  by "where did my time go today."
- A defensive `share = 0` is used when `totalMs` is 0 to
  avoid a `0 / 0`; the test
  [`computeReport — shares > \`share\` is 0 when totalMs is 0`](../../tests/reports.test.ts)
  covers that.

The function is total over the persisted state — it
walks every card, every entry, exactly once. With
hundreds of cards and thousands of entries this is still
a sub-millisecond pass on a developer's machine; no
incremental caching is needed at this size.

### Reports UI (`src/sidepanel/components/ReportView.tsx`)

- The "Board / Reports" view tabs in the header. The
  default view is "Board" so first-run UX is unchanged
  from Phases 1–3; the user clicks "Reports" to see the
  report.
- The report's own sub-tabs: "Today" and "This week."
  The "Today" tab is the default; clicking a tab is a
  no-state-change operation other than the range
  selection.
- The total: shown in both a verbose `H:MM:SS` form
  (the prominent number) and a compact "1h 23m" form
  (the secondary line). The compact form re-uses
  `formatDurationCompact` from Phase 2.
- The per-board rollup: a list of boards, each with a
  CSS-only bar whose width is the board's `share` of
  the total. The bar is plain CSS (no chart library) —
  this is the "simple bar chart" the brief says is
  acceptable.
- The per-task list: each row is a button. The button
  shows the card title, the board › column location, a
  bar, the duration, and a percentage. Clicking the
  button opens the card's detail dialog and switches
  the active board to the card's board (the brief's
  "clicking a row jumps to that card" acceptance
  criterion).
- The empty state: when `hasAny` is false, the report
  shows "No tracked time today yet. Start a timer on
  any card to see it show up here." (or "this week" for
  the week range). The empty state is *themed* — it uses
  the same border / surface variables as the rest of
  the app, with a dashed border to differentiate it
  from a populated state.

### Styling

- All new styles use the existing CSS variables from
  `src/sidepanel/styles.css`. Light and dark theme
  follow the existing `prefers-color-scheme` rule (D-09);
  no theme-specific styles for the new view needed.
- The view tabs, the report tabs, the bars, the rows,
  the totals, and the empty state are all responsive
  (the `@media (max-width: 420px)` block hides the
  per-board bar on narrow widths so the columns can
  collapse gracefully).

## What was researched and decided

### Why a context menu, not a content script

The brief: "Right-click on any web page (or select text
and right-click) → 'Add to Sidetrack' → creates a card
with the page title and URL attached."

A `chrome.contextMenus` entry on `page` and `selection`
is the MV3-blessed way to inject UI into pages without
shipping a content script on every tab (D-07). The
`contextMenus.onClicked` event provides the page URL
(via `info.pageUrl`) and the tab's title (via the
`tab` argument) without any DOM access — the brief's
"zero-tolerance for runtime overhead" pushes us away
from a content script. The Phase 0 decision (D-07) was
to use this API; Phase 4 implements it.

### Why a sidepanel toast AND an OS notification

Two surfaces for one event. The brief's right-click
should land "somewhere obvious" (the Inbox column on
the user's default board, which Phase 1 already seeds
with `inboxColumnId`). The sidepanel toast confirms the
capture to a user with the sidepanel open (a quick
visual cue, with a clickable link to the card). The OS
notification does the same for a user with the
sidepanel closed (a tray cue with a clickable link to
open the sidepanel).

D-16 records that the sidepanel is the *primary*
surface for the idle prompt, with the OS notification
as a deep-link; the same pattern is the right answer
for capture.

### Why "This week" is Monday-to-Monday

The brief doesn't specify a week start. I went with
Monday because the ISO week starts on Monday and the
"start of the work week" mental model feels right for
a productivity tool. The `rangeBounds` helper exposes
the offset so a future "Settings: week starts on…"
preference is a one-line change. The
[`rangeBounds > Sunday-anchored dates are placed in
the previous Monday's week`](../../tests/reports.test.ts)
test documents the behavior with a real date.

### Why open entries contribute live time

The brief's question is "where did my time go
*today*?" — not "where has the timer *been* today?"
An open entry (the running timer) is a promise of
tracked time, not tracked time. We split it against
the range boundary the same way a closed entry would
be split if it straddled midnight. A user who started
a timer at 9 AM yesterday and opens "Today" at 14:00
sees 5 hours of "yesterday" and 14:00 of "today" — not
the full 29 hours.

The
[`entryContributionMs > treats open (running) entries
as ending at \`now\``](../../tests/reports.test.ts)
test documents the contract.

### Why a list, not a chart

The brief: "a clear list or simple chart — pick the
minimal thing the brief calls 'clear list or simple
chart' and ship that." I picked a list with a thin
CSS bar (a `width: 23%` strip) because:

- A list with a bar is **clickable row-by-row** (the
  brief's "click a row jumps to that card" criterion).
  A pie / donut chart would need a separate
  "click on slice = ???" affordance.
- A CSS bar conveys *relative* magnitude at a glance
  without a chart library, which adds size and
  licensing concerns (the brief's "no external services
  at runtime" is a no-charts-library constraint in
  spirit).
- The list + bar reads well at the sidepanel's narrow
  width. A chart that fits a wide column on a website
  looks cramped in 320px.

If user feedback says "I want a real chart", Phase 5
can ship one without breaking the data shape — the
Report type is presentation-agnostic.

## What's risky

### R-04 — `chrome.contextMenus` may be revoked in private browsing

The MV3 spec does not say context menus are unavailable
in incognito; in practice they work. I have not seen
an issue in current Chrome. The mitigation: if the
`chrome.contextMenus.create` call throws, the SW
swallows the error and the rest of the app continues
to work. The user simply loses the right-click capture
in that browser. The Reports view does not depend on
`contextMenus` and works in every state.

### R-05 — Selection-capture assumes a non-empty selection

The SW uses `selectionText ?? ""` and falls back to
the page title when the selection is empty. The
regression scenario would be a future Chrome that
*only* fires the selection context item when the
selection is non-empty; the test
[`selection-variant click falls back to the page title
when selection is empty`](../../tests/background-capture.test.ts)
covers the fallback. The behavior is correct
regardless of which way Chrome goes.

### R-06 — Card.title could overflow the Inbox column

A user who right-clicks 50 pages in a row will have
50 cards in the Inbox. The Phase 1 board UI handles
this — the columns are horizontally scrollable, and
the Inbox column is the first column. The reports
view will not show a per-task row for a card with no
tracked time, so the "report is huge" risk is bounded
to cards that have *also* accumulated time, which is
the actual intent of the report.

### R-07 — The first-board Inbox is hardcoded

A user with two boards (e.g. "Work" and "Personal")
and two Inbox columns (one per board) only has the
first board's Inbox as the capture target. This is
intentional (D-07) and matches the rest of the
single-active-inbox model. Phase 5 may add a
"settings: default Inbox column" preference. The
`findInboxColumn` helper is the only place that needs
to change.

## Verification

- `npm test` — **216 passing** (up from 166 at the end
  of Phase 3). The new tests are:
  - `tests/capture.test.ts` — 9 tests for the
    `capture-card` reducer action (shape,
    sanitization, running-timer independence).
  - `tests/background-capture.test.ts` — 9 tests for
    the SW context-menu glue (page variant, selection
    variant, no-URL, no-inbox, tray notification, etc.).
  - `tests/capture-listener.test.tsx` — 3 tests for
    the sidepanel's `card-captured` listener (toast,
    dialog, board switch).
  - `tests/reports.test.ts` — 22 tests for the
    `computeReport` pure helper (empty, single
    entry, multi-card / multi-board, boundary
    splitting, running entry, this-week, share edge
    case).
  - `tests/report-ui.test.tsx` — 7 tests for the
    report view in `<App />` (default view, range
    tabs, empty state, row click → dialog,
    view-tab navigation).
- `npm run build` — produces a `dist/` whose
  `manifest.json` is unchanged from Phase 3 (no new
  permissions were needed; `contextMenus` and
  `notifications` were already declared).
- `tests/build.test.ts` — passes; the bundle includes
  the new view's CSS and JS.

## Definition of done

> *The user can capture from the web with one right-click
> and see a useful answer to "where did my time go today
> / this week."*

- [x] Right-click a web page → a card appears in Inbox
      with the title and a link to the page (brief AC
      #6).
- [x] Selecting text on a page and right-clicking "Add
      to Sidetrack" creates a card whose title is the
      selected text and whose description includes the
      page URL.
- [x] The Today report shows accurate per-task and
      per-board totals.
- [x] The This-week report shows accurate totals.
- [x] Reports handle the empty state well.
- [x] Reports respect the theme.
- [x] `docs/reports/phase-4.md` exists (this file).
- [x] All 216 tests pass.
- [x] The build produces a loadable extension.

## Next

Phase 5 — polish & release quality: first-run
experience, empty states, themes, keyboard shortcuts,
accessibility pass, performance check with a large
dataset, undo for destructive actions, README with
screenshots and install instructions, and a final
self-review against every brief requirement.
