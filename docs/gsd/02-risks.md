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
