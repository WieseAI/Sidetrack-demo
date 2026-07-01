<!-- labels: phase-1, gsd, kanban, data -->

# Phase 1 — Data layer & kanban core

## User story

As a user, I can open Sidetrack, see a sensible default board, create and
edit boards/columns/cards, drag cards between columns smoothly, export my
data to JSON, and import it back. None of my work is lost across a
browser restart.

## Phase goal

Ship the data model, the persistence layer, and the kanban UI in the
sidepanel. No timers yet — those are Phase 2.

## Scope

- Data model in `src/shared/model.ts` (or similar):
  - `Board { id, name, columns: Column[] }`
  - `Column { id, name, cardIds: string[] }`
  - `Card { id, title, description?, dueDate?, entries: TimeEntry[], createdAt, updatedAt, source? }`
  - `TimeEntry` is a stub here; Phase 2 fleshes it out.
  - `schemaVersion: 1` on the persisted root.
- Persistence:
  - `src/shared/storage.ts` wraps `chrome.storage.local` (per D-05).
  - `mutate(fn)` helper that serializes mutations (per D-06 and R-01).
  - `exportState()` and `importState(json)` with version validation
    and atomic replace.
- UI in `src/sidepanel/`:
  - Board picker / create-board.
  - Columns with cards.
  - Card quick-add (one keystroke, just a title).
  - Full add/edit dialog (title, description, due date).
  - Drag-and-drop cards within and between columns, smooth and
    persistent.
  - Right-click context menu on a card (rename, delete, move to column).
  - Default board on first run: Backlog / In Progress / Done, with
    an additional **Inbox** column on the first board (per D-07).
  - Light + dark theme via CSS variables, system-default (per D-09).
- Build out `docs/reports/phase-1.md` with the same template.

## Out of scope

- Timers. Cards render with `entries: []` and a placeholder
  "0m tracked." Time tracking is Phase 2.
- Idle detection, capture, reports.
- Performance benchmarking at hundreds of cards (that's Phase 5; we
  pick the DnD approach in Phase 0 and verify the choice at scale
  in Phase 5).

## Acceptance criteria

- [ ] Fresh install shows a default board (Backlog / In Progress / Done
      + an Inbox column) and is usable in 30 seconds (brief AC #1).
- [ ] All CRUD on boards, columns, and cards works and persists across
      sidepanel close + reopen and across browser restart.
- [ ] Drag-and-drop reorders persist and feel smooth (brief AC #2). No
      visible flicker.
- [ ] Export to JSON file produces a versioned blob; import on a clean
      profile restores all data (brief AC #8).
- [ ] A force-quit of the sidepanel mid-edit does not leave the data
      layer in an inconsistent state (validates R-01 mitigation).
- [ ] `docs/reports/phase-1.md` exists.

## Dependencies

- [Phase 0 — Research & foundation](00-phase-0-research-and-foundation.md)

## Definition of done

The user can use Sidetrack as a kanban board without any time tracking.
Data is durable. Drag-and-drop feels good. Export/import works.
