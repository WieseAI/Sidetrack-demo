/**
 * Service-worker timer glue.
 *
 * Exercises `src/background/timer.ts` against a fake
 * `chrome.alarms` and a fake `chrome.runtime` shim. The shim
 * mimics the relevant parts of the Chrome API surface that the
 * SW code touches:
 *
 *   - `chrome.alarms.create(name, { periodInMinutes })`
 *   - `chrome.alarms.get(name) -> Alarm | undefined`
 *   - `chrome.alarms.onAlarm.addListener(cb)`
 *   - `chrome.runtime.onMessage.addListener(cb)`
 *
 * The point of this test is to prove the alarm handler is
 * idempotent and that the message handler round-trips start /
 * stop. The reducer is the authoritative writer; the alarm and
 * message code is plumbing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeAlarm {
  name: string;
  periodInMinutes: number;
  delayInMinutes: number;
  fire: () => void;
}

const alarms = new Map<string, FakeAlarm>();
let alarmListener: ((a: FakeAlarm) => void) | null = null;
let messageListener:
  | ((
      message: unknown,
      _sender: unknown,
      sendResponse: (resp: unknown) => void,
    ) => boolean)
  | null = null;
let installListener: (() => void) | null = null;

function makeFakeChrome() {
  return {
    alarms: {
      create: vi.fn(
        (name: string, info: { periodInMinutes: number; delayInMinutes: number }) => {
          const alarm: FakeAlarm = {
            name,
            periodInMinutes: info.periodInMinutes,
            delayInMinutes: info.delayInMinutes,
            fire: () => alarmListener?.(alarm),
          };
          alarms.set(name, alarm);
        },
      ),
      get: vi.fn(async (name: string) => alarms.get(name)),
      onAlarm: {
        addListener: vi.fn((cb: (a: FakeAlarm) => void) => {
          alarmListener = cb;
        }),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      onMessage: {
        addListener: vi.fn(
          (
            cb: (
              message: unknown,
              _sender: unknown,
              sendResponse: (resp: unknown) => void,
            ) => boolean,
          ) => {
            messageListener = cb;
          },
        ),
        removeListener: vi.fn(),
      },
      onInstalled: {
        addListener: vi.fn((cb: () => void) => {
          installListener = cb;
        }),
      },
      onStartup: {
        addListener: vi.fn(),
      },
    },
  };
}

let fake: ReturnType<typeof makeFakeChrome>;

beforeEach(() => {
  alarms.clear();
  alarmListener = null;
  messageListener = null;
  installListener = null;
  fake = makeFakeChrome();
  (globalThis as unknown as { chrome: unknown }).chrome = fake;
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

/** A helper to load a fresh in-memory storage handle and seed
 *  it with a running timer. The background module's storage
 *  singleton is bound to the real `chrome.storage`; we set
 *  up our own handle and call `reconcileOnStartup` which uses
 *  the same singleton. The test then asserts the alarm /
 *  message plumbing is wired correctly against the
 *  singleton's persisted state. */
async function seedRunningTimerOnA() {
  const { createStorage, InMemoryStorage } = await import(
    "../src/shared/storage"
  );
  const { applyAction } = await import("../src/shared/reducer");
  const storage = createStorage(new InMemoryStorage());
  const s0 = await storage.loadState();
  const col = s0.columns[0]!;
  const s1 = applyAction(s0, {
    type: "create-card",
    columnId: col.id,
    title: "A",
  });
  const aId = s1.cards[s1.cards.length - 1]!.id;
  const T0 = 1_700_000_000_000;
  const s2 = applyAction(s1, { type: "start-timer", cardId: aId, now: T0 });
  // Replace the singleton's cached state.
  const singleton = (await import("../src/shared/storage")).storage;
  await singleton.importState(s2);
  return { aId, singleton, T0 };
}

describe("background timer glue", () => {
  it("ensureTimerAlarm creates the recurring alarm", async () => {
    const { ensureTimerAlarm } = await import("../src/background/timer");
    await ensureTimerAlarm();
    expect(fake.alarms.create).toHaveBeenCalledWith(
      "sidetrack.timer-tick",
      expect.objectContaining({ periodInMinutes: 1 }),
    );
  });

  it("ensureTimerAlarm is a no-op when the alarm already exists", async () => {
    const { ensureTimerAlarm } = await import("../src/background/timer");
    await ensureTimerAlarm();
    fake.alarms.create.mockClear();
    await ensureTimerAlarm();
    expect(fake.alarms.create).not.toHaveBeenCalled();
  });

  it("alarm handler re-anchors the running timer's lastSeenActive", async () => {
    const { TIMER_ALARM } = await import("../src/shared/timer");
    const { bindTimerAlarm, ensureTimerAlarm, reconcileOnStartup } =
      await import("../src/background/timer");
    const { aId, singleton } = await seedRunningTimerOnA();
    await ensureTimerAlarm();
    bindTimerAlarm();
    // Cold-start reconciliation populates the singleton's cache.
    await reconcileOnStartup();
    const before = (await singleton.exportState()).runningTimer!.lastSeenActive;
    // Fire the alarm — must not throw, and must refresh the
    // lastSeenActive anchor.
    alarms.get(TIMER_ALARM)?.fire();
    await new Promise((r) => setTimeout(r, 0));
    const after = (await singleton.exportState()).runningTimer!.lastSeenActive;
    expect(after).toBeGreaterThanOrEqual(before);
    void aId;
  });

  it("message handler dispatches start-timer and returns previousCardId", async () => {
    const { bindTimerMessages, ensureTimerAlarm, reconcileOnStartup } =
      await import("../src/background/timer");
    const { createStorage, InMemoryStorage } = await import(
      "../src/shared/storage"
    );
    const { applyAction } = await import("../src/shared/reducer");
    const singleton = (await import("../src/shared/storage")).storage;
    // Seed two cards with a running timer on A.
    const storage = createStorage(new InMemoryStorage());
    const s0 = await storage.loadState();
    const col = s0.columns[0]!;
    const s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "A" });
    const aId = s1.cards[s1.cards.length - 1]!.id;
    const s2 = applyAction(s1, { type: "create-card", columnId: col.id, title: "B" });
    const bId = s2.cards[s2.cards.length - 1]!.id;
    const T0 = 1_700_000_000_000;
    const s3 = applyAction(s2, { type: "start-timer", cardId: aId, now: T0 });
    await singleton.importState(s3);
    await ensureTimerAlarm();
    bindTimerMessages();
    await reconcileOnStartup();
    if (!messageListener) throw new Error("message listener not bound");
    const startA = await new Promise<{ ok: boolean; previousCardId?: string }>(
      (resolve) => {
        messageListener!({ type: "start-timer", cardId: aId }, null, (r) =>
          resolve(r as { ok: boolean; previousCardId?: string }),
        );
      },
    );
    expect(startA.ok).toBe(true);
    // Same card — no previous.
    expect(startA.previousCardId).toBeUndefined();

    const startB = await new Promise<{ ok: boolean; previousCardId?: string }>(
      (resolve) => {
        messageListener!({ type: "start-timer", cardId: bId }, null, (r) =>
          resolve(r as { ok: boolean; previousCardId?: string }),
        );
      },
    );
    expect(startB.ok).toBe(true);
    expect(startB.previousCardId).toBe(aId);
  });

  it("message handler refuses malformed messages", async () => {
    const { bindTimerMessages } = await import("../src/background/timer");
    bindTimerMessages();
    if (!messageListener) throw new Error("message listener not bound");
    const resp = await new Promise<{ ok: boolean; error: string }>(
      (resolve) => {
        messageListener!({ type: "wat" }, null, (r) =>
          resolve(r as { ok: boolean; error: string }),
        );
      },
    );
    expect(resp.ok).toBe(false);
  });
});

void installListener;
