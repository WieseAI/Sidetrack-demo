import { describe, it, expect } from "vitest";
import { applyAction } from "../src/shared/reducer";
import { defaultState } from "../src/shared/seed";
import { makeCardId, makeColumnId, makeBoardId } from "../src/shared/ids";
import type { CardId } from "../src/shared/model";

/**
 * Reducer tests focused on the cross-cutting invariants the
 * Phase 1 issue calls out:
 *   - move-card clamps the target index
 *   - create-card refuses empty titles
 *   - delete-card removes the card from state.cards AND from
 *     every column's cardIds
 *   - rename-column with whitespace falls back to the old name
 *   - move-card onto a card in the same column reorders
 *
 * These are the cases the brief's AC #2 ("drag a card between
 * columns, order persists after closing/reopening") most depends
 * on. The data.test.ts file has the broader coverage; this file
 * isolates the move/reorder cases.
 */

const NOW = 1_716_000_000_000;

function fresh() {
  return defaultState(NOW);
}

describe("move-card", () => {
  it("clamps the target index to the destination column's bounds", () => {
    let s = fresh();
    const board = s.boards[0]!;
    const cols = board.columnIds.map(
      (id) => s.columns.find((c) => c.id === id)!,
    );
    const a = cols[0]!;
    const b = cols[1]!;
    s = applyAction(s, { type: "create-card", columnId: a.id, title: "X" });
    const cardId = s.cards[s.cards.length - 1]!.id;
    // b has length 1 (the welcome card). Index 99 should clamp to 1.
    s = applyAction(s, {
      type: "move-card",
      cardId,
      toColumnId: b.id,
      toIndex: 99,
    });
    const bAfter = s.columns.find((c) => c.id === b.id)!;
    expect(bAfter.cardIds[bAfter.cardIds.length - 1]).toBe(cardId);
  });

  it("reorders within the same column", () => {
    let s = fresh();
    const col = s.columns[0]!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "A" });
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "B" });
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "C" });
    const ids = s.columns.find((c) => c.id === col.id)!.cardIds;
    const [a, b, c] = ids;
    // Move C to the top.
    s = applyAction(s, {
      type: "move-card",
      cardId: c as CardId,
      toColumnId: col.id,
      toIndex: 0,
    });
    const reordered = s.columns.find((c) => c.id === col.id)!.cardIds;
    expect(reordered[0]).toBe(c);
    expect(reordered).toEqual([c, a, b]);
  });

  it("moving a card to its own column at its own index is a no-op", () => {
    let s = fresh();
    const col = s.columns[0]!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "A" });
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "B" });
    const ids = s.columns.find((c) => c.id === col.id)!.cardIds;
    const a = ids[0]!;
    const before = s;
    const after = applyAction(s, {
      type: "move-card",
      cardId: a,
      toColumnId: col.id,
      toIndex: 0,
    });
    // We don't promise referential equality (the reducer always
    // returns a new object), but the contents should be the same.
    expect(after).toEqual(before);
  });
});

describe("create-card", () => {
  it("appends to the end of the column's cardIds", () => {
    const s = fresh();
    const col = s.columns[0]!;
    const before = col.cardIds.length;
    const after = applyAction(s, {
      type: "create-card",
      columnId: col.id,
      title: "New",
    });
    const colAfter = after.columns.find((c) => c.id === col.id)!;
    expect(colAfter.cardIds.length).toBe(before + 1);
  });

  it("ignores empty / whitespace titles", () => {
    const s = fresh();
    const col = s.columns[0]!;
    const before = s.cards.length;
    const after = applyAction(s, {
      type: "create-card",
      columnId: col.id,
      title: "   ",
    });
    expect(after.cards.length).toBe(before);
  });
});

describe("delete-card", () => {
  it("removes the card from state.cards and from its column's cardIds", () => {
    const s = fresh();
    const cardId = s.cards[0]!.id;
    const colWith = s.columns.find((c) => c.cardIds.includes(cardId))!;
    const after = applyAction(s, { type: "delete-card", cardId });
    expect(after.cards.some((c) => c.id === cardId)).toBe(false);
    expect(after.columns.find((c) => c.id === colWith.id)!.cardIds).not.toContain(
      cardId,
    );
  });
});

describe("rename-column", () => {
  it("falls back to the old name if the new name is empty", () => {
    const s = fresh();
    const col = s.columns[0]!;
    const after = applyAction(s, {
      type: "rename-column",
      columnId: col.id,
      name: "   ",
    });
    expect(after.columns.find((c) => c.id === col.id)!.name).toBe(col.name);
  });
});

describe("delete-column", () => {
  it("refuses to delete the Inbox column", () => {
    const s = fresh();
    const inboxId = s.boards[0]!.inboxColumnId!;
    const after = applyAction(s, {
      type: "delete-column",
      columnId: inboxId,
    });
    expect(after.columns.find((c) => c.id === inboxId)).toBeDefined();
  });

  it("deletes a non-Inbox column that has no cards", () => {
    const s = fresh();
    const done = s.columns.find((c) => c.name === "Done")!;
    const after = applyAction(s, {
      type: "delete-column",
      columnId: done.id,
    });
    expect(after.columns.find((c) => c.id === done.id)).toBeUndefined();
  });
});

describe("delete-board", () => {
  it("refuses to delete the last board", () => {
    const s = fresh();
    const id = s.boards[0]!.id;
    const after = applyAction(s, { type: "delete-board", boardId: id });
    expect(after.boards).toHaveLength(1);
  });
});

// Make the test file compile even when future tests trim the
// imports. The factories are part of the public API of `ids.ts`;
// keeping them imported here documents the cross-test dependency.
void makeBoardId;
void makeColumnId;
void makeCardId;

// ---- Phase 2: timer reducer actions ---------------------------------

describe("start-timer", () => {
  it("opens a TimeEntry and sets runningTimer on a fresh card", () => {
    let s = fresh();
    const col = s.columns[0]!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "T" });
    const cardId = s.cards[s.cards.length - 1]!.id;
    const now = NOW + 1_000;
    s = applyAction(s, { type: "start-timer", cardId, now });
    expect(s.runningTimer).toEqual({ cardId, startedAt: now, lastSeenActive: now });
    const card = s.cards.find((c) => c.id === cardId)!;
    const open = card.entries.find((e) => e.endAt === null);
    expect(open).toBeDefined();
    expect(open!.startAt).toBe(now);
    expect(open!.source).toBe("timer");
  });

  it("closing the previous timer when starting on a new card (AC #4)", () => {
    let s = fresh();
    const col = s.columns[0]!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "A" });
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "B" });
    const aId = s.cards[s.cards.length - 2]!.id;
    const bId = s.cards[s.cards.length - 1]!.id;
    const t0 = NOW;
    s = applyAction(s, { type: "start-timer", cardId: aId, now: t0 });
    const t1 = t0 + 30_000;
    s = applyAction(s, { type: "start-timer", cardId: bId, now: t1 });
    // A is now closed with endAt = t1.
    const a = s.cards.find((c) => c.id === aId)!;
    const aOpen = a.entries.find((e) => e.endAt === null);
    expect(aOpen).toBeUndefined();
    const aClosed = a.entries.find((e) => e.endAt === t1);
    expect(aClosed).toBeDefined();
    expect(s.runningTimer?.cardId).toBe(bId);
  });

  it("starting a timer on the already-running card refreshes lastSeenActive", () => {
    let s = fresh();
    const col = s.columns[0]!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "A" });
    const id = s.cards[s.cards.length - 1]!.id;
    s = applyAction(s, { type: "start-timer", cardId: id, now: NOW });
    s = applyAction(s, { type: "start-timer", cardId: id, now: NOW + 1000 });
    expect(s.runningTimer).toEqual({ cardId: id, startedAt: NOW, lastSeenActive: NOW + 1000 });
    // The startedAt anchor is preserved; the open entry isn't double-counted.
    const card = s.cards.find((c) => c.id === id)!;
    expect(card.entries.filter((e) => e.endAt === null)).toHaveLength(1);
  });

  it("ignores a start on a card that has been deleted", () => {
    let s = fresh();
    const col = s.columns[0]!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "A" });
    const id = s.cards[s.cards.length - 1]!.id;
    s = applyAction(s, { type: "delete-card", cardId: id });
    s = applyAction(s, { type: "start-timer", cardId: id, now: NOW });
    expect(s.runningTimer).toBeUndefined();
  });
});

describe("stop-timer", () => {
  it("closes the running entry and clears runningTimer", () => {
    let s = fresh();
    const col = s.columns[0]!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "A" });
    const id = s.cards[s.cards.length - 1]!.id;
    s = applyAction(s, { type: "start-timer", cardId: id, now: NOW });
    s = applyAction(s, { type: "stop-timer", now: NOW + 60_000 });
    expect(s.runningTimer).toBeUndefined();
    const card = s.cards.find((c) => c.id === id)!;
    const open = card.entries.find((e) => e.endAt === null);
    expect(open).toBeUndefined();
    const closed = card.entries.find((e) => e.endAt === NOW + 60_000);
    expect(closed).toBeDefined();
  });

  it("is a no-op when no timer is running", () => {
    const s = fresh();
    const after = applyAction(s, { type: "stop-timer", now: NOW });
    expect(after).toBe(s);
  });
});

describe("cold-start-reconcile", () => {
  it("refreshes lastSeenActive on the running timer", () => {
    let s = fresh();
    const col = s.columns[0]!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "A" });
    const id = s.cards[s.cards.length - 1]!.id;
    s = applyAction(s, { type: "start-timer", cardId: id, now: NOW });
    s = applyAction(s, { type: "cold-start-reconcile", now: NOW + 5_000 });
    expect(s.runningTimer?.lastSeenActive).toBe(NOW + 5_000);
  });

  it("clears a running timer whose card was deleted under it", () => {
    let s = fresh();
    const col = s.columns[0]!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "A" });
    const id = s.cards[s.cards.length - 1]!.id;
    s = applyAction(s, { type: "start-timer", cardId: id, now: NOW });
    s = applyAction(s, { type: "delete-card", cardId: id });
    s = applyAction(s, { type: "cold-start-reconcile", now: NOW + 5_000 });
    expect(s.runningTimer).toBeUndefined();
  });
});
