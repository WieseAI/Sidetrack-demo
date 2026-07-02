/**
 * Pure helpers in `src/shared/timer.ts` and the
 * `src/shared/timer-actions.ts` wrapper.
 *
 * The reducer tests in `reducer.test.ts` already cover the
 * writer logic. This file covers the read-side helpers
 * (elapsedMs, totalWithRunning, runningCardTitle, ...) and
 * the imperative start/stop wrappers.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { createStorage, InMemoryStorage } from "../src/shared/storage";
import {
  cardForRunning,
  elapsedMs,
  hasRunning,
  isRunningOn,
  openEntry,
  runningCardTitle,
  runningLocation,
  totalWithRunning,
} from "../src/shared/timer";
import { startTimer, stopTimer } from "../src/shared/timer-actions";
import { applyAction } from "../src/shared/reducer";
import { defaultState } from "../src/shared/seed";
import type { CardId, PersistedState } from "../src/shared/model";

const NOW = 1_700_000_000_000;

function fresh(): PersistedState {
  return defaultState(NOW);
}

describe("elapsedMs", () => {
  it("returns 0 when no timer is running", () => {
    expect(elapsedMs(undefined, NOW)).toBe(0);
  });
  it("subtracts startedAt from now", () => {
    expect(
      elapsedMs({ cardId: "c" as CardId, startedAt: NOW, lastSeenActive: NOW }, NOW + 5_000),
    ).toBe(5_000);
  });
  it("clamps to 0 if `now` is before `startedAt` (clock skew)", () => {
    expect(
      elapsedMs(
        { cardId: "c" as CardId, startedAt: NOW, lastSeenActive: NOW },
        NOW - 1_000,
      ),
    ).toBe(0);
  });
});

describe("totalWithRunning", () => {
  it("sums closed entries", () => {
    const card = {
      id: "c" as CardId,
      title: "X",
      entries: [
        { id: "e1" as never, cardId: "c" as CardId, startAt: 0, endAt: 1000, source: "manual" as const },
        { id: "e2" as never, cardId: "c" as CardId, startAt: 2000, endAt: 5000, source: "manual" as const },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    expect(totalWithRunning(card, undefined, 10_000)).toBe(4000);
  });
  it("adds the live contribution when the running timer targets this card", () => {
    const card = {
      id: "c" as CardId,
      title: "X",
      entries: [
        { id: "e1" as never, cardId: "c" as CardId, startAt: 0, endAt: 1000, source: "manual" as const },
        { id: "open" as never, cardId: "c" as CardId, startAt: 5000, endAt: null, source: "timer" as const },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const running = { cardId: "c" as CardId, startedAt: 5000, lastSeenActive: 5000 };
    expect(totalWithRunning(card, running, 8000)).toBe(1000 + 3000);
  });
  it("does not double-count when the running timer targets a different card", () => {
    const card = {
      id: "c" as CardId,
      title: "X",
      entries: [
        { id: "e1" as never, cardId: "c" as CardId, startAt: 0, endAt: 1000, source: "manual" as const },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const running = { cardId: "other" as CardId, startedAt: 5000, lastSeenActive: 5000 };
    expect(totalWithRunning(card, running, 8000)).toBe(1000);
  });
});

describe("running helpers", () => {
  it("runningCardTitle returns the title of the card being timed", () => {
    const s = fresh();
    const col = s.columns[0]!;
    const s2 = applyAction(s, {
      type: "create-card",
      columnId: col.id,
      title: "Hello",
    });
    const id = s2.cards[s2.cards.length - 1]!.id;
    const s3 = applyAction(s2, {
      type: "start-timer",
      cardId: id,
      now: NOW,
    });
    expect(runningCardTitle(s3)).toBe("Hello");
  });

  it("runningLocation returns the board and column names", () => {
    const s = fresh();
    const col = s.columns[0]!;
    const s2 = applyAction(s, {
      type: "create-card",
      columnId: col.id,
      title: "Hello",
    });
    const id = s2.cards[s2.cards.length - 1]!.id;
    const s3 = applyAction(s2, {
      type: "start-timer",
      cardId: id,
      now: NOW,
    });
    expect(runningLocation(s3)).toEqual({ boardName: "Main", columnName: "Inbox" });
  });

  it("hasRunning and isRunningOn reflect state", () => {
    const s = fresh();
    const col = s.columns[0]!;
    const s2 = applyAction(s, {
      type: "create-card",
      columnId: col.id,
      title: "Hello",
    });
    const id = s2.cards[s2.cards.length - 1]!.id;
    expect(hasRunning(s2)).toBe(false);
    expect(isRunningOn(s2, id)).toBe(false);
    const s3 = applyAction(s2, {
      type: "start-timer",
      cardId: id,
      now: NOW,
    });
    expect(hasRunning(s3)).toBe(true);
    expect(isRunningOn(s3, id)).toBe(true);
  });

  it("cardForRunning returns null when the card is missing", () => {
    const s: PersistedState = {
      ...fresh(),
      runningTimer: { cardId: "missing" as CardId, startedAt: 0, lastSeenActive: 0 },
    };
    expect(cardForRunning(s)).toBeNull();
  });

  it("openEntry finds the open entry on a card", () => {
    const card = {
      id: "c" as CardId,
      title: "X",
      entries: [
        { id: "e1" as never, cardId: "c" as CardId, startAt: 0, endAt: 1000, source: "manual" as const },
        { id: "open" as never, cardId: "c" as CardId, startAt: 5000, endAt: null, source: "timer" as const },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    expect(openEntry(card)?.id).toBe("open");
  });
});

describe("startTimer / stopTimer wrappers", () => {
  let storage: ReturnType<typeof createStorage>;
  beforeEach(async () => {
    storage = createStorage(new InMemoryStorage());
    await storage.loadState();
  });

  it("startTimer opens a running entry and returns the previous card id (AC #4)", async () => {
    const before = await storage.exportState();
    const aId = before.cards[0]!.id;
    const colId = before.columns[0]!.id;
    // Add a second card so we can swap.
    const after = await storage.mutate({
      type: "create-card",
      columnId: colId,
      title: "B",
    });
    const bId = after.cards[after.cards.length - 1]!.id;
    // Start A.
    await startTimer(storage, aId, NOW);
    // Start B: previous should be A.
    const result = await startTimer(storage, bId, NOW + 30_000);
    expect(result.previousCardId).toBe(aId);
    const final = await storage.exportState();
    expect(final.runningTimer?.cardId).toBe(bId);
    const aCard = final.cards.find((c) => c.id === aId)!;
    expect(aCard.entries.find((e) => e.endAt === null)).toBeUndefined();
  });

  it("stopTimer closes the running entry and returns the stopped card id", async () => {
    const before = await storage.exportState();
    const aId = before.cards[0]!.id;
    await startTimer(storage, aId, NOW);
    const result = await stopTimer(storage, NOW + 60_000);
    expect(result.stoppedCardId).toBe(aId);
    const final = await storage.exportState();
    expect(final.runningTimer).toBeUndefined();
    const aCard = final.cards.find((c) => c.id === aId)!;
    const open = aCard.entries.find((e) => e.endAt === null);
    expect(open).toBeUndefined();
    const closed = aCard.entries.find((e) => e.endAt === NOW + 60_000);
    expect(closed).toBeDefined();
  });

  it("stopTimer is a no-op when nothing is running", async () => {
    const result = await stopTimer(storage, NOW);
    expect(result.stoppedCardId).toBeNull();
  });
});
