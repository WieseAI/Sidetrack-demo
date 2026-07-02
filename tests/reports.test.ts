import { describe, it, expect } from "vitest";
import { defaultState } from "../src/shared/seed";
import { applyAction } from "../src/shared/reducer";
import {
  computeReport,
  rangeBounds,
  entryContributionMs,
  reportRangeLabel,
} from "../src/shared/reports";
import { makeCardId, makeEntryId } from "../src/shared/ids";
import type { CardId, EntryId, TimeEntry } from "../src/shared/model";

/**
 * Reports module tests.
 *
 * The brief asks for "Today" and "This week" reports with
 * per-task and per-board totals. The aggregation is pure
 * (deterministic given `now`), so we drive it directly
 * against a state seeded with a few cards and entries.
 *
 * Tests cover the corner cases that the brief and the
 * D-04 / D-08 contracts most depend on:
 *
 *   - Open entries (the running timer) contribute live
 *     time, split at the range boundary.
 *   - Entries entirely outside the range contribute 0.
 *   - Entries straddling a boundary are correctly split
 *     (an entry that started yesterday and finished today
 *     counts only the part inside today).
 *   - The per-board rollup aggregates correctly across
 *     multiple cards on different boards.
 *   - The empty state is `hasAny: false` when no entries
 *     intersect the range.
 *   - `rangeBounds` honors local time (we set the test
 *     `now` to a fixed local-time instant and check the
 *     window does not shift by 24h due to TZ).
 */

const NOW = new Date(2026, 6, 2, 14, 0, 0, 0).getTime(); // Thu Jul 2 2026, 14:00 local

function todayStart(): number {
  return new Date(2026, 6, 2, 0, 0, 0, 0).getTime();
}
function todayEnd(): number {
  return new Date(2026, 6, 3, 0, 0, 0, 0).getTime();
}
function weekStart(): number {
  // Mon Jun 29 2026 00:00 local (the Monday of the week containing Jul 2).
  return new Date(2026, 5, 29, 0, 0, 0, 0).getTime();
}
function weekEnd(): number {
  return new Date(2026, 6, 6, 0, 0, 0, 0).getTime();
}

describe("rangeBounds", () => {
  it("today uses local-time midnight to midnight", () => {
    const b = rangeBounds("today", NOW);
    expect(b.startMs).toBe(todayStart());
    expect(b.endMs).toBe(todayEnd());
  });
  it("this-week uses Monday 00:00 local to next Monday 00:00 local", () => {
    const b = rangeBounds("this-week", NOW);
    expect(b.startMs).toBe(weekStart());
    expect(b.endMs).toBe(weekEnd());
  });
  it("Sunday-anchored dates are placed in the previous Monday's week", () => {
    // Sun Jul 5 2026 12:00 — should be in week starting Mon Jun 29.
    const sun = new Date(2026, 6, 5, 12, 0, 0, 0).getTime();
    const b = rangeBounds("this-week", sun);
    expect(b.startMs).toBe(weekStart());
    expect(b.endMs).toBe(weekEnd());
  });
  it("reportRangeLabel returns human strings", () => {
    expect(reportRangeLabel("today")).toBe("Today");
    expect(reportRangeLabel("this-week")).toBe("This week");
  });
});

describe("entryContributionMs", () => {
  function entry(start: number, end: number | null): TimeEntry {
    return {
      id: makeEntryId() as EntryId,
      cardId: makeCardId() as CardId,
      startAt: start,
      endAt: end,
      source: "manual",
    };
  }
  it("returns 0 for entries entirely before the range", () => {
    const e = entry(todayStart() - 60_000, todayStart() - 1);
    expect(entryContributionMs(e, todayStart(), todayEnd(), NOW)).toBe(0);
  });
  it("returns 0 for entries entirely after the range", () => {
    const e = entry(todayEnd() + 1, todayEnd() + 60_000);
    expect(entryContributionMs(e, todayStart(), todayEnd(), NOW)).toBe(0);
  });
  it("returns the full duration for entries entirely inside the range", () => {
    const start = todayStart() + 60_000;
    const end = start + 600_000;
    const e = entry(start, end);
    expect(entryContributionMs(e, todayStart(), todayEnd(), NOW)).toBe(
      600_000,
    );
  });
  it("splits entries that straddle the range start", () => {
    // Started 1h before today, ended 1h into today. Should
    // contribute 1h (the inside portion).
    const e = entry(todayStart() - 3_600_000, todayStart() + 3_600_000);
    expect(entryContributionMs(e, todayStart(), todayEnd(), NOW)).toBe(
      3_600_000,
    );
  });
  it("splits entries that straddle the range end", () => {
    // Started 2h before today-end, ended 2h after. Should
    // contribute 2h.
    const e = entry(todayEnd() - 2 * 3_600_000, todayEnd() + 2 * 3_600_000);
    expect(entryContributionMs(e, todayStart(), todayEnd(), NOW)).toBe(
      2 * 3_600_000,
    );
  });
  it("treats open (running) entries as ending at `now`", () => {
    // Started 30 min ago, still open. Should contribute 30 min.
    const e = entry(NOW - 30 * 60_000, null);
    expect(entryContributionMs(e, todayStart(), todayEnd(), NOW)).toBe(
      30 * 60_000,
    );
  });
  it("treats open entries that started after now as zero-length", () => {
    const e = entry(NOW + 1000, null);
    expect(entryContributionMs(e, todayStart(), todayEnd(), NOW)).toBe(0);
  });
  it("returns 0 for zero-length entries", () => {
    const e = entry(NOW, NOW);
    expect(entryContributionMs(e, todayStart(), todayEnd(), NOW)).toBe(0);
  });
});

describe("computeReport — empty", () => {
  it("returns hasAny=false and empty lists on a fresh install", () => {
    const s = defaultState(NOW);
    const r = computeReport(s, "today", NOW);
    expect(r.hasAny).toBe(false);
    expect(r.totalMs).toBe(0);
    expect(r.perTask).toEqual([]);
    expect(r.perBoard).toEqual([]);
  });
});

describe("computeReport — single closed entry", () => {
  it("credits the card and the board for the full entry duration", () => {
    let s = defaultState(NOW);
    const board = s.boards[0]!;
    const col = s.columns.find((c) => board.columnIds.includes(c.id) && c.name === "Backlog")!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "Work" });
    const cardId = s.cards[s.cards.length - 1]!.id;
    const start = todayStart() + 60_000;
    const end = start + 1_800_000; // 30 min
    s = applyAction(s, {
      type: "add-entry",
      cardId,
      entry: { startAt: start, endAt: end, source: "manual" },
    });
    const r = computeReport(s, "today", NOW);
    expect(r.hasAny).toBe(true);
    expect(r.totalMs).toBe(1_800_000);
    expect(r.perTask).toHaveLength(1);
    expect(r.perTask[0]!.cardId).toBe(cardId);
    expect(r.perTask[0]!.totalMs).toBe(1_800_000);
    expect(r.perTask[0]!.share).toBe(1);
    expect(r.perBoard).toHaveLength(1);
    expect(r.perBoard[0]!.boardName).toBe(board.name);
    expect(r.perBoard[0]!.totalMs).toBe(1_800_000);
  });
});

describe("computeReport — multiple cards on multiple boards", () => {
  it("aggregates per-card totals and per-board rollups", () => {
    let s = defaultState(NOW);
    const board1 = s.boards[0]!;
    const board1Backlog = s.columns.find(
      (c) => board1.columnIds.includes(c.id) && c.name === "Backlog",
    )!;
    // Add a second board.
    s = applyAction(s, { type: "create-board", name: "Side" });
    const board2 = s.boards[1]!;
    s = applyAction(s, { type: "create-column", boardId: board2.id, name: "Tasks" });
    const board2After = s.boards.find((b) => b.id === board2.id)!;
    const board2Col = s.columns.find(
      (c) => board2After.columnIds.includes(c.id) && c.name === "Tasks",
    )!;

    // Card A on board 1, 20 min.
    s = applyAction(s, { type: "create-card", columnId: board1Backlog.id, title: "A" });
    const aId = s.cards[s.cards.length - 1]!.id;
    s = applyAction(s, {
      type: "add-entry",
      cardId: aId,
      entry: {
        startAt: todayStart() + 60_000,
        endAt: todayStart() + 60_000 + 1_200_000,
        source: "manual",
      },
    });
    // Card B on board 2, 10 min.
    s = applyAction(s, { type: "create-card", columnId: board2Col.id, title: "B" });
    const bId = s.cards[s.cards.length - 1]!.id;
    s = applyAction(s, {
      type: "add-entry",
      cardId: bId,
      entry: {
        startAt: todayStart() + 60_000,
        endAt: todayStart() + 60_000 + 600_000,
        source: "manual",
      },
    });
    const r = computeReport(s, "today", NOW);
    expect(r.hasAny).toBe(true);
    expect(r.totalMs).toBe(1_800_000);
    // perTask: A first (20 min > 10 min), then B.
    expect(r.perTask.map((row) => row.cardTitle)).toEqual(["A", "B"]);
    expect(r.perTask[0]!.totalMs).toBe(1_200_000);
    expect(r.perTask[1]!.totalMs).toBe(600_000);
    // perBoard: board 1 first, then board 2.
    expect(r.perBoard.map((row) => row.boardName)).toEqual([
      board1.name,
      board2.name,
    ]);
    expect(r.perBoard[0]!.totalMs).toBe(1_200_000);
    expect(r.perBoard[1]!.totalMs).toBe(600_000);
  });
});

describe("computeReport — boundary splitting", () => {
  it("counts only the inside portion of an entry that straddles today", () => {
    let s = defaultState(NOW);
    const board = s.boards[0]!;
    const col = s.columns.find(
      (c) => board.columnIds.includes(c.id) && c.name === "Backlog",
    )!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "Straddle" });
    const cardId = s.cards[s.cards.length - 1]!.id;
    // Started 2h before today-start, ended 1h after today-start.
    s = applyAction(s, {
      type: "add-entry",
      cardId,
      entry: {
        startAt: todayStart() - 2 * 3_600_000,
        endAt: todayStart() + 1 * 3_600_000,
        source: "manual",
      },
    });
    const r = computeReport(s, "today", NOW);
    expect(r.totalMs).toBe(1 * 3_600_000);
    expect(r.perTask[0]!.totalMs).toBe(1 * 3_600_000);
  });
  it("ignores entries entirely outside today", () => {
    let s = defaultState(NOW);
    const board = s.boards[0]!;
    const col = s.columns.find(
      (c) => board.columnIds.includes(c.id) && c.name === "Backlog",
    )!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "Yesterday" });
    const cardId = s.cards[s.cards.length - 1]!.id;
    s = applyAction(s, {
      type: "add-entry",
      cardId,
      entry: {
        startAt: todayStart() - 2 * 3_600_000,
        endAt: todayStart() - 3_600_000,
        source: "manual",
      },
    });
    const r = computeReport(s, "today", NOW);
    expect(r.hasAny).toBe(false);
    expect(r.totalMs).toBe(0);
  });
});

describe("computeReport — running entry", () => {
  it("an open (running) entry contributes its time-in-range", () => {
    let s = defaultState(NOW);
    const board = s.boards[0]!;
    const col = s.columns.find(
      (c) => board.columnIds.includes(c.id) && c.name === "Backlog",
    )!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "Live" });
    const cardId = s.cards[s.cards.length - 1]!.id;
    // Start a timer 45 min ago.
    const T0 = NOW - 45 * 60_000;
    s = applyAction(s, { type: "start-timer", cardId, now: T0 });
    const r = computeReport(s, "today", NOW);
    expect(r.hasAny).toBe(true);
    expect(r.totalMs).toBe(45 * 60_000);
    expect(r.perTask).toHaveLength(1);
    expect(r.perTask[0]!.cardId).toBe(cardId);
  });
});

describe("computeReport — this-week window", () => {
  it("counts entries from earlier in the same week", () => {
    let s = defaultState(NOW);
    const board = s.boards[0]!;
    const col = s.columns.find(
      (c) => board.columnIds.includes(c.id) && c.name === "Backlog",
    )!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "Mon" });
    const cardId = s.cards[s.cards.length - 1]!.id;
    // Monday 10:00 for 30 min.
    s = applyAction(s, {
      type: "add-entry",
      cardId,
      entry: {
        startAt: weekStart() + 10 * 3_600_000,
        endAt: weekStart() + 10 * 3_600_000 + 1_800_000,
        source: "manual",
      },
    });
    // Today: 0 min so the test isolates the "this-week" view.
    const r = computeReport(s, "this-week", NOW);
    expect(r.hasAny).toBe(true);
    expect(r.totalMs).toBe(1_800_000);
  });
  it("ignores entries from outside the week", () => {
    let s = defaultState(NOW);
    const board = s.boards[0]!;
    const col = s.columns.find(
      (c) => board.columnIds.includes(c.id) && c.name === "Backlog",
    )!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "LastMonth" });
    const cardId = s.cards[s.cards.length - 1]!.id;
    // One day before this week started.
    s = applyAction(s, {
      type: "add-entry",
      cardId,
      entry: {
        startAt: weekStart() - 3_600_000,
        endAt: weekStart() - 1_800_000,
        source: "manual",
      },
    });
    const r = computeReport(s, "this-week", NOW);
    expect(r.hasAny).toBe(false);
  });
});

describe("computeReport — shares", () => {
  it("`share` is 0 when totalMs is 0 (no division-by-zero)", () => {
    let s = defaultState(NOW);
    const board = s.boards[0]!;
    const col = s.columns.find(
      (c) => board.columnIds.includes(c.id) && c.name === "Backlog",
    )!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "Outside" });
    const cardId = s.cards[s.cards.length - 1]!.id;
    s = applyAction(s, {
      type: "add-entry",
      cardId,
      entry: {
        startAt: todayStart() - 1_800_000,
        endAt: todayStart() - 60_000,
        source: "manual",
      },
    });
    const r = computeReport(s, "today", NOW);
    expect(r.hasAny).toBe(false);
    expect(r.perTask[0]?.share ?? 0).toBe(0);
    expect(r.perBoard[0]?.share ?? 0).toBe(0);
  });
  it("`share` sums to 1 across rows when there is any time", () => {
    let s = defaultState(NOW);
    const board = s.boards[0]!;
    const col = s.columns.find(
      (c) => board.columnIds.includes(c.id) && c.name === "Backlog",
    )!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "X" });
    const x = s.cards[s.cards.length - 1]!.id;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "Y" });
    const y = s.cards[s.cards.length - 1]!.id;
    s = applyAction(s, {
      type: "add-entry",
      cardId: x,
      entry: {
        startAt: todayStart() + 1_000,
        endAt: todayStart() + 600_000,
        source: "manual",
      },
    });
    s = applyAction(s, {
      type: "add-entry",
      cardId: y,
      entry: {
        startAt: todayStart() + 1_000,
        endAt: todayStart() + 1_200_000,
        source: "manual",
      },
    });
    const r = computeReport(s, "today", NOW);
    const totalShare = r.perTask.reduce((sum, row) => sum + row.share, 0);
    expect(totalShare).toBeCloseTo(1, 9);
  });
});
