# Sidetrack — Product Brief

**What:** A Chrome extension (sidepanel) that combines a Kanban board with per-task time tracking. Fully offline, local-first, no accounts, no server.

**Who I am:** A regular user describing what I want. I am not prescribing how to build it. Where this brief is unclear, incomplete, or where multiple approaches exist, **you must research the topic yourself** (Chrome extension best practices, sidepanel APIs, UX patterns for kanban and time tracking, notification behavior) and pick the best approach. Document what you researched and why you chose what you chose.

**Quality bar:** User experience is the top priority. This should feel like a polished product someone would pay for — smooth, fast, obvious to use without a manual. If a feature works but feels clunky, it is not done.

---

## The idea

I manage my tasks on a kanban board, and I want to know how much time each task actually takes. Today I'd need two separate tools and I forget to start/stop timers. Sidetrack lives in the Chrome sidepanel so it's always one click away next to whatever I'm working on.

## Core experience

### Kanban board
- Boards with columns and cards. I can create, rename, reorder, and delete all three.
- Sensible default board on first launch (e.g. Backlog / In Progress / Done) so it's useful immediately — but everything is editable.
- Drag and drop cards between and within columns. This must feel smooth and native, not janky.
- Cards have: title (required), description (optional), due date (optional), and their accumulated tracked time visible at a glance.
- Quick-add: I can add a card with just a title in one keystroke-friendly flow, without opening a dialog full of fields.
- Right-click on any web page (or select text and right-click) → "Add to Sidetrack" → creates a card with the page title and URL attached. It should land somewhere obvious (an Inbox-style destination).

### Time tracking
- Every card has a start/stop timer. One click to start, one click to stop.
- Only one timer runs at a time — starting a timer on another card stops the previous one (and tells me it did).
- The running timer is always visible somewhere prominent in the sidepanel, including which task it belongs to and elapsed time, even while I'm looking at a different board.
- Each card shows total tracked time. I can see a breakdown of individual time entries on a card, and edit or delete entries manually (I will make mistakes; let me fix them).
- **The timer must survive everything:** closing the sidepanel, restarting the browser, the computer sleeping. If I started a timer at 09:00 and reopen Chrome at 11:00, the timer shows 2 hours. Never lose or drift tracked time.

### Idle / forgot-to-stop protection
- If a timer is running and I haven't been active for X minutes (configurable, sensible default), notify me.
- The notification/prompt gives me real choices, at minimum: **keep all the time**, **trim the idle time away** (retroactively, back to when I went idle), or **stop the timer** (also trimmed). This is the feature that makes forgetting painless — get the UX of this flow right.
- If I was away so long the browser was closed, handle it gracefully when I come back: ask me what to do with the gap instead of silently keeping or discarding it.

### Reports (simple)
- A basic view answering: where did my time go today / this week? Per task and per board. Nothing fancy — a clear list or simple chart. Research what minimal time-report UX users actually find useful.

## Non-negotiables
- **Offline-first, local-only.** All data stays on my machine. No accounts, no backend, no telemetry, no external services at runtime. It must work with no internet connection at all.
- **Export / import** all data as a JSON file (my insurance policy).
- **Data safety.** I should never lose boards or tracked time from a crash, update, or browser restart. Treat my data as precious.
- **Sidepanel is the primary UI.** Research the current Chrome sidepanel APIs and conventions and do it the recommended way.
- **Performance.** Instant open, instant interactions, even with hundreds of cards.
- **Keyboard friendly.** Common actions (quick-add, start/stop timer, search) should have shortcuts. Discoverable, not hidden.

## Explicitly OUT of scope (do not build)
- Sync, cloud backup, multi-device
- Accounts, login, sharing, collaboration
- Mobile, other browsers
- Integrations (calendar, Jira, etc.)
- Billing rates / invoicing

If you find yourself building infrastructure for any of these "for later," stop — that's scope drift.

## Design & UX expectations
- Clean, calm, modern. A tool I look at all day should be pleasant, not noisy.
- Light and dark theme (follow system by default).
- Empty states, error states, and first-run experience must be designed, not accidental. A brand-new user should understand the product within 30 seconds without instructions.
- Micro-interactions matter: drag feedback, timer state changes, confirmations for destructive actions (with undo where researchably standard).
- Accessible: keyboard navigation and reasonable contrast are not optional.

---

## Public repository requirements

This repo is **public** and doubles as a showcase. That means:

- **MIT license** from the first commit.
- **README is a landing page**, not an afterthought: what Sidetrack is, screenshots/GIF, install instructions (load-unpacked), feature list, and a clear note that this project was **built autonomously by WieseAI OS** from this brief — link the brief.
- **Commit and PR hygiene matters** — the history will be read by strangers as a demo of autonomous development. Clear, conventional commit messages; PRs that explain what and why. No noise commits, no "fix fix fix2".
- **Zero secrets, keys, or personal data** in any commit, ever. Nothing to leak here (no backend), but treat it as a hard rule anyway.
- Keep the phase reports in the repo (e.g. `docs/reports/`) — the documented research and decisions are part of the showcase.

## How to work (GSD phases)

Work in phases. Each phase ends with a working, demonstrable state and a short report: what was built, what you researched and decided, what's risky, what's next. Do not start the next phase on a broken previous one.

### Phase 0 — Research & foundation
Research: current Chrome extension architecture (manifest version, sidepanel API, background/service worker lifecycle and its limitations, storage options for this kind of data, notification and idle-detection APIs, context menus). Decide and document the architecture, data model, and how you will guarantee the timer-survives-everything requirement given how Chrome manages extension background processes. Set up the repo structure, build tooling, and a loadable skeleton extension with an empty sidepanel.

### Phase 1 — Data layer & kanban core
Data model + persistence for boards/columns/cards. Board UI in the sidepanel: full CRUD, drag and drop, quick-add. Default board on first run. Export/import JSON.

### Phase 2 — Time tracking
Timers on cards, single-active-timer rule, prominent running-timer display, time entries with manual edit/delete, per-card totals. Prove the survive-restart requirement with a written test scenario.

### Phase 3 — Idle protection & notifications
Idle detection, configurable threshold, the notification with keep/trim/stop choices, the graceful browser-was-closed gap handling. This flow's UX is the heart of the product — polish it.

### Phase 4 — Capture & reports
Right-click "Add to Sidetrack" from pages/selections with URL attached. The simple today/this-week time report.

### Phase 5 — Polish & release quality
First-run experience, empty states, themes, keyboard shortcuts, accessibility pass, performance check with a large dataset, undo for destructive actions. A README with screenshots and install instructions (load-unpacked). Final self-review against every requirement in this brief — list each with pass/fail.

---

## Acceptance criteria (the ones I will personally test)

1. Fresh install → I understand and can use the board within 30 seconds, no docs.
2. Drag a card between columns — smooth, no flicker, order persists after closing/reopening the sidepanel.
3. Start a timer, quit Chrome entirely, wait, reopen — elapsed time is correct to the minute.
4. Start timer on card A, then start on card B — A stops automatically and I'm informed.
5. Leave the computer with a timer running — I get the idle prompt and "trim idle time" removes exactly the idle period from the entry.
6. Right-click a web page → card appears with title + link.
7. Airplane mode: everything above still works.
8. Export JSON, wipe the extension, import — everything is back.
9. It looks and feels like a product, not a prototype.

Anything ambiguous in this brief: research it, decide, document the decision. Do not stop to ask unless a decision is truly irreversible or contradicts a non-negotiable.
