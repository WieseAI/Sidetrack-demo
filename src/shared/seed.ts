/**
 * Default first-run state.
 *
 * The first time a user opens Sidetrack, we seed the persisted
 * blob with a single board and four columns:
 *
 *   - Inbox      (the capture target for right-click "Add to …")
 *   - Backlog
 *   - In Progress
 *   - Done
 *
 * The order is intentional: Inbox first, then the standard
 * kanban pipeline. The Inbox column on the first board is tagged
 * via `Board.inboxColumnId` so the rest of the code does not have
 * to do a name match.
 *
 * Phase 1 ships a single seed card in the Backlog column so the
 * board is visibly populated, not empty. The card is the same
 * "Welcome to Sidetrack" card described in the empty-state copy
 * the README will eventually show; once Phase 5 lands it can be
 * moved or deleted freely.
 */

import type { Board, Card, Column, PersistedState } from "./model.js";
import { emptyState, SCHEMA_VERSION } from "./model.js";
import { makeBoardId, makeCardId, makeColumnId } from "./ids.js";

/** Build a fresh default state for the given "now" timestamp. */
export function defaultState(now: number): PersistedState {
  const base = emptyState(now);

  const inboxId = makeColumnId();
  const backlogId = makeColumnId();
  const inProgressId = makeColumnId();
  const doneId = makeColumnId();

  const welcomeId = makeCardId();

  const inbox: Column = { id: inboxId, name: "Inbox", cardIds: [] };
  const backlog: Column = {
    id: backlogId,
    name: "Backlog",
    cardIds: [welcomeId],
  };
  const inProgress: Column = {
    id: inProgressId,
    name: "In Progress",
    cardIds: [],
  };
  const done: Column = { id: doneId, name: "Done", cardIds: [] };

  const board: Board = {
    id: makeBoardId(),
    name: "Main",
    columnIds: [inboxId, backlogId, inProgressId, doneId],
    inboxColumnId: inboxId,
  };

  const welcome: Card = {
    id: welcomeId,
    title: "Welcome to Sidetrack",
    description:
      "Drag me to another column to get started. Use the + button (or Alt+Shift+A) to add a new card. Click any card to edit it.",
    entries: [],
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...base,
    schemaVersion: SCHEMA_VERSION,
    boards: [board],
    columns: [inbox, backlog, inProgress, done],
    cards: [welcome],
  };
}
