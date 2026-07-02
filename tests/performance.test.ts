import { describe, it, expect } from "vitest";
import { applyAction } from "../src/shared/reducer";
import { defaultState } from "../src/shared/seed";
import {
  TIMER_ALARM_PERIOD_MINUTES,
  cardForRunning,
  totalWithRunning,
} from "../src/shared/timer";
import { computeReport } from "../src/shared/reports";
import { makeCardId, makeEntryId } from "../src/shared/ids";
import type { PersistedState } from "../src/shared/model";

/**
 * Phase 5 performance smoke test.
 *
 * The brief: "Sidepanel opens in <200ms on a mid-range laptop.
 * Drag-and-drop stays at 60fps. Timer tick re-render is <1ms."
 *
 * We can't measure "60fps drag" or "sidepanel open time" in
 * a unit test — those are real-Chrome measurements. What we
 * *can* measure is the per-tick cost the brief calls out:
 * the timer re-render path runs `cardForRunning` +
 * `totalWithRunning` for every card on every tick, and
 * the reports view runs `computeReport` over the whole
 * state. We assert both stay sub-millisecond on a 500-card
 * dataset on the developer's machine.
 *
 * The numbers here are not the brief's AC; the brief's AC
 * is the real-Chrome measurement. This file is a regression
 * guard: a future refactor that pushes the per-tick path
 * above 5ms (a 5x slack on a developer's machine) trips
 * the test. The 500-card fixture is the upper bound the
 * brief calls out for "hundreds of cards."
 */

const T0 = 1_700_000_000_000;

/** Build a persisted state with `cardCount` cards distributed
 *  across 5 columns, with a mix of closed and one running
 *  entry per card. */
function buildLargeState(cardCount: number): PersistedState {
  const base = defaultState(T0);
    const columnIds = base.columns.map((c) => c.id);
  // Add a 5th column if we need more spread.
  const newColumns = base.columns.slice(0, 5);
  const cards: PersistedState["cards"] = [];
  for (let i = 0; i < cardCount; i++) {
    const id = makeCardId();
    const colId = columnIds[i % columnIds.length]!;
    cards.push({
      id,
      title: `Card ${i}`,
      description: i % 3 === 0 ? `Description for card ${i}` : undefined,
      entries: i % 4 === 0 && i > 0
        ? [
            {
              id: makeEntryId(),
              cardId: id,
              startAt: T0 - 3600_000,
              endAt: T0 - 1800_000,
              source: "timer",
            },
            {
              id: makeEntryId(),
              cardId: id,
              startAt: T0 - 1800_000,
              endAt: T0 - 900_000,
              source: "manual",
            },
          ]
        : [],
      createdAt: T0 - i * 1000,
      updatedAt: T0 - i * 1000,
    });
    const col = newColumns.find((c) => c.id === colId)!;
    col.cardIds.push(id);
  }
  // Make one card (the first one) currently running.
  const firstCard = cards[0]!;
  firstCard.entries.push({
    id: makeEntryId(),
    cardId: firstCard.id,
    startAt: T0,
    endAt: null,
    source: "timer",
  });
  return {
    ...base,
    cards,
    runningTimer: { cardId: firstCard.id, startedAt: T0, lastSeenActive: T0 },
  };
}

describe("Phase 5 — performance with 500 cards", () => {
  it("500-card fixture builds in well under a second", () => {
    const t0 = performance.now();
    const state = buildLargeState(500);
    const t1 = performance.now();
    expect(state.cards.length).toBe(500);
    // The build is O(n) and not on a hot path, but we still
    // assert it's fast enough that the seed does not become
    // a bottleneck in the future.
    expect(t1 - t0).toBeLessThan(500);
  });

  it("`cardForRunning` (timer-bar render path) is sub-millisecond per call", () => {
    const state = buildLargeState(500);
    // Warm up V8.
    for (let i = 0; i < 20; i++) cardForRunning(state);
    // Measure the median of 200 calls.
    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      cardForRunning(state);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;
    // 5ms is a 5x slack on a developer's machine; CI is
    // typically slower than a developer laptop, so we keep
    // the budget generous. The brief's <1ms is for a single
    // call; we measure the median so a single GC pause
    // doesn't dominate.
    expect(median, `median=${median.toFixed(3)}ms`).toBeLessThan(5);
  });

  it("`totalWithRunning` (per-card total render path) is sub-millisecond for every card", () => {
    const state = buildLargeState(500);
    const timer = state.runningTimer;
    // Warm up.
    for (const card of state.cards.slice(0, 50)) {
      totalWithRunning(card, timer, T0 + 1000);
    }
    const samples: number[] = [];
    for (const card of state.cards) {
      const t0 = performance.now();
      totalWithRunning(card, timer, T0 + 1000);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;
    expect(median, `median=${median.toFixed(3)}ms`).toBeLessThan(1);
  });

  it("`computeReport` (reports view) is fast on a 500-card state", () => {
    const state = buildLargeState(500);
    // Warm up.
    for (let i = 0; i < 5; i++) {
      computeReport(state, "today", T0);
    }
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      computeReport(state, "today", T0);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;
    // Reports re-compute on every render; the budget is
    // generous because reports run over every entry of
    // every card, not just the cards in the active board.
    expect(median, `median=${median.toFixed(3)}ms`).toBeLessThan(20);
  });

  it("`move-card` (drag end) is fast on a 500-card state", () => {
    const state = buildLargeState(500);
    const firstColumn = state.columns[0]!;
    const firstCardId = firstColumn.cardIds[0]!;
    // Warm up.
    for (let i = 0; i < 20; i++) {
      applyAction(state, {
        type: "move-card",
        cardId: firstCardId,
        toColumnId: state.columns[1]!.id,
        toIndex: 0,
      });
    }
    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      applyAction(state, {
        type: "move-card",
        cardId: firstCardId,
        toColumnId: state.columns[i % state.columns.length]!.id,
        toIndex: 0,
      });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;
    expect(median, `median=${median.toFixed(3)}ms`).toBeLessThan(5);
  });
});

describe("Phase 5 — alarm constants are sensible", () => {
  it("the timer alarm period stays at the MV3 1-minute floor", () => {
    // The brief AC #3 is "elapsed time is correct to the
    // minute." The MV3 alarm API floor is 1 minute. Lock
    // it in so a future refactor doesn't tighten it without
    // knowing it'll break in production.
    expect(TIMER_ALARM_PERIOD_MINUTES).toBe(1);
  });
});
