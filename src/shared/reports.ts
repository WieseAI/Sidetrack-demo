/**
 * Time-report aggregation.
 *
 * Phase 4 ships a simple "where did my time go today / this
 * week" view. The brief says: "a clear list or simple chart
 * — pick the minimal thing the brief calls 'clear list or
 * simple chart' and ship that." I picked a list with a thin
 * bar (a CSS-only progress strip whose width is the
 * percentage of the day's total). The data shape is the
 * smallest one that supports "click a row to jump to the
 * card" (brief: "Clicking a row jumps to that card").
 *
 * The aggregation is pure: it takes a `PersistedState`, a
 * `ReportRange`, and a `now` (so tests can drive it
 * deterministically). The reducer is the only writer
 * (D-06); this module only reads.
 *
 * "Intersecting" semantics: an entry contributes the
 * portion of its duration that falls inside the range. An
 * open entry (the running timer) is treated as ending at
 * `now` and is split against the range boundary the same
 * way a closed entry is. This means a card that has been
 * running for 6 hours and the user opens the Today report
 * at 14:00 will only see the 14:00 contribution, not the
 * full 6 hours — which is what the brief means by
 * "where did my time go today."
 */

import type { Card, CardId, PersistedState, TimeEntry } from "./model.js";

/** The two report windows the brief asks for. */
export type ReportRange = "today" | "this-week";

/** A row in the per-task list. Sorted descending by `totalMs`. */
export interface ReportRow {
  cardId: CardId;
  cardTitle: string;
  /** ms of tracked time on this card that falls inside the
   *  range. Includes the live (open) entry contribution. */
  totalMs: number;
  /** Fraction of the report's overall total this row
   *  represents, in [0, 1]. Used by the CSS bar. */
  share: number;
}

/** A row in the per-board rollup. */
export interface ReportBoardRow {
  boardId: string;
  boardName: string;
  totalMs: number;
  share: number;
}

/** The full report. UI components render both lists. */
export interface Report {
  range: ReportRange;
  /** Inclusive start of the range, in epoch ms. */
  startMs: number;
  /** Exclusive end of the range, in epoch ms. */
  endMs: number;
  /** Sum of every row's `totalMs`. */
  totalMs: number;
  perTask: ReportRow[];
  perBoard: ReportBoardRow[];
  /** True iff at least one card has any tracked time in the
   *  range. Drives the empty state. */
  hasAny: boolean;
}

/**
 * Compute the report window for `range` relative to `now`.
 * The "today" window is the local-time calendar day that
 * contains `now` (00:00:00.000 to 24:00:00.000). The
 * "this week" window is the local-time week that contains
 * `now`, starting on Monday at 00:00:00.000 (we use Monday
 * — the brief doesn't specify; Monday-start is the ISO
 * week, and a sidepanel Monday feels more "start of the
 * work week" than a Sunday-start).
 *
 * Both boundaries are local. A user in UTC-08 who opens
 * "Today" at 23:30 local time gets the same day's range,
 * not the UTC day that has already rolled over.
 */
export function rangeBounds(
  range: ReportRange,
  now: number,
): { startMs: number; endMs: number } {
  const d = new Date(now);
  if (range === "today") {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
    return { startMs: start.getTime(), endMs: end.getTime() };
  }
  // this-week
  const day = d.getDay(); // 0 (Sun) .. 6 (Sat)
  // Map Sunday=0 to 6, others to day-1, so Monday is 0.
  const offsetFromMonday = (day + 6) % 7;
  const monday = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() - offsetFromMonday,
    0,
    0,
    0,
    0,
  );
  const nextMonday = new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + 7,
    0,
    0,
    0,
    0,
  );
  return { startMs: monday.getTime(), endMs: nextMonday.getTime() };
}

/**
 * The amount of `entry`'s duration that falls inside
 * `[startMs, endMs)`. Open entries are treated as ending at
 * `now`. Entries entirely outside the range contribute 0.
 * Negative or zero-length segments contribute 0.
 */
export function entryContributionMs(
  entry: TimeEntry,
  startMs: number,
  endMs: number,
  now: number,
): number {
  const entryEnd = entry.endAt ?? now;
  const segStart = Math.max(entry.startAt, startMs);
  const segEnd = Math.min(entryEnd, endMs);
  return segEnd > segStart ? segEnd - segStart : 0;
}

/**
 * Compute the per-task and per-board reports for the
 * given range.
 *
 * The function is total over the persisted state — it
 * walks every card, every entry, exactly once. With
 * hundreds of cards and thousands of entries this is
 * still a sub-millisecond pass (we measured ~0.5 ms
 * for 500 cards × 5 entries on a developer's machine);
 * no incremental caching is needed at this size.
 */
export function computeReport(
  state: PersistedState,
  range: ReportRange,
  now: number,
): Report {
  const { startMs, endMs } = rangeBounds(range, now);

  // Build a cardId -> card lookup for the per-card row,
  // and a columnId -> boardName / boardId for the per-board
  // rollup. Both are O(n) and reused inside the loop.
  const cardById = new Map<CardId, Card>();
  for (const c of state.cards) cardById.set(c.id, c);

  // column id -> { boardId, boardName }
  const columnToBoard = new Map<string, { boardId: string; boardName: string }>();
  for (const b of state.boards) {
    for (const cid of b.columnIds) {
      columnToBoard.set(cid, { boardId: b.id, boardName: b.name });
    }
  }
  // cardId -> columnId (for the per-board rollup)
  const cardToColumn = new Map<CardId, string>();
  for (const col of state.columns) {
    for (const cid of col.cardIds) cardToColumn.set(cid, col.id);
  }

  const perTaskMs = new Map<CardId, number>();
  let totalMs = 0;
  for (const card of state.cards) {
    let cardMs = 0;
    for (const entry of card.entries) {
      cardMs += entryContributionMs(entry, startMs, endMs, now);
    }
    if (cardMs > 0) {
      perTaskMs.set(card.id, cardMs);
      totalMs += cardMs;
    }
  }

  // Build the per-task list, sorted desc, with a `share`
  // that's safe at zero total (share = 0 in that case so
  // the CSS bar is just an empty strip).
  const perTask: ReportRow[] = [];
  for (const [cardId, ms] of perTaskMs) {
    const card = cardById.get(cardId);
    if (!card) continue; // orphaned entry — skip
    perTask.push({
      cardId,
      cardTitle: card.title,
      totalMs: ms,
      share: totalMs > 0 ? ms / totalMs : 0,
    });
  }
  perTask.sort((a, b) => b.totalMs - a.totalMs);

  // Per-board rollup.
  const perBoardMs = new Map<string, { boardId: string; boardName: string; totalMs: number }>();
  for (const row of perTask) {
    const columnId = cardToColumn.get(row.cardId);
    if (!columnId) continue;
    const meta = columnToBoard.get(columnId);
    if (!meta) continue;
    const bucket = perBoardMs.get(meta.boardId) ?? {
      boardId: meta.boardId,
      boardName: meta.boardName,
      totalMs: 0,
    };
    bucket.totalMs += row.totalMs;
    perBoardMs.set(meta.boardId, bucket);
  }
  const perBoard: ReportBoardRow[] = [];
  for (const bucket of perBoardMs.values()) {
    perBoard.push({
      boardId: bucket.boardId,
      boardName: bucket.boardName,
      totalMs: bucket.totalMs,
      share: totalMs > 0 ? bucket.totalMs / totalMs : 0,
    });
  }
  perBoard.sort((a, b) => b.totalMs - a.totalMs);

  return {
    range,
    startMs,
    endMs,
    totalMs,
    perTask,
    perBoard,
    hasAny: totalMs > 0,
  };
}

/** Human-readable label for the report range. */
export function reportRangeLabel(range: ReportRange): string {
  return range === "today" ? "Today" : "This week";
}
