import { describe, it, expect } from "vitest";
import { applyAction } from "../src/shared/reducer";
import { defaultState } from "../src/shared/seed";
import type { ColumnId } from "../src/shared/model";

/**
 * Reducer-level tests for the Phase 4 `capture-card` action.
 *
 * The action is the right-click "Add to Sidetrack" entry
 * point (D-07). It is structurally similar to `create-card`
 * but accepts a `description` and a `source` provenance blob.
 *
 * These tests cover the shape of the new card and the
 * defensive sanitization of the `source` payload (the
 * service worker builds this from `chrome.contextMenus`,
 * which is not a strongly-typed API, so a malformed blob
 * must not corrupt the persisted state).
 */

const NOW = 1_716_000_000_000;

function fresh() {
  return defaultState(NOW);
}

function inboxColumnId(s: ReturnType<typeof fresh>): ColumnId {
  const board = s.boards[0]!;
  return board.inboxColumnId!;
}

describe("capture-card reducer action", () => {
  it("creates a card in the Inbox column with title and description", () => {
    const s0 = fresh();
    const colId = inboxColumnId(s0);
    const s1 = applyAction(s0, {
      type: "capture-card",
      columnId: colId,
      title: "Hello world",
      description: "An example page",
    });
    const last = s1.cards[s1.cards.length - 1]!;
    expect(last.title).toBe("Hello world");
    expect(last.description).toBe("An example page");
    const col = s1.columns.find((c) => c.id === colId)!;
    expect(col.cardIds).toContain(last.id);
  });

  it("attaches the source provenance blob to the card", () => {
    const s0 = fresh();
    const colId = inboxColumnId(s0);
    const capturedAt = NOW;
    const s1 = applyAction(s0, {
      type: "capture-card",
      columnId: colId,
      title: "Page title",
      description: "https://example.com",
      source: {
        url: "https://example.com",
        title: "Page title",
        selection: "the selected text",
        capturedAt,
      },
    });
    const last = s1.cards[s1.cards.length - 1]!;
    expect(last.source).toEqual({
      url: "https://example.com",
      title: "Page title",
      selection: "the selected text",
      capturedAt,
    });
  });

  it("ignores empty / whitespace titles (no-op)", () => {
    const s0 = fresh();
    const colId = inboxColumnId(s0);
    const before = s0.cards.length;
    const s1 = applyAction(s0, {
      type: "capture-card",
      columnId: colId,
      title: "   ",
      description: "ignored",
    });
    expect(s1.cards.length).toBe(before);
  });

  it("ignores an unknown column id (no-op)", () => {
    const s0 = fresh();
    const before = s0.cards.length;
    const s1 = applyAction(s0, {
      type: "capture-card",
      // Cast to ColumnId because the reducer validates the
      // actual id against the columns array; this is a
      // garbage id by construction.
      columnId: "missing-column" as ColumnId,
      title: "Lost",
    });
    expect(s1.cards.length).toBe(before);
  });

  it("drops a malformed `source` (missing url) but still creates the card", () => {
    const s0 = fresh();
    const colId = inboxColumnId(s0);
    const s1 = applyAction(s0, {
      type: "capture-card",
      columnId: colId,
      title: "Bad source",
      source: {
        // No url — should be dropped.
        url: "",
        title: "Page",
        capturedAt: NOW,
      },
    });
    const last = s1.cards[s1.cards.length - 1]!;
    expect(last.title).toBe("Bad source");
    expect(last.source).toBeUndefined();
  });

  it("strips an empty `selection` from the source", () => {
    const s0 = fresh();
    const colId = inboxColumnId(s0);
    const s1 = applyAction(s0, {
      type: "capture-card",
      columnId: colId,
      title: "Empty sel",
      source: {
        url: "https://example.com",
        title: "Page",
        selection: "",
        capturedAt: NOW,
      },
    });
    const last = s1.cards[s1.cards.length - 1]!;
    expect(last.source?.selection).toBeUndefined();
  });

  it("trims the description", () => {
    const s0 = fresh();
    const colId = inboxColumnId(s0);
    const s1 = applyAction(s0, {
      type: "capture-card",
      columnId: colId,
      title: "Trim",
      description: "   hello   ",
    });
    const last = s1.cards[s1.cards.length - 1]!;
    expect(last.description).toBe("hello");
  });

  it("appends the new card to the end of the Inbox column", () => {
    const s0 = fresh();
    const colId = inboxColumnId(s0);
    const s1 = applyAction(s0, {
      type: "capture-card",
      columnId: colId,
      title: "A",
    });
    const s2 = applyAction(s1, {
      type: "capture-card",
      columnId: colId,
      title: "B",
    });
    const col = s2.columns.find((c) => c.id === colId)!;
    const lastId = col.cardIds[col.cardIds.length - 1]!;
    const lastCard = s2.cards.find((c) => c.id === lastId)!;
    expect(lastCard.title).toBe("B");
  });

  it("does not affect the running timer block (capture is independent of time tracking)", () => {
    const s0 = fresh();
    const board = s0.boards[0]!;
    const backlog = s0.columns.find(
      (c) => board.columnIds.includes(c.id) && c.name === "Backlog",
    )!;
    let s1 = applyAction(s0, {
      type: "create-card",
      columnId: backlog.id,
      title: "On which to start a timer",
    });
    const cardId = s1.cards[s1.cards.length - 1]!.id;
    s1 = applyAction(s1, { type: "start-timer", cardId, now: NOW });
    const before = s1.runningTimer;
    const colId = inboxColumnId(s1);
    const s2 = applyAction(s1, {
      type: "capture-card",
      columnId: colId,
      title: "Captured while a timer runs",
    });
    expect(s2.runningTimer).toEqual(before);
  });
});
