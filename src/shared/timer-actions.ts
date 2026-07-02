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

import type { CardId } from "./model.js";
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
