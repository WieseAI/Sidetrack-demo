/**
 * Sidetrack data model.
 *
 * This module is the single source of truth for the shape of the
 * persisted state. Both the sidepanel UI and the service worker
 * import these types; the data layer never reaches into UI
 * primitives and the UI never invents its own fields. R-01 / D-06
 * require that the persisted blob be small enough to round-trip
 * atomically through `chrome.storage.local`; the shape below is
 * designed to be JSON-serializable in a single `set` call.
 *
 * Phase 1 deliberately keeps the type surface small. Phase 2
 * extends `TimeEntry` and adds the `RunningTimer` block on the
 * persisted root. Phase 4 adds the `Report` block. Each phase adds
 * fields behind `schemaVersion` so older blobs can still be loaded.
 */

import { PROJECT_NAME } from "./version.js";

/**
 * Current schema version. Bump on any breaking change to the
 * persisted shape. `storage.ts` refuses to load a blob whose
 * `schemaVersion` it does not understand; migrations would bring
 * older blobs forward (none needed at v1).
 */
export const SCHEMA_VERSION = 1 as const;

/**
 * Brand helper for IDs. The string type is enough at runtime; the
 * brand only exists so we don't accidentally pass a `boardId` where
 * a `columnId` is expected.
 */
export type Id<T extends string> = string & { readonly __brand: T };

export type BoardId = Id<"Board">;
export type ColumnId = Id<"Column">;
export type CardId = Id<"Card">;
export type EntryId = Id<"Entry">;

/** A closed time-tracking entry. Phase 1 ships this as a stub. */
export interface TimeEntry {
  id: EntryId;
  cardId: CardId;
  /** Unix epoch ms. */
  startAt: number;
  /** Unix epoch ms. `null` means the entry is open (Phase 2). */
  endAt: number | null;
  /**
   * Origin of the entry. Phase 1 only ever writes `"manual"` because
   * the timer feature is Phase 2; the union still lists the values
   * Phase 2+ will use so the model is complete from day one.
   */
  source: "manual" | "timer" | "idle-trim";
  note?: string;
}

/** A card lives on a single column. Card order within a column is
 *  the position in the column's `cardIds` array. */
export interface Card {
  id: CardId;
  title: string;
  description?: string;
  /** ISO 8601 date (YYYY-MM-DD), no time component. `undefined`
   *  means "no due date set." */
  dueDate?: string;
  entries: TimeEntry[];
  createdAt: number;
  updatedAt: number;
  /** Where the card came from. `undefined` for user-typed cards,
   *  populated by the right-click "Add to Sidetrack" capture in
   *  Phase 4. */
  source?: CardSource;
}

export interface CardSource {
  url: string;
  title: string;
  /** Selected text on the page, if any. */
  selection?: string;
  capturedAt: number;
}

/** A column belongs to one board. Card order is `cardIds`. */
export interface Column {
  id: ColumnId;
  name: string;
  cardIds: CardId[];
}

/** A board owns an ordered set of columns. */
export interface Board {
  id: BoardId;
  name: string;
  columnIds: ColumnId[];
  /**
   * The Inbox column on the first board is special: it is the
   * destination for right-click capture (Phase 4) and for the
   * "Add to Sidetrack" command shortcut. We tag it explicitly
   * rather than relying on a name match ("Inbox") so the user
   * can rename it freely. The flag is `true` on at most one
   * column at a time; `seed.ts` sets it on the first board's
   * first column on a fresh install.
   */
  inboxColumnId?: ColumnId;
}

/** The persisted root. */
export interface PersistedState {
  schemaVersion: typeof SCHEMA_VERSION;
  /** All boards in the workspace. Phase 1 supports multiple
   *  boards; the UI shows a board picker. */
  boards: Board[];
  columns: Column[];
  cards: Card[];
  /** First-launch timestamp. */
  createdAt: number;
  /** Unix ms of the last `last_seen_active` update. Phase 3
   *  uses it for idle detection. Phase 1 only writes it on
   *  user input so the field is always present. */
  lastSeenActive: number;
  /**
   * User-configurable settings. Phase 1 only ships the idle
   * threshold (consumed by Phase 3). The bag exists from day
   * one so settings can grow without a schema bump.
   */
  settings: {
    /** Seconds of no input before the idle prompt fires. */
    idleThresholdSeconds: number;
  };
}

/** Convenience: an empty state for a brand-new install. */
export function emptyState(now: number): PersistedState {
  return {
    schemaVersion: SCHEMA_VERSION,
    boards: [],
    columns: [],
    cards: [],
    createdAt: now,
    lastSeenActive: now,
    settings: {
      idleThresholdSeconds: 5 * 60,
    },
  };
}

/**
 * Validate that an arbitrary JSON blob looks like a `PersistedState`.
 * We do this in `storage.ts` on load and in `importState` before
 * committing. The check is deliberately strict on the top-level
 * shape (so we never silently load a corrupt blob) and shallow
 * inside collections (so the validator stays O(n)).
 *
 * `unknown` here means a parsed JSON value; we do not trust the
 * type system at the storage boundary.
 */
export function isPersistedState(value: unknown): value is PersistedState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== SCHEMA_VERSION) return false;
  if (typeof v.createdAt !== "number") return false;
  if (typeof v.lastSeenActive !== "number") return false;
  if (!Array.isArray(v.boards)) return false;
  if (!Array.isArray(v.columns)) return false;
  if (!Array.isArray(v.cards)) return false;
  if (typeof v.settings !== "object" || v.settings === null) return false;
  const s = v.settings as Record<string, unknown>;
  if (typeof s.idleThresholdSeconds !== "number") return false;
  return true;
}

export { PROJECT_NAME };
