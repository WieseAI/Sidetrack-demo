/**
 * Timer service — shared between the service worker and the
 * sidepanel.
 *
 * The timer itself is *data* (a `RunningTimer` block in the
 * persisted state). What the service worker adds is the
 * `chrome.alarms` tick that re-anchors the anchor after a
 * service-worker kill (D-15). The sidepanel adds the live
 * 1-second UI tick. Neither owns a separate timer; both
 * re-render from the persisted `startedAt`.
 *
 * This module is *pure*: it never touches `chrome.*`. The
 * `chrome.alarms` glue lives in `src/background/timer.ts`,
 * which calls into the same code path the sidepanel uses.
 *
 * The single-active-timer rule (brief AC #4) is enforced by
 * the reducer; this module's job is to (a) translate user
 * intent into the right reducer action and (b) reconcile
 * state on cold start.
 */

import type {
  Card,
  CardId,
  EntryId,
  PersistedState,
  RunningTimer,
  TimeEntry,
} from "./model.js";

/** Alarm name used to re-anchor the running timer's lastSeenActive.
 *  Matches the 1-minute floor in the Phase 0 timer-survival test
 *  scenario (D-15). */
export const TIMER_ALARM = "sidetrack.timer-tick";

/** Period (in minutes) of the timer-re-anchor alarm. Chrome's
 *  minimum is 1 minute. We use the floor; tightening the alarm
 *  to 0.5 minutes in a future phase requires a different API
 *  (offscreen document). */
export const TIMER_ALARM_PERIOD_MINUTES = 1;

/** Compute the elapsed time of a running timer as of `now`.
 *  Returns 0 if no timer is running. Pure: caller passes `now`. */
export function elapsedMs(running: RunningTimer | undefined, now: number): number {
  if (!running) return 0;
  const e = now - running.startedAt;
  return e > 0 ? e : 0;
}

/** Compute the total time tracked on a card, including the
 *  contribution of any open entry tied to the running timer.
 *  Pure. */
export function totalWithRunning(
  card: Card,
  running: RunningTimer | undefined,
  now: number,
): number {
  let total = 0;
  for (const e of card.entries) {
    if (e.endAt !== null && e.endAt > e.startAt) {
      total += e.endAt - e.startAt;
    }
  }
  if (running && running.cardId === card.id) {
    const open = card.entries.find((e) => e.endAt === null);
    if (open) {
      const live = now - open.startAt;
      if (live > 0) total += live;
    }
  }
  return total;
}

/** Find the open entry on a card, if any. */
export function openEntry(card: Card): TimeEntry | undefined {
  return card.entries.find((e) => e.endAt === null);
}

/** Find the card that owns the running timer, if any. */
export function cardForRunning(
  state: PersistedState,
): { card: Card; timer: RunningTimer; openEntry: TimeEntry } | null {
  const rt = state.runningTimer;
  if (!rt) return null;
  const card = state.cards.find((c) => c.id === rt.cardId);
  if (!card) return null;
  const oe = openEntry(card);
  if (!oe) return null;
  return { card, timer: rt, openEntry: oe };
}

/** True if the given card is the one currently being timed. */
export function isRunningOn(state: PersistedState, cardId: CardId): boolean {
  return state.runningTimer?.cardId === cardId;
}

/** True if a timer is currently running. */
export function hasRunning(state: PersistedState): boolean {
  return state.runningTimer !== undefined;
}

/** Card title for the running timer's card, or null. The
 *  sidepanel surfaces this in the always-visible running-timer
 *  bar; the service worker does not. */
export function runningCardTitle(state: PersistedState): string | null {
  if (!state.runningTimer) return null;
  const card = state.cards.find((c) => c.id === state.runningTimer!.cardId);
  return card ? card.title : null;
}

/** The board name + column name for the running timer's card.
 *  Returns null if the card has been deleted. */
export function runningLocation(
  state: PersistedState,
): { boardName: string; columnName: string } | null {
  if (!state.runningTimer) return null;
  const cardId = state.runningTimer.cardId;
  const column = state.columns.find((c) => c.cardIds.includes(cardId));
  if (!column) return null;
  const board = state.boards.find((b) => b.columnIds.includes(column.id));
  if (!board) return null;
  return { boardName: board.name, columnName: column.name };
}

/** Lookup a card by id, typed. */
export function findCard(state: PersistedState, cardId: CardId): Card | undefined {
  return state.cards.find((c) => c.id === cardId);
}

/** Lookup an entry by id on a given card. */
export function findEntry(card: Card, entryId: EntryId): TimeEntry | undefined {
  return card.entries.find((e) => e.id === entryId);
}
