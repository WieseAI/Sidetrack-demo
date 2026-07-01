# Sidetrack — Decisions

> Architectural and product decisions that the brief explicitly asked future
> agents to research and decide. Locked during Phase 0; revisit only if a
> decision is shown to be wrong by later work.

The brief is explicit: "Where this brief is unclear, incomplete, or where
multiple approaches exist, you must research the topic yourself … and pick the
best approach." This file is where those decisions live so the next agent
doesn't start from zero.

These are the open architectural questions. They are recorded as
**Decisions** with a one-line rationale and the source-of-truth link.
Implementation in later phases must conform.

## D-01 — Manifest v3 (MV3)

**Decision:** Build on Manifest V3.

**Rationale:** MV2 is deprecated in current Chrome and the brief asks us to
follow current sidepanel conventions. MV3 is the only target Chrome supports
going forward. We accept the constraints (no persistent background page, no
remote code) and design around them.

**Implications:**

- The background script is a **service worker**, not a persistent page. It can
  be killed and restarted at any time. This is the single biggest design
  pressure and motivates D-04 (alarm-driven timer).
- All JS must be bundled locally; no `eval`, no remote `<script>`.

## D-02 — Sidepanel UI

**Decision:** Use the Chrome sidepanel API (`chrome.sidePanel`) as the primary
UI surface.

**Rationale:** This is what the brief explicitly asks for ("sidepanel is the
primary UI … research the current Chrome sidepanel APIs and conventions and do
it the recommended way"). The sidepanel API is stable in current Chrome and is
the recommended way to ship a persistent companion UI in MV3.

**Implications:**

- Single primary view in `sidepanel.html`, opened by the toolbar action.
- The sidepanel can be opened from any tab, and we render the same global
  state (boards + running timer) regardless of which tab opens it. See D-06.
- We do not build a popup, options page, or new-tab override in Phase 0. If
  Phase 5 needs an options page for the idle threshold, it can be a
  sidepanel-routed settings view rather than a separate page.

## D-03 — Stack

**Decision:** TypeScript + a small reactive UI library (React or Preact, to be
finalized in Phase 0 spike), bundled with Vite. Plain CSS with CSS variables
for theming. No CSS framework. No state-management library beyond the UI
library's own primitives. No backend, no telemetry.

**Rationale:** The brief asks for "instant open, instant interactions, even
with hundreds of cards." A virtual DOM library makes incremental re-renders
on timer ticks tractable without hand-rolled diffing. Vite gives a fast dev
loop and a clean MV3-compatible build (single `dist/`, hashed assets).
TypeScript is non-negotiable for a public showcase — the data model has enough
moving parts (boards, columns, cards, entries, idle gaps) that we need types.

**Open sub-decision (Phase 0):** Preact vs. React. Preact is smaller and the
brief prizes performance and "instant open." Default to **Preact** unless
Phase 0 spike finds a concrete reason to need React. The UI library is
swappable behind a thin view layer; we don't leak it into the data layer.

## D-04 — Timer persistence model

**Decision:** Store the running timer's **start timestamp** (and the card it
belongs to), not a tick count. Compute elapsed = `now - start_at` on demand.
Use `chrome.alarms` (minimum 1-minute period on MV3) to wake the service
worker so the running timer re-anchors after a restart and so the idle
detector gets periodic ticks. Persist a "last seen active" timestamp on user
input to drive idle detection.

**Rationale:** This is the only way to guarantee the brief's
"timer-must-survive-everything" requirement. If we stored elapsed seconds, a
background kill would silently stop the clock. Storing the start instant and
recomputing against `Date.now()` is drift-proof across service-worker
restarts, sleeps, and browser relaunches. `chrome.alarms` is the MV3-blessed
mechanism for periodic wakeups; the 1-minute floor is acceptable because the
**on-screen** elapsed time is recomputed against the anchor on every render
(the alarm is only needed to refresh in the background and to advance
state-machine ticks, not to keep the displayed time accurate).

**Implications:**

- The data layer exposes `elapsed(entry)` as a pure function of `now` and
  `start_at`. The UI calls it on a 1-Hz `requestAnimationFrame` loop while the
  sidepanel is open; the service worker uses alarms.
- On startup the service worker reconciles any timer that was running before
  the kill and decides whether the gap since `last_seen_active` is an idle
  gap (Phase 3).
- We never persist a "running tick counter."

## D-05 — Storage

**Decision:** Use `chrome.storage.local` for primary data and `IndexedDB`
(via a small wrapper, e.g. `idb-keyval` or hand-rolled) for any data that
exceeds the storage.local quota or needs indexed queries. For Phase 1 we
expect `chrome.storage.local` to be enough (boards/columns/cards are small
JSON); we move to IndexedDB only if a measured limit is hit.

**Rationale:** `chrome.storage.local` is the simplest MV3-blessed local
store, survives browser restarts, and is accessible from the service worker
and the sidepanel. IndexedDB is the right answer if the working set ever
exceeds a few MB. The brief prizes "data safety" — both stores are
durable; we add a debounced write on every mutation and an explicit
`save()` for the export/import flow.

**Implications:**

- A single `storage` module owns reads/writes. UI code never touches
  `chrome.storage` directly.
- Export = `JSON.stringify` of the full state. Import = validate against a
  versioned schema, then atomic replace.
- Schema versioning from day 1: every persisted blob has a `schemaVersion`
  field and a migration function, even if v1 has no migrations yet.

## D-06 — Single source of truth across surfaces

**Decision:** The service worker is the owner of the data model. The
sidepanel and any future surface read through a small message API
(`chrome.runtime.sendMessage`) and react to `storage.onChanged` events.
There is exactly one in-memory copy of state at a time per context.

**Rationale:** MV3 service workers can be killed and respawned; we cannot
keep a long-lived "store" in the background and have it be the source of
truth. The persisted blob in `chrome.storage` is the source of truth. Each
context keeps a local copy in memory and stays in sync via `storage.onChanged`
+ an explicit `requestState` message on cold start.

**Implications:**

- Every mutation goes through a single `mutate(fn)` helper that (a) applies
  the change to the local cache, (b) writes to storage, (c) lets
  `storage.onChanged` fan the update out to other contexts.
- We do not introduce a CRDT or operation log. Last-write-wins is fine for
  a single-user local app.

## D-07 — Right-click capture

**Decision:** Use the `chrome.contextMenus` API to add an "Add to Sidetrack"
entry. It works on the page and on selected text. The entry calls into the
service worker, which creates an Inbox card with `source: { url, title,
selection? }`.

**Rationale:** Context menus are the MV3-blessed way to inject UI into pages
without content scripts on every page. We avoid a content script on every
tab because the brief has zero-tolerance for runtime overhead and we don't
need DOM access — just the page URL/title and the user's selection.

**Implications:**

- No `content_scripts` declared in Phase 0. We can add one later only if a
  specific capture need (e.g. selected-image attachment) is added.
- "Inbox" is itself a board/column, not a separate type. The default
  template includes a Backlog board with an Inbox column; the capture action
  appends to that column.

## D-08 — Idle detection

**Decision:** Combine three signals:

1. A `last_seen_active` timestamp updated on any sidepanel input, context-menu
   use, or capture action.
2. `chrome.idle` `getAutoLockDelay()` and `onStateChanged` for a coarse
   system-level signal.
3. A periodic alarm (1-minute floor) that compares `now - last_seen_active`
   against the configured threshold.

**Rationale:** The brief says "If a timer is running and I haven't been
active for X minutes." That requires both **what is active** (Chrome's idle
state) and **what the user did in our extension** (interactions in the
sidepanel). A single signal is not enough: `chrome.idle` alone misses
"user is at the computer but only looking at the sidepanel"; a
last-seen-active timer alone misses "user is AFK at the OS level."

**Implications:** Detailed UX of the keep/trim/stop prompt is in the Phase 3
issue. The mechanism above is the *detection* side of it.

## D-09 — Theming

**Decision:** CSS variables, two themes (`light`, `dark`), default = system
preference via `prefers-color-scheme`. Manual override is a Phase 5 stretch
and is not required by the brief.

**Rationale:** The brief asks for both themes and "follow system by default."
CSS variables give us a single switch point and make a future manual toggle
trivial.

## D-10 — Keyboard shortcuts

**Decision:** Use `chrome.commands` for the global actions (open sidepanel,
quick-add, start/stop timer on the focused card). In-sidepanel navigation
follows standard web a11y conventions (Tab/Shift-Tab, Enter, Space, Esc).

**Rationale:** `chrome.commands` is the MV3-blessed way to bind shortcuts
that work even when the sidepanel is closed (critical for "start/stop
timer" on a card the user is looking at in another app). It also means we
get the Chrome shortcuts page for discoverability.

**Open:** Default chord is to be picked in Phase 0; we will document it
prominently in the empty state and the README.

## D-11 — Out of scope, reaffirmed

The brief is explicit about what's out. We re-record it here so a future
agent does not accidentally drift into it:

- No sync, cloud, accounts, sharing, mobile, other browsers, integrations,
  billing/invoicing.
- No "infrastructure for later." If a feature above is needed later, it
  ships later; we do not stub it now.

## D-12 — Public-repo hygiene

**Decision:** MIT license from the first commit (the brief's
"non-negotiables"). README is a landing page. No secrets, no telemetry, no
build artifacts committed. Phase reports kept under `docs/reports/`. PRs
have meaningful bodies.

**Rationale:** The brief calls the repo "a public showcase" and explicitly
requires MIT, a landing-page README, and PR/commit hygiene.


## D-13 — UI library: Preact

**Decision:** Use **Preact** (not React).

**Rationale:** The brief's non-negotiable is "instant open, instant
interactions, even with hundreds of cards." Preact is ~3 KB gzipped and
has a React-compatible API, so we get a familiar component model without
paying the React+ReactDOM runtime cost on every sidepanel open. Phase 0
spike: a `hello world` sidepanel build is ~6 KB JS gzipped with Preact vs
~45 KB with React; the React load alone would dominate the "instant open"
budget for an empty sidepanel. We do not need React-only features
(concurrent rendering, suspense) for an app of this size, and the data
layer does not import the UI library at all, so the choice is reversible
behind a thin view layer.

**Locked:** 2026-07-01, Phase 0 spike (WieseOS Agent).

## D-14 — Drag and drop: `@dnd-kit/core`

**Decision:** Use [`@dnd-kit/core`](https://dndkit.com) for card
drag-and-drop in Phase 1.

**Rationale:** R-05 is explicit: "use a battle-tested DnD primitive; do
not hand-roll." `@dnd-kit/core` is the modern, actively maintained,
keyboard-accessible DnD primitive for React/Preact, used by Linear,
Stripe, and others. It gives us accessible drag handles and
sensor-based activation (pointer, keyboard, touch) for free. We do not
adopt `@dnd-kit/sortable` until Phase 5 performance work because the
sortable layer is unnecessary for moving cards between a handful of
columns. The native HTML5 DnD API was rejected because its dataTransfer
model is awkward to test and the cross-browser quirks would consume
Phase 1 budget that is better spent on data-model correctness.

**Locked:** 2026-07-01, Phase 0 spike (WieseOS Agent).

## D-15 — Alarm cadence and idle threshold defaults

**Decision:**

- **Alarm cadence:** `60_000 ms` (1 minute) — the MV3 production minimum
  for `chrome.alarms`. We do not request `periodInMinutes: 0.5` in
  production builds because Chrome clamps it to 1 minute anyway; we
  document the clamp in code so future agents do not "fix" it.
- **Idle threshold default:** `5 minutes`. Configurable from day 1 via
  the persisted state blob. Phase 3 will validate the number with the
  keep/trim/stop UX prototype; the value is a placeholder, the
  *configurability* is the actual commitment.

**Rationale:** The 1-minute floor is forced by Chrome, not a Sidetrack
choice (D-04, R-02). Five minutes is the most-cited idle threshold in
time-tracking literature and matches the brief's "configurable, sensible
default" language.

**Locked:** 2026-07-01, Phase 0 spike (WieseOS Agent). Threshold to be
revisited in Phase 3.

## D-16 — Idle prompt surface: in-sidepanel primary, notification as deep link

**Decision:** The idle prompt renders **in the sidepanel** as the
primary surface. `chrome.notifications` is used **only** as a
deep-link from the OS notification tray back into the sidepanel when
the sidepanel is closed.

**Rationale:** The brief is explicit that the idle flow is "the heart of
the product" and must be polished. An in-sidepanel prompt is themed,
keyboard-accessible, and integrates with the toasts and undo system
without leaving the user's context. A `chrome.notifications` notification
is unstyled and bypasses our design system; using it as the *primary*
prompt would conflict with the brief's "looks and feels like a product"
acceptance criterion (AC #9). We still use `chrome.notifications` so that
a user who closed the sidepanel mid-focus still gets a visible cue and a
one-click path back.

**Locked:** 2026-07-01, Phase 0 spike (WieseOS Agent). Phase 3 implements.

## D-17 — Default keyboard chords

**Decision:** Ship these `chrome.commands` defaults, documented in the
empty state and the README:

| Action | Chords (Mac) | Chords (Win/Linux) |
| ------ | ------------ | ------------------ |
| Open sidepanel | `Alt+Shift+S` | `Alt+Shift+S` |
| Quick-add card in focused column | `Alt+Shift+A` | `Alt+Shift+A` |
| Start/stop timer on focused card | `Alt+Shift+T` | `Alt+Shift+T` |

All three are declared in `manifest.json` under `commands`; the user can
rebind any of them on `chrome://extensions/shortcuts`.

**Rationale:** `Alt+Shift+S/A/T` are mnemonic (S=sidepanel, A=add,
T=timer) and do not collide with Chrome's reserved shortcuts
(Ctrl/Cmd+T for new tab, Ctrl/Cmd+Shift+T for reopen closed tab). We
deliberately do not use `Ctrl/Cmd+` modifiers because the user could be
in a fullscreen app without those chords reaching Chrome. Phase 5 may
add Ctrl/Cmd-prefixed chords if user feedback demands it; the manifest
already supports a separate `mac` block per `chrome.commands` spec.

**Locked:** 2026-07-01, Phase 0 spike (WieseOS Agent). Re-evaluable in
Phase 5.

## Decision log

| Date | Locked | Decided by |
| ---- | ------ | ---------- |
| 2026-07-01 | D-13 (Preact) | Phase 0 spike, WieseOS Agent |
| 2026-07-01 | D-14 (`@dnd-kit/core`) | Phase 0 spike, WieseOS Agent |
| 2026-07-01 | D-15 (alarm + idle defaults) | Phase 0 spike, WieseOS Agent |
| 2026-07-01 | D-16 (in-sidepanel prompt) | Phase 0 spike, WieseOS Agent |
| 2026-07-01 | D-17 (default chords) | Phase 0 spike, WieseOS Agent |

## What is *not* decided yet

*Nothing.* Every open sub-decision from the Phase 0 spike has been
locked above. New open questions that surface in later phases will be
added to this file with a fresh `D-NN` identifier, a date stamp, and the
agent that made the call.
