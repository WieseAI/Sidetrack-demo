/**
 * Reducer for Sidetrack's persisted state.
 *
 * All state changes go through `applyAction(state, action)`. The
 * function is pure: it never touches `chrome.storage`, never reads
 * the wall clock, never logs. The `mutate(fn)` helper in
 * `storage.ts` calls it from inside a serialization lock, then
 * persists the result.
 *
 * The brief and D-06 are explicit: there is exactly one path for
 * writes. Adding a new feature is a two-step process: extend
 * `Action` below, then teach `applyAction` how to handle it. There
 * is no second writer anywhere in the app.
 */

import type {
  Board,
  BoardId,
  Card,
  CardId,
  Column,
  ColumnId,
  EntryId,
  PersistedState,
  TimeEntry,
} from "./model.js";
import {
  makeBoardId,
  makeCardId,
  makeColumnId,
  makeEntryId,
} from "./ids.js";

/** All mutations the UI can request. */
export type Action =
  | { type: "create-board"; name: string }
  | { type: "rename-board"; boardId: BoardId; name: string }
  | { type: "delete-board"; boardId: BoardId }
  | { type: "create-column"; boardId: BoardId; name: string }
  | {
      type: "rename-column";
      columnId: ColumnId;
      name: string;
    }
  | { type: "delete-column"; columnId: ColumnId }
  | { type: "reorder-columns"; boardId: BoardId; columnIds: ColumnId[] }
  | { type: "create-card"; columnId: ColumnId; title: string }
  | {
      type: "update-card";
      cardId: CardId;
      patch: Partial<
        Pick<Card, "title" | "description" | "dueDate">
      >;
    }
  | { type: "delete-card"; cardId: CardId }
  | {
      type: "move-card";
      cardId: CardId;
      toColumnId: ColumnId;
      toIndex: number;
    }
  | { type: "reorder-cards"; columnId: ColumnId; cardIds: CardId[] }
  | {
      type: "add-entry";
      cardId: CardId;
      entry: Omit<TimeEntry, "id" | "cardId">;
    }
  | {
      type: "update-entry";
      cardId: CardId;
      entryId: EntryId;
      patch: Partial<Pick<TimeEntry, "startAt" | "endAt" | "note">>;
    }
  | { type: "delete-entry"; cardId: CardId; entryId: EntryId }
  | { type: "touch-active"; now: number }
  | {
      type: "set-setting";
      key: "idleThresholdSeconds";
      value: number;
    }
  | { type: "replace-state"; state: PersistedState };

/** Apply an action to produce a new state. */
export function applyAction(state: PersistedState, action: Action): PersistedState {
  switch (action.type) {
    case "create-board":
      return createBoard(state, action.name);
    case "rename-board":
      return renameBoard(state, action.boardId, action.name);
    case "delete-board":
      return deleteBoard(state, action.boardId);
    case "create-column":
      return createColumn(state, action.boardId, action.name);
    case "rename-column":
      return renameColumn(state, action.columnId, action.name);
    case "delete-column":
      return deleteColumn(state, action.columnId);
    case "reorder-columns":
      return reorderColumns(state, action.boardId, action.columnIds);
    case "create-card":
      return createCard(state, action.columnId, action.title);
    case "update-card":
      return updateCard(state, action.cardId, action.patch);
    case "delete-card":
      return deleteCard(state, action.cardId);
    case "move-card":
      return moveCard(state, action.cardId, action.toColumnId, action.toIndex);
    case "reorder-cards":
      return reorderCards(state, action.columnId, action.cardIds);
    case "add-entry":
      return addEntry(state, action.cardId, action.entry);
    case "update-entry":
      return updateEntry(state, action.cardId, action.entryId, action.patch);
    case "delete-entry":
      return deleteEntry(state, action.cardId, action.entryId);
    case "touch-active":
      return { ...state, lastSeenActive: action.now };
    case "set-setting":
      return {
        ...state,
        settings: { ...state.settings, [action.key]: action.value },
      };
    case "replace-state":
      return action.state;
  }
}

// ---- helpers ----------------------------------------------------------

function createBoard(state: PersistedState, name: string): PersistedState {
  const trimmed = name.trim() || "Untitled board";
  const board: Board = {
    id: makeBoardId(),
    name: trimmed,
    columnIds: [],
  };
  return { ...state, boards: [...state.boards, board] };
}

function renameBoard(
  state: PersistedState,
  boardId: BoardId,
  name: string,
): PersistedState {
  return {
    ...state,
    boards: state.boards.map((b) =>
      b.id === boardId ? { ...b, name: name.trim() || b.name } : b,
    ),
  };
}

function deleteBoard(state: PersistedState, boardId: BoardId): PersistedState {
  // Refuse to delete the last board; the user would be left with
  // an empty workspace. The UI guards this too, but the reducer is
  // the last line of defense.
  if (state.boards.length <= 1) return state;
  const columnIds = new Set(
    state.boards.find((b) => b.id === boardId)?.columnIds ?? [],
  );
  const cardIds = new Set(
    state.columns
      .filter((c) => columnIds.has(c.id))
      .flatMap((c) => c.cardIds),
  );
  return {
    ...state,
    boards: state.boards.filter((b) => b.id !== boardId),
    columns: state.columns.filter((c) => !columnIds.has(c.id)),
    cards: state.cards.filter((card) => !cardIds.has(card.id)),
  };
}

function createColumn(
  state: PersistedState,
  boardId: BoardId,
  name: string,
): PersistedState {
  const board = state.boards.find((b) => b.id === boardId);
  if (!board) return state;
  const column: Column = {
    id: makeColumnId(),
    name: name.trim() || "Untitled column",
    cardIds: [],
  };
  return {
    ...state,
    columns: [...state.columns, column],
    boards: state.boards.map((b) =>
      b.id === boardId ? { ...b, columnIds: [...b.columnIds, column.id] } : b,
    ),
  };
}

function renameColumn(
  state: PersistedState,
  columnId: ColumnId,
  name: string,
): PersistedState {
  return {
    ...state,
    columns: state.columns.map((c) =>
      c.id === columnId ? { ...c, name: name.trim() || c.name } : c,
    ),
  };
}

function deleteColumn(state: PersistedState, columnId: ColumnId): PersistedState {
  // The Inbox column on the first board is not deletable.
  const inbox = state.boards.find((b) => b.inboxColumnId === columnId);
  if (inbox) return state;
  // Find the column; refuse to delete the last column of the last
  // board (the workspace would be unusable).
  const col = state.columns.find((c) => c.id === columnId);
  if (!col) return state;
  const owningBoard = state.boards.find((b) => b.columnIds.includes(columnId));
  if (!owningBoard) return state;
  if (owningBoard.columnIds.length <= 1) return state;

  const cardIds = new Set(col.cardIds);
  return {
    ...state,
    columns: state.columns.filter((c) => c.id !== columnId),
    cards: state.cards.filter((card) => !cardIds.has(card.id)),
    boards: state.boards.map((b) =>
      b.id === owningBoard.id
        ? { ...b, columnIds: b.columnIds.filter((id) => id !== columnId) }
        : b,
    ),
  };
}

function reorderColumns(
  state: PersistedState,
  boardId: BoardId,
  columnIds: ColumnId[],
): PersistedState {
  return {
    ...state,
    boards: state.boards.map((b) =>
      b.id === boardId ? { ...b, columnIds: [...columnIds] } : b,
    ),
  };
}

function createCard(
  state: PersistedState,
  columnId: ColumnId,
  title: string,
): PersistedState {
  const trimmed = title.trim();
  if (!trimmed) return state;
  const column = state.columns.find((c) => c.id === columnId);
  if (!column) return state;
  const now = Date.now();
  const card: Card = {
    id: makeCardId(),
    title: trimmed,
    entries: [],
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...state,
    cards: [...state.cards, card],
    columns: state.columns.map((c) =>
      c.id === columnId ? { ...c, cardIds: [...c.cardIds, card.id] } : c,
    ),
  };
}

function updateCard(
  state: PersistedState,
  cardId: CardId,
  patch: Partial<Pick<Card, "title" | "description" | "dueDate">>,
): PersistedState {
  return {
    ...state,
    cards: state.cards.map((c) =>
      c.id === cardId
        ? {
            ...c,
            ...patch,
            title: patch.title?.trim() || c.title,
            updatedAt: Date.now(),
          }
        : c,
    ),
  };
}

function deleteCard(state: PersistedState, cardId: CardId): PersistedState {
  return {
    ...state,
    cards: state.cards.filter((c) => c.id !== cardId),
    columns: state.columns.map((c) => ({
      ...c,
      cardIds: c.cardIds.filter((id) => id !== cardId),
    })),
  };
}

function moveCard(
  state: PersistedState,
  cardId: CardId,
  toColumnId: ColumnId,
  toIndex: number,
): PersistedState {
  return reorderAllCardPositions(state, toColumnId, toIndex, cardId);
}

function reorderCards(
  state: PersistedState,
  columnId: ColumnId,
  cardIds: CardId[],
): PersistedState {
  return {
    ...state,
    columns: state.columns.map((c) =>
      c.id === columnId ? { ...c, cardIds: [...cardIds] } : c,
    ),
  };
}

function addEntry(
  state: PersistedState,
  cardId: CardId,
  entry: Omit<TimeEntry, "id" | "cardId">,
): PersistedState {
  const full: TimeEntry = {
    ...entry,
    id: makeEntryId(),
    cardId,
  };
  return {
    ...state,
    cards: state.cards.map((c) =>
      c.id === cardId ? { ...c, entries: [...c.entries, full] } : c,
    ),
  };
}

function updateEntry(
  state: PersistedState,
  cardId: CardId,
  entryId: EntryId,
  patch: Partial<Pick<TimeEntry, "startAt" | "endAt" | "note">>,
): PersistedState {
  return {
    ...state,
    cards: state.cards.map((c) => {
      if (c.id !== cardId) return c;
      return {
        ...c,
        entries: c.entries.map((e) =>
          e.id === entryId ? { ...e, ...patch } : e,
        ),
      };
    }),
  };
}

function deleteEntry(
  state: PersistedState,
  cardId: CardId,
  entryId: EntryId,
): PersistedState {
  return {
    ...state,
    cards: state.cards.map((c) =>
      c.id === cardId
        ? { ...c, entries: c.entries.filter((e) => e.id !== entryId) }
        : c,
    ),
  };
}

/**
 * Internal helper: move a card between columns (or reorder within
 * a column) while clamping the target index to the destination's
 * bounds. The function handles the "drop in the same column" and
 * "drop in another column" cases with a single code path.
 */
function reorderAllCardPositions(
  state: PersistedState,
  toColumnId: ColumnId,
  toIndex: number,
  cardId: CardId,
): PersistedState {
  // Find the source column and the destination column.
  const sourceColumn = state.columns.find((c) => c.cardIds.includes(cardId));
  const destColumn = state.columns.find((c) => c.id === toColumnId);
  if (!sourceColumn || !destColumn) return state;

  // Remove from source, then insert at clamped index in dest.
  const removed = sourceColumn.cardIds.filter((id) => id !== cardId);
  const insertAt = Math.max(0, Math.min(toIndex, destColumn.cardIds.length));
  const inserted =
    sourceColumn.id === destColumn.id
      ? withInserted(removed, cardId, insertAt)
      : withInserted(destColumn.cardIds, cardId, insertAt);

  return {
    ...state,
    columns: state.columns.map((c) => {
      if (c.id === sourceColumn.id && c.id === destColumn.id) {
        return { ...c, cardIds: inserted };
      }
      if (c.id === sourceColumn.id) return { ...c, cardIds: removed };
      if (c.id === destColumn.id) return { ...c, cardIds: inserted };
      return c;
    }),
  };
}

function withInserted<T>(arr: readonly T[], item: T, index: number): T[] {
  const next = [...arr];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}
