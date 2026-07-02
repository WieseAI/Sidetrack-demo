/**
 * Idle detection — pure helpers shared between the service
 * worker and the sidepanel.
 *
 * The brief (D-08, R-02, R-03) calls for a "did the user go
 * idle while a timer was running?" signal and for handling a
 * long gap after the browser was closed. This module is the
 * detection side: given the persisted state and a wall clock,
 * it returns the action the caller should take.
 *
 * It is intentionally *pure*: no `chrome.*`, no `Date.now()`,
 * no side effects. The service worker calls it from the idle
 * alarm tick and the cold-start reconciler; the sidepanel
 * calls it from the cold-start handler. Tests use it
 * directly.
 *
 * The threshold is read from `state.settings.idleThresholdSeconds`
 * so the user can configure it without a code change.
 */

import type {
  CardId,
  EntryId,
  IdlePrompt,
  PersistedState,
  TimeEntry,
} from "./model.js";

/** How long a "trimmed-recently" marker stays alive. The
 *  service worker sets this after a successful trim (or stop)
 *  so the next alarm tick within the same idle gap does not
 *  re-prompt. 30 seconds is short enough to re-prompt if the
 *  user walks away again, long enough that a noisy alarm
 *  cadence does not surface a duplicate prompt. */
export const TRIM_RECENTLY_LIFETIME_MS = 30_000;

/**
 * The result of evaluating idle state.
 *
 * - `no-timer`: no timer is running, no prompt needed.
 * - `not-idle`: a timer is running, but the user is within
 *   the threshold. Refresh the anchor and move on.
 * - `idle`: the timer is running and the user has been idle
 *   for at least the threshold; the caller should set a
 *   pending `IdlePrompt` of kind `"open"`. The `prompt`
 *   field is shaped for the reducer.
 * - `trimmed-recently`: the timer was just trimmed or stopped
 *   via the prompt; suppress duplicate prompts for a short
 *   window.
 * - `pending-prompt`: a prompt is already pending (the reducer
 *   has set it); the caller should not create a second one.
 *   This is a defensive check — in practice the alarm tick
 *   that produces this state already created the prompt.
 */
export type IdleEvaluation =
  | { kind: "no-timer" }
  | { kind: "not-idle" }
  | { kind: "pending-prompt" }
  | { kind: "trimmed-recently" }
  | { kind: "idle"; prompt: IdlePrompt };

/** Find the open `TimeEntry` on a card, if any. The running
 *  entry is the one with `endAt === null`. */
function findOpenEntry(
  state: PersistedState,
  cardId: CardId,
): TimeEntry | undefined {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card) return undefined;
  return card.entries.find((e) => e.endAt === null);
}

/**
 * Evaluate whether the user has been idle long enough that we
 * should surface the idle prompt.
 *
 * @param state     The current persisted state.
 * @param now       Wall-clock ms. Caller is responsible for
 *                  passing a measured value (not `Date.now()`)
 *                  so the function stays pure and tests can
 *                  drive it deterministically.
 * @param thresholdSeconds  Override the configured threshold;
 *                  the alarm tick and the cold-start path
 *                  pass the same `state.settings.idleThresholdSeconds`
 *                  value, but the parameter is exposed for
 *                  tests.
 */
export function evaluateIdle(
  state: PersistedState,
  now: number,
  thresholdSeconds?: number,
): IdleEvaluation {
  const rt = state.runningTimer;
  if (!rt) return { kind: "no-timer" };
  if (state.pendingIdlePrompt?.kind === "open") {
    return { kind: "pending-prompt" };
  }
  if (state.pendingIdlePrompt?.kind === "trimmed-recently") {
    return { kind: "trimmed-recently" };
  }
  const threshold =
    (thresholdSeconds ?? state.settings.idleThresholdSeconds) * 1000;
  const idleForMs = now - rt.lastSeenActive;
  if (idleForMs < threshold) {
    return { kind: "not-idle" };
  }
  const openEntry = findOpenEntry(state, rt.cardId);
  if (!openEntry) {
    // The running timer is dangling (the open entry was
    // deleted out from under it). The reconciler should have
    // cleared it; from the idle detector's perspective there
    // is nothing to prompt about.
    return { kind: "no-timer" };
  }
  const prompt: IdlePrompt = {
    cardId: rt.cardId,
    entryId: openEntry.id,
    detectedAt: now,
    lastSeenActive: rt.lastSeenActive,
    idleForMs,
    kind: "open",
  };
  return { kind: "idle", prompt };
}

/**
 * Mark a prompt as "trimmed recently" so a follow-up alarm
 * tick within `TRIM_RECENTLY_LIFETIME_MS` does not re-prompt
 * the user. The reducer persists this; the next tick reads it
 * and short-circuits.
 */
export function makeTrimmedRecentlyPrompt(
  cardId: CardId,
  entryId: EntryId,
  now: number,
): IdlePrompt {
  return {
    cardId,
    entryId,
    detectedAt: now,
    lastSeenActive: now,
    idleForMs: 0,
    kind: "trimmed-recently",
  };
}

/**
 * The "is a pending prompt still relevant?" check used by the
 * sidepanel on cold start. A prompt whose `entryId` no longer
 * matches the open entry on its card is stale and can be
 * cleared without UI. The reducer's `set-idle-prompt` action
 * is the right tool to clear it.
 */
export function isPromptStale(
  state: PersistedState,
  prompt: IdlePrompt,
): boolean {
  if (!state.runningTimer) return true;
  if (state.runningTimer.cardId !== prompt.cardId) return true;
  const card = state.cards.find((c) => c.id === prompt.cardId);
  if (!card) return true;
  const open = card.entries.find((e) => e.endAt === null);
  if (!open) return true;
  return open.id !== prompt.entryId;
}
