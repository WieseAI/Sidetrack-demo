/**
 * Phase 3 — idle detection tests.
 *
 * The brief calls this "the heart of the product" (Phase 3
 * issue), so the tests here are organized around the user-
 * visible behavior:
 *
 *   1. Detection: a running timer that crosses the threshold
 *      produces an `IdlePrompt` of kind `"open"`.
 *   2. Trim: picking "Trim" from the prompt retroactively
 *      closes the entry at the last active moment and starts
 *      a new one there. The running block's `startedAt`
 *      advances to the trim point.
 *   3. Stop (and trim): trim first, then stop.
 *   4. Keep all: dismiss the prompt, leave the entry running.
 *   5. Cold-start gap: when the sidepanel opens with a stale
 *      prompt, the prompt is surfaced; when the gap is large
 *      enough and no prompt is set, the detector sets one.
 *   6. The detector does not re-prompt inside the
 *      `TRIM_RECENTLY_LIFETIME_MS` window after a trim.
 *   7. The stale-prompt check is defensive: a prompt whose
 *      `entryId` no longer matches the open entry is cleared
 *      by the sidepanel on cold start.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAction } from "../src/shared/reducer";
import { defaultState } from "../src/shared/seed";
import type { PersistedState, CardId, IdlePrompt } from "../src/shared/model";
import { createStorage, InMemoryStorage } from "../src/shared/storage";
import { evaluateIdle, isPromptStale, TRIM_RECENTLY_LIFETIME_MS } from "../src/shared/idle";
import {
  dismissIdlePrompt,
  setIdlePrompt,
  startTimer,
  trimTimer,
  trimTimerAndStop,
} from "../src/shared/timer-actions";

const NOW = 1_716_000_000_000; // fixed timestamp for determinism
const T0 = NOW - 60 * 60_000;  // 1h before NOW

function fresh(now: number = NOW): PersistedState {
  return defaultState(now);
}

beforeEach(() => {
  // Each test gets a fresh module to avoid cross-test state.
});

afterEach(() => {
  // No-op; the storage handle is per-test.
});

describe("evaluateIdle — detection", () => {
  it("returns no-timer when no timer is running", () => {
    const s = fresh();
    const result = evaluateIdle(s, NOW);
    expect(result.kind).toBe("no-timer");
  });

  it("returns not-idle when the running timer is well under the threshold", () => {
    const s0 = fresh();
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "X" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    const s2 = applyAction(s1, { type: "start-timer", cardId: cid, now: T0 });
    // 1 minute idle, threshold is 5 min.
    const result = evaluateIdle(s2, T0 + 60_000);
    expect(result.kind).toBe("not-idle");
  });

  it("returns idle with a prompt when the threshold is crossed", () => {
    const s0 = fresh();
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "X" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    const s2 = applyAction(s1, { type: "start-timer", cardId: cid, now: T0 });
    // 6 minutes idle, threshold 5 min.
    const result = evaluateIdle(s2, T0 + 6 * 60_000);
    expect(result.kind).toBe("idle");
    if (result.kind !== "idle") return;
    expect(result.prompt.cardId).toBe(cid);
    expect(result.prompt.lastSeenActive).toBe(T0);
    expect(result.prompt.idleForMs).toBe(6 * 60_000);
    expect(result.prompt.kind).toBe("open");
  });

  it("respects a custom threshold override", () => {
    const s0 = fresh();
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "X" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    const s2 = applyAction(s1, { type: "start-timer", cardId: cid, now: T0 });
    // 2 minutes idle, threshold override 1 min -> idle.
    const result = evaluateIdle(s2, T0 + 2 * 60_000, 60);
    expect(result.kind).toBe("idle");
  });

  it("returns pending-prompt if a prompt is already set", () => {
    const s0 = fresh();
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "X" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    const s2 = applyAction(s1, { type: "start-timer", cardId: cid, now: T0 });
    const prompt: IdlePrompt = {
      cardId: cid,
      entryId: "e" as never,
      detectedAt: T0,
      lastSeenActive: T0,
      idleForMs: 6 * 60_000,
      kind: "open",
    };
    const s3 = applyAction(s2, { type: "set-idle-prompt", prompt });
    const result = evaluateIdle(s3, T0 + 6 * 60_000);
    expect(result.kind).toBe("pending-prompt");
  });

  it("returns trimmed-recently when the prompt is in cooldown", () => {
    const s0 = fresh();
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "X" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    const s2 = applyAction(s1, { type: "start-timer", cardId: cid, now: T0 });
    const prompt: IdlePrompt = {
      cardId: cid,
      entryId: "e" as never,
      detectedAt: NOW,
      lastSeenActive: NOW,
      idleForMs: 0,
      kind: "trimmed-recently",
    };
    const s3 = applyAction(s2, { type: "set-idle-prompt", prompt });
    const result = evaluateIdle(s3, NOW);
    expect(result.kind).toBe("trimmed-recently");
  });
});

describe("trim-timer reducer action", () => {
  it("closes the open entry at trimTo with source 'idle-trim' and opens a new one at trimTo", () => {
    const s0 = fresh();
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "X" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    const s2 = applyAction(s1, { type: "start-timer", cardId: cid, now: T0 });
    // 10 minutes in, trim back to 4 minutes (i.e. trimTo = T0 + 4min).
    const trimTo = T0 + 4 * 60_000;
    const s3 = applyAction(s2, { type: "trim-timer", trimTo, now: T0 + 10 * 60_000 });
    const card = s3.cards.find((c) => c.id === cid)!;
    // Old entry closed at trimTo with idle-trim source.
    const closed = card.entries.find((e) => e.endAt === trimTo);
    expect(closed).toBeDefined();
    expect(closed!.source).toBe("idle-trim");
    // New entry open at trimTo with timer source.
    const open = card.entries.find((e) => e.endAt === null);
    expect(open).toBeDefined();
    expect(open!.startAt).toBe(trimTo);
    expect(open!.source).toBe("timer");
    // Running block's startedAt advanced to trimTo.
    expect(s3.runningTimer?.startedAt).toBe(trimTo);
    // pendingIdlePrompt replaced with a "trimmed-recently" marker.
    expect(s3.pendingIdlePrompt?.kind).toBe("trimmed-recently");
  });

  it("is a no-op when trimTo is at or before startedAt", () => {
    const s0 = fresh();
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "X" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    const s2 = applyAction(s1, { type: "start-timer", cardId: cid, now: T0 });
    const s3 = applyAction(s2, { type: "trim-timer", trimTo: T0, now: T0 + 60_000 });
    expect(s3).toBe(s2);
  });

  it("is a no-op when no timer is running", () => {
    const s0 = fresh();
    const s1 = applyAction(s0, { type: "trim-timer", trimTo: T0, now: T0 + 60_000 });
    expect(s1).toBe(s0);
  });

  it("preserves the user's total tracked time on the card except for the trimmed window", () => {
    const s0 = fresh();
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "X" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    // Start timer at T0. 10 minutes later, trim to 4 minutes.
    const s2 = applyAction(s1, { type: "start-timer", cardId: cid, now: T0 });
    const s3 = applyAction(s2, { type: "trim-timer", trimTo: T0 + 4 * 60_000, now: T0 + 10 * 60_000 });
    const card = s3.cards.find((c) => c.id === cid)!;
    // Sum of closed entries: 4 minutes (the trimmed window).
    // The new open entry contributes nothing yet (endAt is null).
    let sum = 0;
    for (const e of card.entries) {
      if (e.endAt !== null) sum += e.endAt - e.startAt;
    }
    expect(sum).toBe(4 * 60_000);
  });
});

describe("trimTimer / stopTimer / dismissIdlePrompt — imperative wrappers", () => {
  it("trimTimer writes through and marks the prompt trimmed-recently (AC #5)", async () => {
    const storage = createStorage(new InMemoryStorage());
    const s0 = await storage.loadState();
    const col = s0.columns[0]!;
    const s1 = await storage.mutate({ type: "create-card", columnId: col.id, title: "X" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    await startTimer(storage, cid, T0);
    // Fetch the running entry id from the *post-startTimer* state.
    const afterStart = await storage.exportState();
    const cardAfterStart = afterStart.cards.find((c) => c.id === cid)!;
    const open = cardAfterStart.entries.find((e) => e.endAt === null)!;
    // Simulate the SW setting a prompt.
    await setIdlePrompt(storage, {
      cardId: cid,
      entryId: open.id,
      detectedAt: T0 + 6 * 60_000,
      lastSeenActive: T0,
      idleForMs: 6 * 60_000,
      kind: "open",
    });
    // User picks Trim.
    await trimTimer(storage, T0 + 4 * 60_000, T0 + 6 * 60_000);
    const after = await storage.exportState();
    // The prompt is replaced with a "trimmed-recently" marker
    // so the next alarm tick does not re-prompt.
    expect(after.pendingIdlePrompt?.kind).toBe("trimmed-recently");
    const card = after.cards.find((c) => c.id === cid)!;
    const closed = card.entries.find((e) => e.endAt === T0 + 4 * 60_000);
    expect(closed).toBeDefined();
    expect(closed!.source).toBe("idle-trim");
  });

  it("trimTimerAndStop closes the entry at trimTo with no new open entry (AC #5 'Stop' choice)", async () => {
    const storage = createStorage(new InMemoryStorage());
    const s0 = await storage.loadState();
    const col = s0.columns[0]!;
    const s1 = await storage.mutate({ type: "create-card", columnId: col.id, title: "X" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    await startTimer(storage, cid, T0);
    await trimTimerAndStop(storage, T0 + 4 * 60_000, T0 + 6 * 60_000);
    const after = await storage.exportState();
    expect(after.runningTimer).toBeUndefined();
    expect(after.pendingIdlePrompt).toBeUndefined();
    const card = after.cards.find((c) => c.id === cid)!;
    const open = card.entries.find((e) => e.endAt === null);
    expect(open).toBeUndefined();
    // 4 minutes total (the idle-trimmed window is not counted).
    let total = 0;
    for (const e of card.entries) total += e.endAt! - e.startAt;
    expect(total).toBe(4 * 60_000);
  });

  it("dismissIdlePrompt clears the prompt without touching the timer (Keep all)", async () => {
    const storage = createStorage(new InMemoryStorage());
    const s0 = await storage.loadState();
    const col = s0.columns[0]!;
    const s1 = await storage.mutate({ type: "create-card", columnId: col.id, title: "X" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    await startTimer(storage, cid, T0);
    const afterStart = await storage.exportState();
    const cardAfterStart = afterStart.cards.find((c) => c.id === cid)!;
    const open = cardAfterStart.entries.find((e) => e.endAt === null)!;
    await setIdlePrompt(storage, {
      cardId: cid,
      entryId: open.id,
      detectedAt: T0 + 6 * 60_000,
      lastSeenActive: T0,
      idleForMs: 6 * 60_000,
      kind: "open",
    });
    await dismissIdlePrompt(storage);
    const after = await storage.exportState();
    expect(after.pendingIdlePrompt).toBeUndefined();
    // Running timer still active.
    expect(after.runningTimer?.cardId).toBe(cid);
  });
});

describe("isPromptStale", () => {
  it("returns true when the prompt's card no longer has an open entry", () => {
    const s0 = fresh();
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "X" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    const s2 = applyAction(s1, { type: "start-timer", cardId: cid, now: T0 });
    const prompt: IdlePrompt = {
      cardId: cid,
      entryId: "stale" as never,
      detectedAt: T0,
      lastSeenActive: T0,
      idleForMs: 6 * 60_000,
      kind: "open",
    };
    expect(isPromptStale(s2, prompt)).toBe(true);
  });

  it("returns false when the prompt's entryId matches the open entry", () => {
    const s0 = fresh();
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "X" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    const s2 = applyAction(s1, { type: "start-timer", cardId: cid, now: T0 });
    const realEntryId = s2.cards.find((c) => c.id === cid)!.entries[0]!.id;
    const prompt: IdlePrompt = {
      cardId: cid,
      entryId: realEntryId,
      detectedAt: T0,
      lastSeenActive: T0,
      idleForMs: 6 * 60_000,
      kind: "open",
    };
    expect(isPromptStale(s2, prompt)).toBe(false);
  });

  it("returns true when no timer is running", () => {
    const s0 = fresh();
    const prompt: IdlePrompt = {
      cardId: "c" as CardId,
      entryId: "e" as never,
      detectedAt: T0,
      lastSeenActive: T0,
      idleForMs: 0,
      kind: "open",
    };
    expect(isPromptStale(s0, prompt)).toBe(true);
  });
});

describe("trimmed-recently window (R-02 / D-08)", () => {
  it("does not re-prompt inside the cooldown window after a trim", () => {
    const s0 = fresh();
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "X" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    const s2 = applyAction(s1, { type: "start-timer", cardId: cid, now: T0 });
    // 6 minutes idle, threshold 5 min -> prompt fires.
    const s3 = applyAction(s2, { type: "set-idle-prompt", prompt: {
      cardId: cid,
      entryId: s2.cards.find((c) => c.id === cid)!.entries[0]!.id,
      detectedAt: T0 + 6 * 60_000,
      lastSeenActive: T0,
      idleForMs: 6 * 60_000,
      kind: "open",
    } });
    // User trims; reducer marks the prompt trimmed-recently.
    const s4 = applyAction(s3, {
      type: "trim-timer",
      trimTo: T0 + 4 * 60_000,
      now: T0 + 6 * 60_000,
    });
    expect(s4.pendingIdlePrompt?.kind).toBe("trimmed-recently");
    // A few seconds later (well within the cooldown), the
    // detector must not re-prompt.
    const result = evaluateIdle(s4, T0 + 6 * 60_000 + 5_000);
    expect(result.kind).toBe("trimmed-recently");
  });

  it("TRIM_RECENTLY_LIFETIME_MS is positive and small", () => {
    expect(TRIM_RECENTLY_LIFETIME_MS).toBeGreaterThan(0);
    expect(TRIM_RECENTLY_LIFETIME_MS).toBeLessThan(5 * 60_000);
  });
});

describe("set-idle-prompt reducer action", () => {
  it("sets a prompt", () => {
    const s0 = fresh();
    const prompt: IdlePrompt = {
      cardId: "c" as CardId,
      entryId: "e" as never,
      detectedAt: T0,
      lastSeenActive: T0,
      idleForMs: 0,
      kind: "open",
    };
    const s1 = applyAction(s0, { type: "set-idle-prompt", prompt });
    expect(s1.pendingIdlePrompt).toEqual(prompt);
  });

  it("clears the prompt with undefined", () => {
    const s0 = fresh();
    const prompt: IdlePrompt = {
      cardId: "c" as CardId,
      entryId: "e" as never,
      detectedAt: T0,
      lastSeenActive: T0,
      idleForMs: 0,
      kind: "open",
    };
    const s1 = applyAction(s0, { type: "set-idle-prompt", prompt });
    const s2 = applyAction(s1, { type: "set-idle-prompt", prompt: undefined });
    expect(s2.pendingIdlePrompt).toBeUndefined();
  });
});
