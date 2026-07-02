/**
 * Thin imperative wrapper over the timer reducer actions.
 *
 * The reducer is the only writer of the running-timer block, so
 * callers (sidepanel buttons, service-worker alarm handler) go
 * through this module to translate intent into the right action.
 *
 * `startTimer(cardId)` and `stopTimer()` always go through the
 * storage handle so the sidepanel and service worker share the
 * same serialized write path.
 */

import type { CardId, IdlePrompt } from "./model.js";
import type { StorageHandle } from "./storage.js";

/** Start a timer on `cardId`. If another timer is already
 *  running, the reducer closes it first (single-active-timer
 *  rule, brief AC #4). Returns the previous card id (if any)
 *  so the caller can surface a "stopped on X" toast. */
export async function startTimer(
  storage: StorageHandle,
  cardId: CardId,
  now: number = Date.now(),
): Promise<{ previousCardId: CardId | null }> {
  const before = await storage.peekOrLoad();
  const previousCardId =
    before.runningTimer && before.runningTimer.cardId !== cardId
      ? before.runningTimer.cardId
      : null;
  await storage.mutate({ type: "start-timer", cardId, now });
  return { previousCardId };
}

/** Stop the running timer, if any. */
export async function stopTimer(
  storage: StorageHandle,
  now: number = Date.now(),
): Promise<{ stoppedCardId: CardId | null }> {
  const before = await storage.peekOrLoad();
  const stoppedCardId = before.runningTimer?.cardId ?? null;
  await storage.mutate({ type: "stop-timer", now });
  return { stoppedCardId };
}

/** Reconcile on cold start (refreshes `lastSeenActive`). */
export async function reconcileOnColdStart(
  storage: StorageHandle,
  now: number = Date.now(),
): Promise<void> {
  await storage.mutate({ type: "cold-start-reconcile", now });
}

/**
 * Trim the running timer back to `trimTo`. Closes the
 * current open `TimeEntry` at `trimTo` (with
 * `source: "idle-trim"`) and opens a new `TimeEntry` at
 * `trimTo` so the running entry continues seamlessly. The
 * running block's `startedAt` anchor is advanced to
 * `trimTo`. The reducer clears `pendingIdlePrompt` as
 * part of the same write.
 *
 * Use this from the idle prompt's "Trim" button (brief AC #5)
 * and from the cold-start gap handler.
 */
export async function trimTimer(
  storage: StorageHandle,
  trimTo: number,
  now: number = Date.now(),
): Promise<void> {
  await storage.mutate({ type: "trim-timer", trimTo, now });
}

/**
 * Trim the running timer back to `trimTo` and stop it. The
 * "Stop (and trim)" choice from the idle prompt. Closes the
 * open entry at `trimTo` with `source: "idle-trim"` and
 * clears the running block; no new entry is opened.
 */
export async function trimTimerAndStop(
  storage: StorageHandle,
  trimTo: number,
  now: number = Date.now(),
): Promise<void> {
  await storage.mutate({ type: "trim-timer-and-stop", trimTo, now });
}

/**
 * Persist a pending idle prompt. The service worker calls
 * this when the alarm tick crosses the threshold (D-08);
 * the sidepanel calls it on cold start when it sees a gap
 * larger than the threshold (R-03). The reducer is the only
 * writer of `pendingIdlePrompt`.
 */
export async function setIdlePrompt(
  storage: StorageHandle,
  prompt: IdlePrompt | undefined,
): Promise<void> {
  await storage.mutate({ type: "set-idle-prompt", prompt });
}

/**
 * Clear any pending idle prompt without affecting the timer.
 * Used by the "Keep all" path and by Esc-to-dismiss.
 */
export async function dismissIdlePrompt(
  storage: StorageHandle,
): Promise<void> {
  await storage.mutate({ type: "dismiss-idle-prompt" });
}
