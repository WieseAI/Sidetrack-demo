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
  CardSource,
  Column,
  ColumnId,
  EntryId,
  IdlePrompt,
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
      /**
       * Phase 4 — right-click "Add to Sidetrack" capture.
       *
       * Creates a card in the given column with the optional
       * `description` and the optional `source` provenance
       * (`{ url, title, selection?, capturedAt }`). The
       * service worker issues this from `chrome.contextMenus`
       * onClicked; the sidepanel issues it when (in the
       * future) a paste/quick-share flow lands. The reducer
       * is the only writer (D-06); the capture message
       * channel is just plumbing.
       */
      type: "capture-card";
      columnId: ColumnId;
      title: string;
      description?: string;
      source?: CardSource;
    }
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
  | { type: "start-timer"; cardId: CardId; now: number }
  | { type: "stop-timer"; now: number }
  | { type: "cold-start-reconcile"; now: number }
  | { type: "replace-state"; state: PersistedState }
  | {
      /**
       * Trim the running timer back to `trimTo`. Closes the
       * current open `TimeEntry` at `trimTo` (with
       * `source: "idle-trim"`) and opens a new `TimeEntry` at
       * `trimTo` so the running entry continues seamlessly.
       * `now` is the wall clock at the moment of the trim
       * (used to advance `lastSeenActive`).
       */
      type: "trim-timer";
      trimTo: number;
      now: number;
    }
  | {
      /**
       * Trim the running timer back to `trimTo` and stop it.
       * Closes the open `TimeEntry` at `trimTo` (with
       * `source: "idle-trim"`) and clears the running block.
       * No new entry is opened. This is the "Stop (and
       * trim)" choice from the idle prompt.
       */
      type: "trim-timer-and-stop";
      trimTo: number;
      now: number;
    }
  | {
      /**
       * Mark a pending idle prompt so the sidepanel knows to
       * render the dialog. `undefined` clears the prompt.
       * The reducer is the only writer of `pendingIdlePrompt`.
       */
      type: "set-idle-prompt";
      prompt: IdlePrompt | undefined;
    }
  | {
      /**
       * Clear any pending idle prompt without affecting the
       * timer. Used by the "Keep all" path, by the Esc-to-
       * dismiss keyboard shortcut, and by sidepanel cold-start
       * suppression once the user has acknowledged the gap.
       */
      type: "dismiss-idle-prompt";
    };

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
    case "capture-card":
      return captureCard(
        state,
        action.columnId,
        action.title,
        action.description,
        action.source,
      );
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
    case "start-timer":
      return startTimer(state, action.cardId, action.now);
    case "stop-timer":
      return stopTimer(state, action.now);
    case "cold-start-reconcile":
      return coldStartReconcile(state, action.now);
    case "replace-state":
      return action.state;
    case "trim-timer":
      return trimTimer(state, action.trimTo, action.now);
    case "trim-timer-and-stop":
      return trimTimerAndStop(state, action.trimTo, action.now);
    case "set-idle-prompt":
      return { ...state, pendingIdlePrompt: action.prompt };
    case "dismiss-idle-prompt":
      return { ...state, pendingIdlePrompt: undefined };
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

/**
 * Phase 4 — capture a card from the right-click "Add to
 * Sidetrack" flow (D-07). Same shape as `createCard` but
 * accepts an optional `description` and a `source` provenance
 * blob. The service worker calls this from
 * `chrome.contextMenus` onClicked; the sidepanel can call it
 * too (e.g. a future paste-to-inbox flow).
 *
 * Title is trimmed; an empty title is a no-op (same as
 * `createCard`). The `source.url` is validated to be a
 * non-empty string when provided; malformed source blobs are
 * dropped (we still create the card, just without the source).
 */
function captureCard(
  state: PersistedState,
  columnId: ColumnId,
  title: string,
  description?: string,
  source?: CardSource,
): PersistedState {
  const trimmed = title.trim();
  if (!trimmed) return state;
  const column = state.columns.find((c) => c.id === columnId);
  if (!column) return state;
  const now = Date.now();
  const card: Card = {
    id: makeCardId(),
    title: trimmed,
    description: description?.trim() || undefined,
    entries: [],
    createdAt: now,
    updatedAt: now,
    source: sanitizeSource(source),
  };
  return {
    ...state,
    cards: [...state.cards, card],
    columns: state.columns.map((c) =>
      c.id === columnId ? { ...c, cardIds: [...c.cardIds, card.id] } : c,
    ),
  };
}

/**
 * Defensive: drop a malformed `source` blob rather than
 * persist garbage. The service worker builds these from
 * `chrome.contextMenus` and the page's `Info` object, but
 * arbitrary contextMenu payloads from older Chrome versions
 * or future extensions should not corrupt the persisted state.
 */
function sanitizeSource(source: CardSource | undefined): CardSource | undefined {
  if (!source) return undefined;
  if (typeof source.url !== "string" || source.url.length === 0) {
    return undefined;
  }
  if (typeof source.title !== "string") {
    return undefined;
  }
  if (typeof source.capturedAt !== "number") {
    return undefined;
  }
  return {
    url: source.url,
    title: source.title,
    selection:
      typeof source.selection === "string" && source.selection.length > 0
        ? source.selection
        : undefined,
    capturedAt: source.capturedAt,
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

// ---- timer helpers ----------------------------------------------------

/**
 * Start a timer on the given card.
 *
 * Single-active-timer rule (brief AC #4): if a timer is already
 * running, this closes it first by appending a final `TimeEntry`
 * to its card with `endAt = now` and `source = "timer"`, then
 * starts a new open entry on the target card. The reducer is
 * the only place the running-timer block is written.
 *
 * Starting a timer on the same card that is already running is
 * a no-op (idempotent): we just refresh `lastSeenActive`.
 */
function startTimer(
  state: PersistedState,
  cardId: CardId,
  now: number,
): PersistedState {
  // If the same card is already running, refresh the anchor and
  // return. We don't want to double-count or close-then-reopen.
  if (state.runningTimer && state.runningTimer.cardId === cardId) {
    if (state.runningTimer.lastSeenActive === now) return state;
    return {
      ...state,
      runningTimer: { ...state.runningTimer, lastSeenActive: now },
      lastSeenActive: now,
    };
  }
  let next: PersistedState = state;
  // Close any other running timer first.
  if (next.runningTimer) {
    next = closeRunningEntry(next, now);
  }
  // Find the target card. If it's been deleted under us, refuse.
  const card = next.cards.find((c) => c.id === cardId);
  if (!card) return next;
  const openEntry: TimeEntry = {
    id: makeEntryId(),
    cardId,
    startAt: now,
    endAt: null,
    source: "timer",
  };
  return {
    ...next,
    cards: next.cards.map((c) =>
      c.id === cardId ? { ...c, entries: [...c.entries, openEntry] } : c,
    ),
    runningTimer: { cardId, startedAt: now, lastSeenActive: now },
    lastSeenActive: now,
  };
}

/**
 * Stop the currently running timer, closing its open entry. If
 * no timer is running, this is a no-op. The `now` argument is
 * taken from the caller (not `Date.now()`) so the reducer stays
 * pure and the service worker can reconcile on cold start with
 * a wall-clock value it has measured itself.
 */
function stopTimer(state: PersistedState, now: number): PersistedState {
  if (!state.runningTimer) return state;
  return {
    ...closeRunningEntry(state, now),
    lastSeenActive: now,
  };
}

/**
 * Trim the running timer back to `trimTo` and stop it.
 *
 * This is the "Stop (and trim)" choice from the idle prompt
 * (brief AC #5). It closes the open `TimeEntry` at `trimTo`
 * with `source: "idle-trim"` and clears the running block.
 * Unlike `trimTimer`, it does NOT open a new entry — the
 * user picked Stop, so the timer is finished.
 *
 * If `trimTo <= startedAt` or there is no running timer, it
 * is equivalent to a plain `stop-timer`.
 */
function trimTimerAndStop(
  state: PersistedState,
  trimTo: number,
  now: number,
): PersistedState {
  const rt = state.runningTimer;
  if (!rt) return state;
  const effectiveTrim = Math.max(trimTo, rt.startedAt);
  return {
    ...state,
    cards: state.cards.map((c) => {
      if (c.id !== rt.cardId) return c;
      let touched = false;
      const entries = c.entries.map((e) => {
        if (touched) return e;
        if (e.endAt !== null) return e;
        if (e.startAt !== rt.startedAt) return e;
        touched = true;
        return { ...e, endAt: effectiveTrim, source: "idle-trim" as const };
      });
      return { ...c, entries };
    }),
    runningTimer: undefined,
    lastSeenActive: now,
    pendingIdlePrompt: undefined,
  };
}

/**
 * Trim the currently running timer back to `trimTo`.
 *
 * "Trim" is the brief's "trim the idle time away" choice from
 * the idle prompt. The semantics: the open `TimeEntry` is
 * closed at `trimTo` with `source: "idle-trim"` (so the user
 * can see in the entry list that the gap was retroactively
 * removed), and a new `TimeEntry` is opened at `trimTo` with
 * `source: "timer"` so the running entry continues seamlessly
 * from the trim point forward. The `RunningTimer.startedAt`
 * anchor is advanced to `trimTo` so elapsed time
 * (`now - startedAt`) reads correctly.
 *
 * If `trimTo` is at or after the running entry's `startedAt`,
 * the function is a no-op (nothing to trim). If there is no
 * running timer, it is a no-op.
 */
function trimTimer(
  state: PersistedState,
  trimTo: number,
  now: number,
): PersistedState {
  const rt = state.runningTimer;
  if (!rt) return state;
  if (trimTo <= rt.startedAt) return state;
  let touched = false;
  const newOpenEntry: TimeEntry = {
    id: makeEntryId(),
    cardId: rt.cardId,
    startAt: trimTo,
    endAt: null,
    source: "timer",
  };
  return {
    ...state,
    cards: state.cards.map((c) => {
      if (c.id !== rt.cardId) return c;
      const entries = c.entries.map((e) => {
        if (touched) return e;
        if (e.endAt !== null) return e;
        if (e.startAt !== rt.startedAt) return e;
        touched = true;
        return { ...e, endAt: trimTo, source: "idle-trim" as const };
      });
      // Only append the new open entry if the trim was real
      // (i.e. the existing entry was actually closed). If the
      // running entry's `startedAt` did not match anything in
      // the card (which can happen if the user manually edited
      // the entry out from under the timer), we still append
      // the new open entry to keep the running block
      // consistent.
      if (!touched) return { ...c, entries: [...entries, newOpenEntry] };
      return { ...c, entries: [...entries, newOpenEntry] };
    }),
    runningTimer: {
      cardId: rt.cardId,
      startedAt: trimTo,
      lastSeenActive: now,
    },
    lastSeenActive: now,
    // Mark the prompt as `trimmed-recently` rather than
    // clearing it so the next alarm tick within the cooldown
    // window does not re-prompt for the same gap. The
    // detector (`evaluateIdle`) reads the `kind` and
    // short-circuits. The dismissed-recently lifetime lives
    // in `TRIM_RECENTLY_LIFETIME_MS` in `idle.ts`.
    pendingIdlePrompt: {
      cardId: rt.cardId,
      entryId: newOpenEntry.id,
      detectedAt: now,
      lastSeenActive: now,
      idleForMs: 0,
      kind: "trimmed-recently",
    },
  };
}

/**
 * Internal: close the currently running timer's open `TimeEntry`
 * by setting `endAt = now` and clearing the `runningTimer` block.
 * The reducer is the only writer of the running block, so the
 * invariant "exactly one running timer or none" is enforced here.
 *
 * If the card has been deleted while the timer was running, we
 * still close the entry (writing the entry update is a no-op
 * because the card is gone) and clear the running block. This
 * can happen if the user deletes a card from another window
 * while a timer is running on it; the orphaned running block
 * must not survive the next cold start.
 */
function closeRunningEntry(state: PersistedState, now: number): PersistedState {
  const rt = state.runningTimer;
  if (!rt) return state;
  return {
    ...state,
    cards: state.cards.map((c) => {
      if (c.id !== rt.cardId) return c;
      // The open entry is the one with `endAt === null` and a
      // matching startAt. There should be exactly one.
      let touched = false;
      const entries = c.entries.map((e) => {
        if (touched) return e;
        if (e.endAt !== null) return e;
        if (e.startAt !== rt.startedAt) return e;
        touched = true;
        return { ...e, endAt: now };
      });
      return { ...c, entries };
    }),
    runningTimer: undefined,
  };
}

/**
 * Cold-start reconciliation.
 *
 * Called by the service worker on startup (and on every alarm
 * tick). If a running timer exists, we just refresh the
 * `lastSeenActive` anchor on it; we never stop it here — that
 * decision belongs to the user-facing prompt in Phase 3, which
 * is the only place that can read the user's intent about a
 * long gap.
 *
 * If the running timer points at a card that no longer exists,
 * we silently clear it (it would be impossible for the user to
 * resolve).
 */
function coldStartReconcile(
  state: PersistedState,
  now: number,
): PersistedState {
  if (!state.runningTimer) return state;
  const card = state.cards.find((c) => c.id === state.runningTimer!.cardId);
  if (!card) {
    return { ...state, runningTimer: undefined };
  }
  return {
    ...state,
    runningTimer: { ...state.runningTimer, lastSeenActive: now },
    lastSeenActive: now,
  };
}
