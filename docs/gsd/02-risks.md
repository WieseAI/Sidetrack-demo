# Sidetrack — Risks

> Living risk register. Reviewed at the end of every phase; new risks added
> with date and owner. Items are tracked through to mitigation or
> explicit acceptance.

Each risk has: **what** (one line), **why it matters** (impact), **likelihood**
(low/med/high), **mitigation** (what we do about it), and **status**
(open / mitigated / accepted).

## R-01 — Service worker kills silently drop in-flight state

- **What:** MV3 service workers can be terminated at any time after ~30s of
  inactivity; a kill mid-mutation could leave storage and memory in
  inconsistent states.
- **Why:** Data safety is a non-negotiable. The brief says "I should never
  lose boards or tracked time from a crash, update, or browser restart."
- **Likelihood:** Medium.
- **Mitigation:** Single `mutate(fn)` helper that (a) holds a serialization
  lock, (b) writes the new blob atomically (`chrome.storage.local.set` is
  atomic per key), (c) updates the local cache last. No partial writes
  across multiple keys.
- **Status:** Mitigated by D-06. Phase 1 must enforce the helper.

## R-02 — `chrome.alarms` 1-minute floor makes idle detection coarse

- **What:** MV3 caps alarm cadence at 30s in development, 1 minute in
  production. Idle detection can't fire faster than that.
- **Why:** The brief's idle prompt is the product's centerpiece UX; "I was
  idle for 4 minutes" is fine, "I was idle for 4 minutes and the prompt
  fired 2 minutes late" is not.
- **Likelihood:** Medium.
- **Mitigation:** Use the 1-minute alarm as the *decision* tick, but use
  `chrome.idle.onStateChanged` and the `last_seen_active` timestamp so the
  *prompt fires within a minute* of crossing the threshold. Visible timer
  in the sidepanel re-renders against the anchor every second so the user
  sees drift-free elapsed time even if the prompt is late.
- **Status:** Open, mitigations defined in D-08 and the Phase 3 issue.

## R-03 — Browser-was-closed gap semantics

- **What:** If the user closes Chrome with a timer running and comes back
  hours later, the timer has been "running" the whole time at the data
  layer. Silently keeping it would over-count; silently discarding would
  under-count.
- **Why:** The brief calls this out explicitly: "If I was away so long the
  browser was closed, handle it gracefully when I come back: ask me what to
  do with the gap instead of silently keeping or discarding it."
- **Likelihood:** High (this will happen constantly).
- **Mitigation:** On cold start, if a timer was running and
  `now - last_seen_active > threshold`, surface a one-time prompt with the
  same keep/trim/stop options as the live idle prompt, defaulting to
  **trim**. Detailed UX in Phase 3.
- **Status:** Open. Tracked by Phase 3.

## R-04 — Single-active-timer race

- **What:** Two surfaces (e.g. sidepanel + a global keyboard shortcut)
  could start timers on different cards in the same tick.
- **Why:** Brief rule: "Only one timer runs at a time — starting a timer on
  another card stops the previous one (and tells me it did)." A race would
  violate this and could double-count.
- **Likelihood:** Low (single user, MV3 service worker is single-threaded).
- **Mitigation:** The `mutate(fn)` lock (R-01) makes start/stop serial in
  the service worker. UI surfaces call into the same `startTimer(cardId)`
  entry point, which atomically stops the previous entry and starts the
  new one. The "previous was stopped" toast is generated from the delta
  inside the lock.
- **Status:** Open. Tracked by Phase 2.

## R-05 — Drag-and-drop jank at scale

- **What:** The brief's hard requirement: "smooth and native, not janky"
  drag and drop, "instant interactions, even with hundreds of cards."
- **Why:** A janky DnD is a one-star review.
- **Likelihood:** Medium.
- **Mitigation:** Virtualized column rendering (only mount cards in
  viewport) before Phase 5 ships. Use a battle-tested DnD primitive
  (HTML5 DnD or a 3rd-party helper); do not hand-roll. Phase 0 spike
  benchmarks with 500 cards before locking the choice.
- **Status:** Open. Tracked by Phase 0 and Phase 1.

## R-06 — Storage quota and write amplification

- **What:** `chrome.storage.local` is quota-limited (default ~10 MB).
  Writing the entire blob on every mutation is fine at this size but is
  a footgun if state grows.
- **Why:** Performance and durability.
- **Likelihood:** Low (brief says "hundreds of cards" — that fits in
  single-digit MB comfortably).
- **Mitigation:** D-05's IndexedDB escape hatch. Debounce writes on
  high-frequency events (e.g. timer tick) — the timer tick should never
  write; it should only re-render from the anchor.
- **Status:** Open. Tracked by Phase 1.

## R-07 — No real GitHub issues / no `gh` CLI in worker

- **What:** The WieseOS worker has no `gh` CLI, no GitHub remote, and the
  outbound HTTP allowlist is empty. "Get issues into GH" cannot be
  literal GitHub API calls from this environment.
- **Why:** The task brief asks for GSD planning with issues ready for
  agents; we need an artifact that downstream agents can pick up.
- **Likelihood:** High (it's a structural fact of the worker, not a
  probabilistic one).
- **Mitigation:** Issues are committed as Markdown files in
  `docs/issues/` with a stable, sortable naming scheme. The repo's
  `docs/gsd/00-overview.md` and `docs/issues/README.md` are the index.
  When the public showcase repo is pushed to GitHub, those files can be
  imported as issues with a one-shot `gh issue create --body-file` loop
  run by a human operator. The `body` field of each issue is the
  ready-to-paste markdown body. See `docs/issues/README.md`.
- **Status:** Accepted. Documented.

## R-08 — Showcase-repo "demo" of autonomous work

- **What:** The brief says the repo is a public showcase and will be read
  by strangers as a demo of autonomous development. Commit and PR
  hygiene has to be exemplary.
- **Why:** Reputation; this is the *product* the OS is selling.
- **Likelihood:** Medium.
- **Mitigation:** Conventional commits, no noise commits, phase reports
  kept under `docs/reports/`, README is a landing page, MIT license from
  the first commit. Enforced by Phase 5.
- **Status:** Open. Tracked by D-12 and Phase 5.

---

## Risks added during Phase 0 (2026-07-01, WieseOS Agent)

### R-09 — Preact ecosystem compatibility for chosen libraries

- **What:** D-13 chose Preact to keep the sidepanel cold-start small;
  some libraries in the dnd/a11y ecosystem are React-first and rely on
  React-only APIs.
- **Why:** A library that hard-imports `react` would silently bring
  React into the bundle and erase the cold-start win.
- **Likelihood:** Low for `@dnd-kit/core` (it has a Preact-compatible
  build), medium for unselected future dependencies.
- **Mitigation:** Pin `preact/compat` as the JSX runtime, and gate any
  new dependency on a "weighs less than 10 KB and runs on Preact" check
  before adoption. Phase 1 adds a CI bundle-size budget so a React-only
  import is caught at PR time, not at runtime.
- **Status:** Open. Tracked by Phase 1.

### R-10 — Vite MV3 build output drift

- **What:** Vite's default behaviour is to emit assets using
  root-relative URLs and inline small assets. MV3 service workers and
  extension pages must load everything from the extension's own
  packaged files, and `web_accessible_resources` plus CSP must be set
  accordingly.
- **Why:** A silent regression in a Vite major upgrade (or in a plugin
  like `@crxjs/vite-plugin`) could produce a `dist/` that loads in dev
  but fails in a clean Chrome profile with a CSP or 404 error.
- **Likelihood:** Medium (Vite ships breaking changes; we depend on
  community plugins).
- **Mitigation:** Pin Vite and the CRX plugin in `package.json`, add
  a Phase 1 smoke test that runs `vite build` and grep-asserts that
  `manifest.json` is in `dist/`, the service worker is emitted as
  `dist/background.js`, and no `<script src="http">` survives. The
  smoke test is a one-shot node script that exits non-zero on
  failure.
- **Status:** Open. Tracked by Phase 1.

### R-11 — `chrome.commands` chords collide with OS or other extension chords

- **What:** `Alt+Shift+S/A/T` are likely free in a clean Chrome profile
  but are not guaranteed free on a user's machine, where another
  extension may have claimed the same chord, or where the OS reserves
  the chord (some Linux WMs do).
- **Why:** A bound chord that does not fire is a confusing first-run
  experience.
- **Likelihood:** Medium.
- **Mitigation:** The `chrome.commands` API itself surfaces the conflict
  via `chrome.commands.getAll()`; we read it on first run and surface a
  "this chord is taken, here's how to rebind" hint in the empty state
  if any of our chords are unavailable. Documenting the rebind path on
  `chrome://extensions/shortcuts` in the README is the secondary
  mitigation.
- **Status:** Open. Tracked by Phase 5 (where commands are user-visible).

### R-12 — First real-user load surfaces a manifest/CSP regression

- **What:** Phase 0's Definition of Done is "loadable in a clean Chrome
  profile." That profile is not every user's profile; a real user may
  have additional extensions, a custom CSP set by corporate IT, or a
  Chrome flag we did not test.
- **Why:** The first public release of a sidepanel extension is the one
  strangers see; a console error on open is a one-star review.
- **Likelihood:** Medium.
- **Mitigation:** Phase 5 (or the public release) installs Sidetrack on
  at least three diverse real profiles (default Chrome, Chrome with
  1Password, Chrome on a managed/corporate device) and walks through
  the empty-sidepanel load + open flow with the DevTools console open.
  Any CSP or service-worker error is filed as a P0 before tagging.
- **Status:** Open. Tracked by Phase 5.
