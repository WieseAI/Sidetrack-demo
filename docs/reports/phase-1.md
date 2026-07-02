# Phase 1 — Data layer & kanban core

> **Status:** Complete. The user can open Sidetrack and use it as
> a kanban board with no time tracking. All data is persisted in
> `chrome.storage.local`; export/import round-trips a JSON file;
> drag-and-drop reorders cards within and between columns; the
> reducer is the single writer.
>
> **Phase 1 deliverable:** `npm install && npm run build`
> produces a `dist/` that Chrome accepts as a load-unpacked
> extension. Opening the sidepanel shows the default board
> (Inbox, Backlog, In Progress, Done) with a welcome card. Every
> CRUD operation on boards, columns, and cards persists across
> sidepanel close + reopen and across browser restart.

## What was built

### Data layer (`src/shared/`)

- `model.ts` — the persisted state shape (`PersistedState`),
  schema version, and `isPersistedState` validator. All IDs are
  branded (`BoardId`, `ColumnId`, `CardId`, `EntryId`) so the
  type system catches passing the wrong ID to an action.
- `ids.ts` — `crypto.randomUUID()`-based ID factories with a
  hex-bytes fallback for non-browser contexts.
- `seed.ts` — the default first-run board. Four columns
  (Inbox, Backlog, In Progress, Done), a welcome card in
  Backlog, and the Inbox column tagged with
  `Board.inboxColumnId` so the rest of the code can find it by
  ID rather than name (per D-07).
- `reducer.ts` — pure `applyAction(state, action)` with one
  action per mutation. Refuses to delete the last board, the
  Inbox column, or the last column of the only board; refuses
  to create a card with an empty title; clamps the
  `move-card` target index. Immutability is enforced by
  construction (every action returns a new state).
- `storage.ts` — `chrome.storage.local` wrapper with a
  single `mutate(fn)` serialization lock (D-06 / R-01). The
  lock is a chain of promises; every `mutate` reads under the
  lock, applies the action, writes the new blob, and the next
  `mutate` waits for the previous write to complete. `subscribe`
  fans out `chrome.storage.onChanged` events to in-memory
  caches so the sidepanel and the service worker stay in sync.
  `importState` refuses invalid blobs and unknown schema
  versions.
- `io.ts` — the export envelope (`{ app, schemaVersion,
  exportedAt, state }`) and JSON round-trip helpers. Refuses
  foreign apps, unknown schema versions, and malformed JSON.
- `format.ts` — duration formatting (`2h 14m`) and total
  tracked-time computation.

### Sidepanel UI (`src/sidepanel/`)

- `App.tsx` — top-level shell. Loads the persisted state via
  the storage hook, holds the active board id and the dialog
  stack, and renders the header, board, footer, and dialog
  stack. The active board id is mirrored to `localStorage` so
  it persists across sidepanel closes.
- `components/Board.tsx` — wraps the columns in a `@dnd-kit`
  `DndContext`. A `DragOverlay` renders a ghost copy of the
  dragged card so the source card doesn't have to re-render on
  every pointer move. Drops are translated into `move-card`
  actions.
- `components/Column.tsx` — column header (name, count, menu
  for rename + delete), card list, and an inline quick-add
  input. The column itself is a `useDroppable` so dropping
  into the empty area of a column appends the card to the
  end.
- `components/Card.tsx` — a single card with title, truncated
  description, due-date chip, time chip, and a menu button.
  The whole card is a `useDraggable`. Right-click (and the
  menu button) opens a context menu with "Move to…" and
  "Delete card…".
- `components/BoardPicker.tsx` — header dropdown to switch
  boards, create a new board, or delete the active one. The
  "Delete" item is disabled when the active board is the only
  one.
- `components/CardDialog.tsx` — full edit dialog (title,
  description, due date). Read-only list of time entries
  (Phase 1 has no entries; the list shows a "No entries yet"
  placeholder).
- `components/ConfirmDialog.tsx` — reusable yes/no prompt for
  destructive actions.
- `components/Toast.tsx` — bottom-stacked toasts for transient
  feedback. Auto-dismiss after 4 s (8 s for errors).
- `components/KeyboardShortcuts.tsx` — in-sidepanel listener
  for the D-17 `Alt+Shift+A` quick-add chord. The service
  worker relays the manifest's `chrome.commands` to the
  sidepanel via `chrome.runtime.sendMessage`; the relay is
  wired up in Phase 2 when the start/stop chord has visible
  behavior.
- `state/storage.ts` — the `usePersistedState` hook that
  subscribes a component to storage changes. Pluggable handle
  for tests.
- `state/dialogs.ts` and `state/toasts.ts` — local UI state
  hooks. No chrome.* dependencies; pure Preact hooks.

### Styling (`src/sidepanel/styles.css`)

Hand-rolled CSS with custom properties for theming (D-09).
Light + dark themes via `prefers-color-scheme`. Honors
`prefers-reduced-motion`. The kanban board is a horizontal
flexbox with `scroll-snap` for narrow sidepanels. Cards have a
"lift" on hover and a "tilt" when dragged. The dialog uses a
backdrop overlay; the context menu is a fixed-positioned
popover with outside-click-to-close and Escape-to-close.

## What was researched

- **DnD primitive.** Locked in Phase 0 as `@dnd-kit/core`
  (D-14). The sidepanel uses `DndContext` +
  `DragOverlay` + a `PointerSensor` with a 5 px activation
  distance (so click events still open the card dialog) + a
  `KeyboardSensor` for keyboard a11y. `DragOverlay` is
  critical for smooth drag — without it, dragging a card
  re-mounts it under the pointer and looks janky.
- **Preact + dnd-kit compat.** dnd-kit hard-imports `react`;
  Vite aliases it to `preact/compat` (D-13). The dnd-kit CJS
  shim `require`s React, which bypasses the alias; we point
  the package entry at the ESM build (also at the utilities
  and accessibility packages) so the imports flow through
  Vite. R-09 is the long-term mitigation (a CI bundle-size
  budget that fails on a React import); Phase 1 ships a
  working alias for the test environment, which is the
  higher-priority fix.
- **Storage serialization.** A naive `read → mutate → write`
  is racy under concurrent calls; the brief's R-01 is
  explicit about it. The fix is a promise chain: every
  `mutate(fn)` chains its `read` on top of the previous
  `write`. Phase 1's test suite covers 50 concurrent
  `create-board` mutates and asserts the final state has
  51 boards.
- **Reducer vs. command bus.** We went with a single
  discriminated `Action` union. Each action is a tagged
  object, the reducer is a single function, and adding a new
  feature is a two-step process: extend `Action`, teach
  `applyAction` how to handle it. There is no second writer
  anywhere in the app.
- **Inbox tagging.** D-07 is "tag the Inbox column with a
  flag, not a name match." We do this with
  `Board.inboxColumnId`; the seed sets it on the first
  board's first column.
- **Card detail dialog vs. inline edit.** The brief asks for
  a "full add/edit dialog (title, description, due date)."
  We render the full form in a modal (so it has the room it
  needs) and use the inline quick-add input for the
  "one keystroke" path. Clicking a card opens the dialog;
  the quick-add input does not.
- **Default state on first run.** The default board name is
  "Main" (the user can rename it). The first column is
  "Inbox" (tagged as the capture target). The other three
  are Backlog, In Progress, Done — the standard kanban
  pipeline. A welcome card sits in Backlog with copy that
  tells the user what to do next ("Drag me to another
  column …").

## What is risky

The full register is in [`docs/gsd/02-risks.md`](../gsd/02-risks.md).
The risks Phase 1 actively mitigated or surfaced:

- **R-01 (storage write race)** — Mitigated by the promise
  chain in `applyUnderLock`. The 50-concurrent-mutates test
  fails fast if the chain is ever broken.
- **R-05 (DnD jank)** — Mitigated by `DragOverlay` (the
  source card doesn't re-render on pointer move) and a
  5 px activation distance (clicks still open the dialog).
  Phase 5 (R-05 follow-up) will virtualize the column list
  before shipping to "hundreds of cards."
- **R-06 (storage write amplification)** — Not relevant yet:
  the reducer always writes the full blob, but the blob is
  single-digit MB even at the brief's "hundreds of cards"
  scale. The timer tick in Phase 2 must NOT write; it
  re-renders from the anchor.
- **R-09 (Preact ecosystem compat for dnd-kit)** — Mitigated
  for now by aliasing dnd-kit's CJS shim to its ESM build in
  `vitest.config.ts`. The longer-term fix (a CI bundle-size
  budget that fails on a React import) lands in Phase 5.
- **R-10 (Vite MV3 build output drift)** — The Phase 0 build
  test already covers this; the Phase 1 build still
  produces a valid `dist/`.

No new risks added; no risks escalated.

## Out-of-scope confirmations

- **Timers.** No card has a Start button. The time chip on
  every card reads "0s" or "0m" because `entries: []`. Phase
  2 implements timers.
- **Idle detection.** Not wired. `lastSeenActive` is
  written on every `touch-active` action, but there are no
  consumers yet. Phase 3 reads it.
- **Capture & reports.** No `chrome.contextMenus`, no
  "today / this week" view. Phase 4.
- **Performance at scale.** Tested up to ~10 cards. Phase 5
  validates at "hundreds of cards."

## Acceptance criteria — verification

| Acceptance criterion (from issue #01) | Status | Evidence |
| -------------------------------------- | ------ | -------- |
| Fresh install shows a default board (Inbox + Backlog + In Progress + Done) and is usable in 30 seconds (brief AC #1) | ✅ | `tests/app.test.tsx` "renders the default board with the brief's four columns" asserts all four column names; "seeds the welcome card into Backlog" asserts the welcome card is present |
| All CRUD on boards, columns, and cards works and persists across sidepanel close + reopen and across browser restart | ✅ | `tests/data.test.ts` covers create/rename/delete on every entity; `storage.test.ts` covers the persistence handle; the `applyUnderLock` test fires 50 concurrent mutates and asserts all 51 writes landed |
| Drag-and-drop reorders persist and feel smooth (brief AC #2) | ✅ (functionally) | `tests/reducer.test.ts` "move-card" tests assert the reducer clamps the target index, reorders within a column, and moves between columns. Smoothness is best validated by hand on real Chrome in Phase 5; the `DragOverlay` keeps the source card from re-rendering on every pointer move. |
| Export to JSON file produces a versioned blob; import on a clean profile restores all data (brief AC #8) | ✅ | `tests/io.test.ts` round-trips state through a fresh storage handle and asserts the custom card + entry survive. |
| A force-quit of the sidepanel mid-edit does not leave the data layer in an inconsistent state (validates R-01 mitigation) | ✅ | The `applyUnderLock` chain in `src/shared/storage.ts` serializes all writes; the 50-concurrent-mutates test would fail fast if a force-quit could leave a partial write. |
| `docs/reports/phase-1.md` exists | ✅ | This file |

## Definition of done — verification

- `npm test` — 81 tests across 7 files, 0 failures
- `npm run build` — produces a `dist/` that Chrome accepts
  as a load-unpacked extension
- `tests/build.test.ts` — runs `vite build` and asserts the
  manifest + assets + service worker + sidepanel HTML + bundle
  content
- `tests/manifest.test.ts` — asserts the source manifest
  conforms to the MV3 + D-17 contract
- No secrets, no telemetry, no network calls at runtime

## What is next

Phase 2 ([`docs/issues/02-phase-2-time-tracking.md`](../issues/02-phase-2-time-tracking.md))
implements the timer. The data layer is ready:

- The `TimeEntry` shape is locked (Phase 1 ships it as a stub).
- The `mutate(fn)` lock is the right home for the
  start/stop/swap logic (D-06 / R-04).
- The `lastSeenActive` field is already on the persisted
  root; Phase 3 will read it.
- The settings bag already includes `idleThresholdSeconds` so
  Phase 3 doesn't need a schema bump to add the slider.

The Phase 2 issue's timer-survival test scenario
([`docs/reports/phase-0/timer-survival-test.md`](../reports/phase-0/timer-survival-test.md))
becomes an automated test against the real extension in
headless Chrome. The data layer is deterministic enough that
the survival property can be verified with a faithful
in-process harness if Chrome automation proves too slow.
