/**
 * Sidepanel-facing timer actions.
 *
 * The sidepanel never talks to `chrome.storage` directly; it goes
 * through the `useStorageHandle()` hook (D-06). This module wraps
 * the imperative timer actions in `src/shared/timer-actions.ts`
 * so a component can call `await timer.start(cardId)` without
 * importing the storage layer.
 *
 * When the timer is started on a different card while another is
 * already running, the reducer closes the previous one. We surface
 * the previous card's id back to the caller so the UI can show a
 * "Timer stopped on X" toast (brief AC #4).
 */

import { useCallback } from "preact/hooks";
import type { CardId } from "../../shared/model";
import { startTimer, stopTimer } from "../../shared/timer-actions";
import { useStorageHandle } from "./storage";

export interface TimerActions {
  /** Start a timer on `cardId`. Returns the previous card's id
   *  (if a different card had a running timer) so the UI can
   *  toast a "stopped on X" message. */
  start: (cardId: CardId) => Promise<{ previousCardId: CardId | null }>;
  /** Stop the running timer, if any. */
  stop: () => Promise<{ stoppedCardId: CardId | null }>;
}

export function useTimerActions(): TimerActions {
  const storage = useStorageHandle();
  return {
    start: useCallback(
      (cardId: CardId) => startTimer(storage, cardId),
      [storage],
    ),
    stop: useCallback(() => stopTimer(storage), [storage]),
  };
}
