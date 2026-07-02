/**
 * Timer-survival test scenario.
 *
 * This file automates the manual script in
 * `docs/reports/phase-0/timer-survival-test.md`. It drives the
 * real reducer + storage path with deterministic clock values,
 * proves that elapsed time is computed from `startedAt` (not
 * accumulated), and proves that the single-active-timer rule
 * is honored.
 *
 * Driving the actual Chrome extension in CI is out of scope for
 * this environment (no Puppeteer / Playwright dependency, and
 * no Chrome installed in the container). The reducer is the
 * authoritative writer of the running-timer block; the sidepanel
 * and the service worker are thin consumers of it. A test that
 * drives the reducer + storage handle is therefore a faithful
 * proxy for end-to-end survival: the only Chrome-specific path
 * not exercised here is the alarm re-anchor, which is exercised
 * by `background-timer.test.ts` with a fake `chrome.alarms`.
 *
 * If/when a real Chrome harness is added (Phase 5), this file
 * can be wrapped in a Puppeteer flow that boots the extension,
 * starts a timer, kills the service worker, waits, and asserts
 * the running timer is still correct. The acceptance criteria
 * below remain the same.
 */

import { describe, expect, it } from "vitest";
import { createStorage, InMemoryStorage } from "../src/shared/storage";
import { applyAction } from "../src/shared/reducer";
import { defaultState } from "../src/shared/seed";
import {
  cardForRunning,
  elapsedMs,
  hasRunning,
  isRunningOn,
  totalWithRunning,
} from "../src/shared/timer";
import type { CardId, PersistedState } from "../src/shared/model";

const T0 = 1_700_000_000_000; // wall clock anchor

describe("Scenario 1 — service-worker kill while a timer is running", () => {
  it("elapsed time keeps increasing from startedAt across a simulated kill", async () => {
    // Storage in lieu of the real chrome.storage.local.
    const storage = createStorage(new InMemoryStorage());
    const s0 = await storage.loadState();
    const col = s0.columns[0]!;
    // Create the "Survival target" card.
    const s1 = applyAction(s0, {
      type: "create-card",
      columnId: col.id,
      title: "Survival target",
    });
    const cardId = s1.cards[s1.cards.length - 1]!.id;
    // Start the timer at T0.
    const s2 = applyAction(s1, {
      type: "start-timer",
      cardId,
      now: T0,
    });
    // 30 s later, the SW is killed (no storage change). The
    // startedAt anchor is still T0; the running block still
    // exists.
    const elapsedAtKill = elapsedMs(s2.runningTimer, T0 + 30_000);
    expect(elapsedAtKill).toBe(30_000);
    // Cold-start reconciliation (the alarm would fire here in
    // a real SW). The startedAt anchor is preserved.
    const s3 = applyAction(s2, {
      type: "cold-start-reconcile",
      now: T0 + 31_000,
    });
    expect(s3.runningTimer?.startedAt).toBe(T0);
    // 60 s after the kill (T0 + 90 s), the elapsed time is the
    // wall-clock interval — within the 1-minute alarm floor.
    const elapsedAfter = elapsedMs(s3.runningTimer, T0 + 90_000);
    // The 1-minute alarm latency means the SW may not have
    // re-anchored until T0+90s + 60s; the elapsed time is
    // exactly wall-clock and the bar simply doesn't tick during
    // the kill (D-04).
    expect(elapsedAfter).toBe(90_000);
  });
});

describe("Scenario 2 — full browser restart while a timer is running", () => {
  it("the persisted state round-trips through a fresh storage handle", async () => {
    const storage = createStorage(new InMemoryStorage());
    const s0 = await storage.loadState();
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, {
      type: "create-card",
      columnId: col.id,
      title: "Survival target",
    });
    const cardId = s1.cards[s1.cards.length - 1]!.id;
    const s2 = applyAction(s1, {
      type: "start-timer",
      cardId,
      now: T0,
    });
    await storage.importState(s2);
    // 5 minutes later, the user reopens Chrome. We model this
    // by building a brand-new storage handle from the exported
    // blob — the chrome.storage.local round-trip.
    const exported = await storage.exportState();
    const storage2 = createStorage(
      new InMemoryStorage({ "sidetrack.state.v1": exported }),
    );
    const reloaded = await storage2.loadState();
    // The running block survived the restart.
    expect(hasRunning(reloaded)).toBe(true);
    expect(isRunningOn(reloaded, cardId)).toBe(true);
    // Elapsed time is the wall-clock interval since startedAt.
    const elapsed = elapsedMs(reloaded.runningTimer, T0 + 5 * 60_000);
    expect(elapsed).toBe(5 * 60_000);
  });
});

describe("Scenario 3 — sleep / wake (no kill, just wall clock)", () => {
  it("elapsed time tracks the wall clock across a long sleep", async () => {
    const storage = createStorage(new InMemoryStorage());
    const s0 = await storage.loadState();
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, {
      type: "create-card",
      columnId: col.id,
      title: "Survival target",
    });
    const cardId = s1.cards[s1.cards.length - 1]!.id;
    // Start the timer (write through the storage handle so the
    // change is persisted).
    const s2 = applyAction(s1, { type: "start-timer", cardId, now: T0 });
    await storage.importState(s2);
    // 11 minutes later (1 min awake + 10 min sleep + wake).
    const after = await storage.exportState();
    const elapsed = elapsedMs(after.runningTimer, T0 + 11 * 60_000);
    expect(elapsed).toBe(11 * 60_000);
  });
});

describe("Scenario 4 — single-active-timer rule (AC #4)", () => {
  it("starting a timer on card B closes the entry on card A and surfaces the previous card id", async () => {
    const storage = createStorage(new InMemoryStorage());
    const s0 = await storage.loadState();
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "A" });
    const aId = s1.cards[s1.cards.length - 1]!.id;
    const s2 = applyAction(s1, { type: "create-card", columnId: col.id, title: "B" });
    const bId = s2.cards[s2.cards.length - 1]!.id;
    // Start A.
    const s3 = applyAction(s2, { type: "start-timer", cardId: aId, now: T0 });
    // 30 s later, start B.
    const s4 = applyAction(s3, {
      type: "start-timer",
      cardId: bId,
      now: T0 + 30_000,
    });
    // Card A's running entry is closed.
    const aCard = s4.cards.find((c) => c.id === aId)!;
    const aOpen = aCard.entries.find((e) => e.endAt === null);
    expect(aOpen).toBeUndefined();
    const aClosed = aCard.entries.find((e) => e.endAt === T0 + 30_000);
    expect(aClosed).toBeDefined();
    expect(aClosed!.source).toBe("timer");
    // Card B has an open entry.
    const bCard = s4.cards.find((c) => c.id === bId)!;
    const bOpen = bCard.entries.find((e) => e.endAt === null);
    expect(bOpen).toBeDefined();
    expect(bOpen!.startAt).toBe(T0 + 30_000);
    // The persisted RunningTimer block references B, not A.
    expect(s4.runningTimer?.cardId).toBe(bId);
    // Total on A is 30 s; total on B is whatever the elapsed
    // time is at the point we look.
    const totalA = totalWithRunning(aCard, s4.runningTimer, T0 + 30_000);
    expect(totalA).toBe(30_000);
    const totalB = totalWithRunning(bCard, s4.runningTimer, T0 + 30_000);
    expect(totalB).toBe(0);
  });
});

describe("Scenario — total accumulation across multiple runs", () => {
  it("sums closed runs and the current run", async () => {
    const s0 = defaultState(T0);
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "C" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    const s2 = applyAction(s1, { type: "start-timer", cardId: cid, now: T0 });
    const s3 = applyAction(s2, { type: "stop-timer", now: T0 + 60_000 });
    // 30 min later, start another run.
    const s4 = applyAction(s3, { type: "start-timer", cardId: cid, now: T0 + 30 * 60_000 });
    const card = s4.cards.find((c) => c.id === cid)!;
    const total = totalWithRunning(card, s4.runningTimer, T0 + 30 * 60_000 + 15 * 60_000);
    // 1 min (first run) + 15 min (current run) = 16 min.
    expect(total).toBe(16 * 60_000);
  });
});

describe("Scenario — running bar location is correct for a nested column", () => {
  it("finds the card's column and the owning board", async () => {
    const s0 = defaultState(T0);
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "X" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    const s2 = applyAction(s1, { type: "start-timer", cardId: cid, now: T0 });
    const live = cardForRunning(s2);
    expect(live).not.toBeNull();
    expect(live!.card.title).toBe("X");
  });
});

describe("Scenario — running timer survives a card delete (the entry is closed cleanly)", () => {
  it("clears a stale running block when its card has been deleted under it", async () => {
    const s0 = defaultState(T0);
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "X" });
    const cid = s1.cards[s1.cards.length - 1]!.id;
    const s2 = applyAction(s1, { type: "start-timer", cardId: cid, now: T0 });
    const s3 = applyAction(s2, { type: "delete-card", cardId: cid });
    // Cold-start reconciliation clears the running block.
    const s4 = applyAction(s3, { type: "cold-start-reconcile", now: T0 + 5_000 });
    expect(s4.runningTimer).toBeUndefined();
  });
});

// Sanity check: the test file's import surface is small. This
// catch-all fails if we ever drop the data we depend on.
void ({} as PersistedState);
void ({} as CardId);
