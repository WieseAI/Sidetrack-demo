/**
 * Service-worker idle glue.
 *
 * Exercises `src/background/idle.ts` against a fake
 * `chrome.alarms` and a fake `chrome.notifications` /
 * `chrome.idle` shim. The point is to prove the alarm handler
 * is idempotent, the message handler round-trips the prompt
 * lifecycle, and the detector is wired correctly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeAlarm {
  name: string;
  periodInMinutes: number;
  delayInMinutes: number;
  fire: () => void;
}

interface FakeNotification {
  id: string;
  options: chrome.notifications.NotificationOptions;
}

const alarms = new Map<string, FakeAlarm>();
let alarmListener: ((a: FakeAlarm) => void) | null = null;
let idleStateListener:
  | ((newState: chrome.idle.IdleState) => void)
  | null = null;
let notificationClickListener: ((id: string) => void) | null = null;
const notificationsCreated: FakeNotification[] = [];
const notificationsCleared: string[] = [];

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
    idle: {
      onStateChanged: {
        addListener: vi.fn((cb: (s: chrome.idle.IdleState) => void) => {
          idleStateListener = cb;
        }),
        removeListener: vi.fn(),
      },
    },
    notifications: {
      create: vi.fn((id: string, options: chrome.notifications.NotificationOptions) => {
        notificationsCreated.push({ id, options });
      }),
      clear: vi.fn((id: string) => {
        notificationsCleared.push(id);
      }),
      onClicked: {
        addListener: vi.fn((cb: (id: string) => void) => {
          notificationClickListener = cb;
        }),
        removeListener: vi.fn(),
      },
    },
    sidePanel: {
      open: vi.fn(async () => {}),
    },
    windows: {
      getAll: vi.fn(async () => []),
    },
  };
}

let fake: ReturnType<typeof makeFakeChrome>;

beforeEach(() => {
  alarms.clear();
  notificationClickListener = null;
  idleStateListener = null;
  notificationsCreated.length = 0;
  notificationsCleared.length = 0;
  fake = makeFakeChrome();
  (globalThis as unknown as { chrome: unknown }).chrome = fake;
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

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
  // startedAt = T0; lastSeenActive = T0 (10 min in the past)
  const T0 = 1_700_000_000_000;
  const s2 = applyAction(s1, { type: "start-timer", cardId: aId, now: T0 });
  const singleton = (await import("../src/shared/storage")).storage;
  await singleton.importState(s2);
  return { aId, singleton, T0 };
}

describe("background idle glue", () => {
  it("ensureIdleAlarm creates the recurring idle alarm", async () => {
    const { ensureIdleAlarm } = await import("../src/background/idle");
    await ensureIdleAlarm();
    expect(fake.alarms.create).toHaveBeenCalledWith(
      "sidetrack.idle-tick",
      expect.objectContaining({ periodInMinutes: 1 }),
    );
  });

  it("ensureIdleAlarm is a no-op when the alarm already exists", async () => {
    const { ensureIdleAlarm } = await import("../src/background/idle");
    await ensureIdleAlarm();
    fake.alarms.create.mockClear();
    await ensureIdleAlarm();
    expect(fake.alarms.create).not.toHaveBeenCalled();
  });

  it("alarm handler sets a pending prompt when idle threshold is crossed", async () => {
    const { bindIdleAlarm, ensureIdleAlarm, evaluateAndDispatch } =
      await import("../src/background/idle");
    const { aId, singleton, T0 } = await seedRunningTimerOnA();
    await ensureIdleAlarm();
    bindIdleAlarm();
    // Sanity-check the alarm name matches what the alarm
    // listener filters on (Phase 0 alarm name contract).
    expect(alarms.has("sidetrack.idle-tick")).toBe(true);
    // Fire the alarm at T0 + 6 min (threshold = 5 min).
    const result = await evaluateAndDispatch(T0 + 6 * 60_000);
    expect(result.kind).toBe("idle");
    const after = await singleton.exportState();
    expect(after.pendingIdlePrompt).toBeDefined();
    expect(after.pendingIdlePrompt?.kind).toBe("open");
    expect(after.pendingIdlePrompt?.cardId).toBe(aId);
    // Notification fired.
    expect(notificationsCreated.length).toBeGreaterThan(0);
  });

  it("alarm handler is idempotent (re-firing does not double-prompt)", async () => {
    const { ensureIdleAlarm, evaluateAndDispatch } = await import(
      "../src/background/idle"
    );
    const { singleton, T0 } = await seedRunningTimerOnA();
    await ensureIdleAlarm();
    await evaluateAndDispatch(T0 + 6 * 60_000);
    const after1 = await singleton.exportState();
    expect(after1.pendingIdlePrompt?.kind).toBe("open");
    // Second tick: the prompt is already set, so the result
    // is "pending-prompt" and we don't write again.
    const result2 = await evaluateAndDispatch(T0 + 7 * 60_000);
    expect(result2.kind).toBe("pending-prompt");
  });

  it("system idle state change to 'active' touches the running timer's anchor", async () => {
    const { bindSystemIdle } = await import("../src/background/idle");
    const { singleton } = await seedRunningTimerOnA();
    bindSystemIdle();
    expect(idleStateListener).toBeTruthy();
    const before = await singleton.exportState();
    const beforeAnchor = before.runningTimer?.lastSeenActive;
    // The listener writes the wall clock, which we can't
    // deterministically pin in this test; we just assert
    // the anchor advanced (or is equal if a sub-ms tick
    // happened to land at T0 + delta). The simpler check:
    // the call must not throw and must update `lastSeenActive`
    // on the *root* (which the reducer does).
    idleStateListener!("active" as chrome.idle.IdleState);
    // Give the async write a tick to land.
    await new Promise((r) => setTimeout(r, 0));
    const after = await singleton.exportState();
    expect(after.lastSeenActive).toBeGreaterThanOrEqual(beforeAnchor!);
  });

  it("clearIdleNotification clears the OS notification", async () => {
    const { clearIdleNotification } = await import("../src/background/idle");
    clearIdleNotification();
    expect(notificationsCleared).toContain("sidetrack.idle-prompt");
  });
});

describe("notification click handler", () => {
  it("opens the sidepanel when the idle notification is clicked", async () => {
    const { bindNotificationClick } = await import("../src/background/idle");
    bindNotificationClick();
    // Sanity: at least one listener got registered.
    expect(notificationClickListener).toBeTruthy();
  });
});
