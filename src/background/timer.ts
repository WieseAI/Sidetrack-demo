/// <reference types="chrome" />
/**
 * Service-worker side of the timer.
 *
 * The reducer (in `src/shared/reducer.ts`) owns the running-timer
 * invariant; the only thing the service worker adds is the
 * `chrome.alarms` tick that re-anchors the timer's `lastSeenActive`
 * after a kill (D-15) and a `chrome.runtime.onMessage` handler
 * that lets the sidepanel start/stop the timer without holding
 * a direct reference to the storage handle.
 *
 * The alarm handler is idempotent: re-running it just refreshes
 * the anchor. It must be safe to call from a cold start (before
 * the storage cache is populated) — we load state, reconcile,
 * and write.
 */

import { TIMER_ALARM, TIMER_ALARM_PERIOD_MINUTES } from "../shared/timer";
import { reconcileOnColdStart, startTimer, stopTimer } from "../shared/timer-actions";
import { storage } from "../shared/storage";
import type { CardId, PersistedState } from "../shared/model";
import { applyAction } from "../shared/reducer";

/** Create the recurring alarm (1-minute floor) on cold start. */
export async function ensureTimerAlarm(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.alarms) return;
  const existing = await chrome.alarms.get(TIMER_ALARM);
  if (existing) return;
  chrome.alarms.create(TIMER_ALARM, {
    delayInMinutes: TIMER_ALARM_PERIOD_MINUTES,
    periodInMinutes: TIMER_ALARM_PERIOD_MINUTES,
  });
}

/** Cold-start reconciliation entrypoint. Called from the
 *  service worker's `onInstalled` and `onStartup` listeners. */
export async function reconcileOnStartup(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  // Make sure the cache is populated so reconcileOnColdStart
  // sees the running timer.
  await storage.loadState();
  await ensureTimerAlarm();
  await reconcileOnColdStart(storage);
}

/** Wire the alarm listener. The handler re-anchors the
 *  `lastSeenActive` of the running timer. It is idempotent. */
export function bindTimerAlarm(): void {
  if (typeof chrome === "undefined" || !chrome.alarms?.onAlarm) return;
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== TIMER_ALARM) return;
    void reconcileOnColdStart(storage).catch((err) => {
      console.warn("[sidetrack] reconcile failed", err);
    });
  });
}

/** Wire the runtime message handler. The sidepanel sends
 *  `{ type: "start-timer", cardId }` / `{ type: "stop-timer" }`
 *  to delegate the write to the service worker (which is the
 *  authoritative writer of the running block; D-06). */
export function bindTimerMessages(): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse: (resp: unknown) => void) => {
      void handleTimerMessage(message)
        .then(sendResponse)
        .catch((err) => {
          console.warn("[sidetrack] timer message failed", err);
          sendResponse({ ok: false, error: (err as Error).message });
        });
      return true; // keep the channel open for async sendResponse
    },
  );
}

interface TimerResponseOk {
  ok: true;
  /** Card id the previous timer was on, when starting a new one
   *  caused an auto-stop. The sidepanel uses this to render a
   *  "stopped on X" toast (brief AC #4). */
  previousCardId?: CardId;
}
interface TimerResponseErr {
  ok: false;
  error: string;
}

async function handleTimerMessage(
  message: unknown,
): Promise<TimerResponseOk | TimerResponseErr> {
  if (!message || typeof message !== "object") {
    return { ok: false, error: "malformed message" };
  }
  const m = message as { type?: unknown; cardId?: unknown };
  if (m.type === "start-timer") {
    if (typeof m.cardId !== "string") {
      return { ok: false, error: "start-timer: cardId is required" };
    }
    const result = await startTimer(storage, m.cardId as CardId);
    return { ok: true, previousCardId: result.previousCardId ?? undefined };
  }
  if (m.type === "stop-timer") {
    await stopTimer(storage);
    return { ok: true };
  }
  if (m.type === "reconcile") {
    await reconcileOnColdStart(storage);
    return { ok: true };
  }
  return { ok: false, error: `unknown message: ${String(m.type)}` };
}

/** One-shot helper used by `bindTimerMessages` and the test
 *  harness: apply a single reducer action to the current state
 *  without going through `mutate` (for the test scenarios that
 *  want to drive the reducer directly). Exposed here so the
 *  test harness can reuse it. */
export function reduce(state: PersistedState, action: unknown): PersistedState {
  return applyAction(state, action as Parameters<typeof applyAction>[1]);
}
