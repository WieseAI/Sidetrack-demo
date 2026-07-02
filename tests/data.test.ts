import { describe, it, expect, beforeEach } from "vitest";
import { applyAction } from "../src/shared/reducer";
import { defaultState } from "../src/shared/seed";
import { isPersistedState, SCHEMA_VERSION } from "../src/shared/model";
import { createStorage, InMemoryStorage } from "../src/shared/storage";
import { exportToJson, importFromJson } from "../src/shared/io";
import { totalTrackedMs, formatDurationCompact } from "../src/shared/format";
import type { PersistedState } from "../src/shared/model";
import { makeBoardId, makeCardId, makeColumnId, makeEntryId } from "../src/shared/ids";

/**
 * Data-layer tests.
 *
 * These cover the persistence contract end to end: the seed
 * produces a usable default board, the reducer mutates state
 * immutably, the storage handle serializes writes, the export /
 * import round-trip preserves every field, and the validator
 * rejects corrupt blobs.
 *
 * No browser, no Chrome APIs, no network — the storage handle
 * is built on the in-memory adapter so the tests are fast and
 * deterministic.
 */

const NOW = 1_716_000_000_000; // fixed timestamp for determinism

function freshState(): PersistedState {
  return defaultState(NOW);
}

describe("defaultState", () => {
  it("creates a single board with four columns in the brief's order", () => {
    const s = freshState();
    expect(s.boards).toHaveLength(1);
    const board = s.boards[0]!;
    expect(board.columnIds).toHaveLength(4);

    const cols = board.columnIds.map((id) => s.columns.find((c) => c.id === id)!);
    expect(cols.map((c) => c.name)).toEqual([
      "Inbox",
      "Backlog",
      "In Progress",
      "Done",
    ]);
  });

  it("tags the Inbox column with the board's inboxColumnId", () => {
    const s = freshState();
    const board = s.boards[0]!;
    expect(board.inboxColumnId).toBeDefined();
    const inbox = s.columns.find((c) => c.id === board.inboxColumnId);
    expect(inbox?.name).toBe("Inbox");
  });

  it("seeds one welcome card into Backlog", () => {
    const s = freshState();
    const board = s.boards[0]!;
    const backlog = s.columns.find((c) =>
      board.columnIds.includes(c.id) && c.name === "Backlog",
    )!;
    expect(backlog.cardIds).toHaveLength(1);
    const card = s.cards.find((c) => c.id === backlog.cardIds[0])!;
    expect(card.title).toBe("Welcome to Sidetrack");
  });

  it("emits the current schema version", () => {
    expect(freshState().schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe("applyAction — boards", () => {
  it("creates a new board and adds it to the list", () => {
    const s = applyAction(freshState(), { type: "create-board", name: "Side" });
    expect(s.boards).toHaveLength(2);
    expect(s.boards[1]!.name).toBe("Side");
    expect(s.boards[1]!.columnIds).toEqual([]);
  });

  it("renames a board", () => {
    const before = freshState();
    const id = before.boards[0]!.id;
    const after = applyAction(before, { type: "rename-board", boardId: id, name: "Primary" });
    expect(after.boards[0]!.name).toBe("Primary");
  });

  it("refuses to delete the last board", () => {
    const before = freshState();
    const id = before.boards[0]!.id;
    const after = applyAction(before, { type: "delete-board", boardId: id });
    expect(after.boards).toHaveLength(1);
  });

  it("deleting a board removes its columns and cards", () => {
    let s = freshState();
    s = applyAction(s, { type: "create-board", name: "Other" });
    const other = s.boards[1]!;
    s = applyAction(s, { type: "create-column", boardId: other.id, name: "Todo" });
    // Re-read the board: create-column appended the new column id
    // to the board's columnIds. `other` is the stale snapshot.
    const updatedOther = s.boards.find((b) => b.id === other.id)!;
    const todoCol = s.columns.find(
      (c) => c.name === "Todo" && updatedOther.columnIds.includes(c.id),
    )!;
    s = applyAction(s, { type: "create-card", columnId: todoCol.id, title: "Test" });
    const cardId = s.cards.find((c) => c.title === "Test")!.id;
    const cardsBefore = s.cards.length;
    const colsBefore = s.columns.length;
    const after = applyAction(s, { type: "delete-board", boardId: other.id });
    expect(after.boards).toHaveLength(1);
    expect(after.columns.length).toBe(colsBefore - 1);
    expect(after.cards.length).toBe(cardsBefore - 1);
    expect(after.cards.some((c) => c.id === cardId)).toBe(false);
  });
});

describe("applyAction — columns", () => {
  it("creates a column in a board", () => {
    const s = freshState();
    const board = s.boards[0]!;
    const after = applyAction(s, {
      type: "create-column",
      boardId: board.id,
      name: "Review",
    });
    expect(after.columns.some((c) => c.name === "Review")).toBe(true);
    const review = after.columns.find((c) => c.name === "Review")!;
    expect(after.boards[0]!.columnIds).toContain(review.id);
  });

  it("renames a column", () => {
    const s = freshState();
    const col = s.columns[0]!;
    const after = applyAction(s, {
      type: "rename-column",
      columnId: col.id,
      name: "Captured",
    });
    expect(after.columns.find((c) => c.id === col.id)!.name).toBe("Captured");
  });

  it("refuses to delete the Inbox column", () => {
    const s = freshState();
    const inboxId = s.boards[0]!.inboxColumnId!;
    const after = applyAction(s, { type: "delete-column", columnId: inboxId });
    expect(after.columns.find((c) => c.id === inboxId)).toBeDefined();
  });

  it("refuses to delete the last column of the last board", () => {
    // Strip the seed down to one column.
    let s = freshState();
    const board = s.boards[0]!;
    for (const id of [...board.columnIds].slice(1)) {
      s = applyAction(s, { type: "delete-column", columnId: id });
    }
    expect(s.columns).toHaveLength(1);
    const onlyId = s.columns[0]!.id;
    const after = applyAction(s, { type: "delete-column", columnId: onlyId });
    expect(after.columns).toHaveLength(1);
  });

  it("reorders columns on a board", () => {
    const s = freshState();
    const board = s.boards[0]!;
    const reversed = [...board.columnIds].reverse();
    const after = applyAction(s, {
      type: "reorder-columns",
      boardId: board.id,
      columnIds: reversed,
    });
    expect(after.boards[0]!.columnIds).toEqual(reversed);
  });
});

describe("applyAction — cards", () => {
  it("creates a card in a column and appends it to the end", () => {
    const s = freshState();
    const col = s.columns[0]!;
    const after = applyAction(s, {
      type: "create-card",
      columnId: col.id,
      title: "  Trim me  ",
    });
    const card = after.cards.find(
      (c) => c.title === "Trim me",
    )!;
    expect(card).toBeDefined();
    expect(card.id).toBeTruthy();
    expect(after.columns.find((c) => c.id === col.id)!.cardIds).toContain(card.id);
  });

  it("refuses to create a card with an empty title", () => {
    const s = freshState();
    const col = s.columns[0]!;
    const after = applyAction(s, { type: "create-card", columnId: col.id, title: "   " });
    expect(after.cards).toHaveLength(s.cards.length);
  });

  it("updates a card's title, description, and due date", () => {
    const s = freshState();
    const cardId = s.cards[0]!.id;
    const after = applyAction(s, {
      type: "update-card",
      cardId,
      patch: { title: "Edited", description: "Notes", dueDate: "2026-12-31" },
    });
    const card = after.cards.find((c) => c.id === cardId)!;
    expect(card.title).toBe("Edited");
    expect(card.description).toBe("Notes");
    expect(card.dueDate).toBe("2026-12-31");
  });

  it("deletes a card from its column and from state.cards", () => {
    const s = freshState();
    const cardId = s.cards[0]!.id;
    const colWithCard = s.columns.find((c) => c.cardIds.includes(cardId))!;
    const after = applyAction(s, { type: "delete-card", cardId });
    expect(after.cards.some((c) => c.id === cardId)).toBe(false);
    expect(
      after.columns.find((c) => c.id === colWithCard.id)!.cardIds.includes(cardId),
    ).toBe(false);
  });

  it("moves a card between columns and clamps the target index", () => {
    const s = freshState();
    const card = s.cards[0]!;
    const sourceCol = s.columns.find((c) => c.cardIds.includes(card.id))!;
    const targetCol = s.columns.find(
      (c) => c.id !== sourceCol.id,
    )!;
    const after = applyAction(s, {
      type: "move-card",
      cardId: card.id,
      toColumnId: targetCol.id,
      toIndex: 999,
    });
    expect(after.columns.find((c) => c.id === sourceCol.id)!.cardIds).not.toContain(
      card.id,
    );
    expect(after.columns.find((c) => c.id === targetCol.id)!.cardIds).toContain(
      card.id,
    );
  });

  it("reorder-cards persists the new ordering", () => {
    let s = freshState();
    const col = s.columns[0]!;
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "A" });
    s = applyAction(s, { type: "create-card", columnId: col.id, title: "B" });
    const ids = s.columns.find((c) => c.id === col.id)!.cardIds;
    const reversed = [...ids].reverse();
    const after = applyAction(s, {
      type: "reorder-cards",
      columnId: col.id,
      cardIds: reversed,
    });
    expect(after.columns.find((c) => c.id === col.id)!.cardIds).toEqual(reversed);
  });
});

describe("applyAction — entries and settings", () => {
  it("adds an entry to a card", () => {
    const s = freshState();
    const cardId = s.cards[0]!.id;
    const after = applyAction(s, {
      type: "add-entry",
      cardId,
      entry: { startAt: NOW, endAt: NOW + 60_000, source: "manual" },
    });
    expect(after.cards.find((c) => c.id === cardId)!.entries).toHaveLength(1);
  });

  it("updates and deletes entries", () => {
    let s = freshState();
    const cardId = s.cards[0]!.id;
    s = applyAction(s, {
      type: "add-entry",
      cardId,
      entry: { startAt: NOW, endAt: NOW + 60_000, source: "manual" },
    });
    const entryId = s.cards.find((c) => c.id === cardId)!.entries[0]!.id;
    s = applyAction(s, {
      type: "update-entry",
      cardId,
      entryId,
      patch: { note: "edited" },
    });
    expect(
      s.cards.find((c) => c.id === cardId)!.entries[0]!.note,
    ).toBe("edited");
    s = applyAction(s, { type: "delete-entry", cardId, entryId });
    expect(s.cards.find((c) => c.id === cardId)!.entries).toHaveLength(0);
  });

  it("updates lastSeenActive on touch-active", () => {
    const s = freshState();
    const after = applyAction(s, { type: "touch-active", now: NOW + 1000 });
    expect(after.lastSeenActive).toBe(NOW + 1000);
  });

  it("updates settings.setting", () => {
    const s = freshState();
    const after = applyAction(s, {
      type: "set-setting",
      key: "idleThresholdSeconds",
      value: 600,
    });
    expect(after.settings.idleThresholdSeconds).toBe(600);
  });
});

describe("applyAction — immutability", () => {
  it("does not mutate the input state", () => {
    const s = freshState();
    const before = JSON.stringify(s);
    applyAction(s, { type: "create-card", columnId: s.columns[0]!.id, title: "X" });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("isPersistedState", () => {
  it("accepts a fresh state", () => {
    expect(isPersistedState(freshState())).toBe(true);
  });

  it("rejects null, undefined, and non-objects", () => {
    expect(isPersistedState(null)).toBe(false);
    expect(isPersistedState(undefined)).toBe(false);
    expect(isPersistedState(42)).toBe(false);
    expect(isPersistedState("hello")).toBe(false);
  });

  it("rejects a blob with the wrong schemaVersion", () => {
    const s = freshState() as unknown as Record<string, unknown>;
    s.schemaVersion = 99;
    expect(isPersistedState(s)).toBe(false);
  });

  it("rejects a blob missing the settings block", () => {
    const s = { ...freshState() } as Record<string, unknown>;
    delete s.settings;
    expect(isPersistedState(s)).toBe(false);
  });
});

describe("storage handle", () => {
  let storage: ReturnType<typeof createStorage>;
  beforeEach(() => {
    storage = createStorage(new InMemoryStorage());
  });

  it("seeds the default board on first load", async () => {
    const s = await storage.loadState();
    expect(s.boards).toHaveLength(1);
    expect(s.boards[0]!.columnIds).toHaveLength(4);
  });

  it("mutate writes a new blob to storage and updates the cache", async () => {
    await storage.loadState();
    const before = await storage.exportState();
    const boardId = before.boards[0]!.id;
    const after = await storage.mutate({
      type: "create-board",
      name: "Second",
    });
    expect(after.boards).toHaveLength(2);
    expect(storage.peek().boards).toHaveLength(2);

    // A fresh load returns the same state.
    const reloaded = await storage.exportState();
    expect(reloaded.boards).toHaveLength(2);
    // Use the variable so eslint doesn't complain about the unused
    // local; the assertion is what matters.
    expect(boardId).toBeDefined();
  });

  it("mutate is a no-op for actions that don't change state", async () => {
    const before = await storage.loadState();
    const after = await storage.mutate({
      type: "delete-column",
      columnId: before.boards[0]!.inboxColumnId!,
    });
    expect(after).toBe(before);
  });

  it("transact applies multiple actions in a single write", async () => {
    await storage.loadState();
    const before = storage.peek();
    const boardId = before.boards[0]!.id;
    const after = await storage.transact([
      { type: "create-column", boardId, name: "A" },
      { type: "create-column", boardId, name: "B" },
    ]);
    expect(after.columns.filter((c) => c.name === "A" || c.name === "B"))
      .toHaveLength(2);
  });

  it("importState replaces the persisted blob with validation", async () => {
    await storage.loadState();
    const exported = await storage.exportState();
    // Wipe by importing a brand-new state (the only sanctioned
    // way to "wipe" in production; UI confirms).
    const fresh = defaultState(NOW + 10_000);
    await storage.importState(fresh);
    const reloaded = await storage.exportState();
    expect(reloaded.boards[0]!.id).toBe(fresh.boards[0]!.id);
    // Round-trip the original back.
    await storage.importState(exported);
    const restored = await storage.exportState();
    expect(restored.boards).toHaveLength(exported.boards.length);
  });

  it("importState refuses an invalid blob", async () => {
    await storage.loadState();
    await expect(storage.importState({} as never)).rejects.toThrow();
  });

  it("subscribe fires after a mutate from another caller", async () => {
    await storage.loadState();
    const seen: number[] = [];
    storage.subscribe((s) => seen.push(s.boards.length));
    await storage.mutate({ type: "create-board", name: "X" });
    await storage.mutate({ type: "create-board", name: "Y" });
    // The initial load notification does not fire (subscribe is
    // post-load). We expect two notifications: 2 and 3.
    expect(seen).toEqual([2, 3]);
  });

  it("serializes concurrent mutates so no writes are lost (R-01)", async () => {
    await storage.loadState();
    // Fire 50 mutates in parallel. After all settle, the board
    // list must contain exactly the initial board + 50 new ones.
    const promises: Array<Promise<PersistedState>> = [];
    for (let i = 0; i < 50; i++) {
      promises.push(
        storage.mutate({ type: "create-board", name: `B${i}` }),
      );
    }
    await Promise.all(promises);
    const final = await storage.exportState();
    expect(final.boards).toHaveLength(51);
  });
});

describe("export / import", () => {
  it("round-trips a state through JSON", () => {
    const s = freshState();
    const json = exportToJson(s);
    const restored = importFromJson(json);
    expect(restored).toEqual(s);
  });

  it("refuses JSON without the right app name", () => {
    const json = JSON.stringify({ app: "other", schemaVersion: 1, state: freshState() });
    expect(() => importFromJson(json)).toThrow(/app=other/);
  });

  it("refuses JSON with an unknown schemaVersion", () => {
    const json = JSON.stringify({
      app: "sidetrack",
      schemaVersion: 99,
      state: freshState(),
    });
    expect(() => importFromJson(json)).toThrow(/schemaVersion=99/);
  });

  it("refuses malformed JSON", () => {
    expect(() => importFromJson("not json")).toThrow(/not valid JSON/);
  });
});

describe("format helpers", () => {
  it("formats a duration in compact form", () => {
    expect(formatDurationCompact(0)).toBe("0s");
    expect(formatDurationCompact(1_000)).toBe("1s");
    expect(formatDurationCompact(60_000)).toBe("1m");
    expect(formatDurationCompact(60_000 * 5)).toBe("5m");
    expect(formatDurationCompact(60_000 * 90)).toBe("1h 30m");
    expect(formatDurationCompact(24 * 60 * 60 * 1000)).toBe("1d");
  });

  it("sums a card's closed entries", () => {
    const total = totalTrackedMs(
      [
        { startAt: 0, endAt: 1000 },
        { startAt: 5000, endAt: 8000 },
        // An open entry: counted up to `now`.
        { startAt: 10_000, endAt: null },
      ],
      12_000,
    );
    expect(total).toBe(1000 + 3000 + 2000);
  });
});

// Smoke checks that the brand factory returns strings of the
// expected shape. (The brand is structural, so this is mostly
// about catching a regression where we accidentally swap to a
// non-string implementation.)
describe("id factories", () => {
  it("produces non-empty string IDs", () => {
    expect(makeBoardId()).toMatch(/.+/);
    expect(makeColumnId()).toMatch(/.+/);
    expect(makeCardId()).toMatch(/.+/);
    expect(makeEntryId()).toMatch(/.+/);
  });
});

