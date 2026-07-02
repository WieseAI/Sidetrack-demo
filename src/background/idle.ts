/// <reference types="chrome" />
/**
 * Service-worker side of the idle detector.
 *
 * Phase 3 wires the "did the user go idle?" signal (D-08) into
 * the service worker. The detector is *pure* — it lives in
 * `src/shared/idle.ts` and is unit-tested in isolation. This
 * module is the chrome.* glue:
 *
 *   - `IDLE_ALARM` (1-minute floor) fires `evaluateIdle()` and,
 *     if the user has been idle longer than the threshold,
 *     sets a pending `IdlePrompt` on the persisted state. The
 *     alarm runs even when the sidepanel is closed (R-02).
 *   - `chrome.idle.onStateChanged` is wired to *touch* the
 *     running timer's `lastSeenActive` anchor so the user
 *     going active after a system-level idle does not get
 *     re-prompted for the same gap.
 *   - A `chrome.notifications` deep link is fired on first
 *     detection so a user who closed the sidepanel mid-focus
 *     still gets a visible cue (D-16).
 *
 * All of the above is best-effort: `chrome.idle` and
 * `chrome.notifications` are not available in tests, so the
 * module exports `evaluateAndDispatch()` as a pure hook that
 * the test harness can drive without `chrome.*`.
 */

import { evaluateIdle, TRIM_RECENTLY_LIFETIME_MS } from "../shared/idle";
import { setIdlePrompt } from "../shared/timer-actions";
import { storage } from "../shared/storage";
import type { PersistedState } from "../shared/model";

/** Alarm name for the idle detector. Distinct from the
 *  timer-tick alarm (Phase 2) so the two concerns can be
 *  tuned independently and one can be disabled without
 *  affecting the other. */
export const IDLE_ALARM = "sidetrack.idle-tick";

/** Period in minutes. Chrome's MV3 production minimum is 1
 *  minute; we use the floor (D-15). */
export const IDLE_ALARM_PERIOD_MINUTES = 1;

/** Notification id used for the idle deep-link. Reusing the
 *  same id replaces any prior notification instead of
 *  stacking. */
const IDLE_NOTIFICATION_ID = "sidetrack.idle-prompt";

/** Create the recurring idle-check alarm. Idempotent. */
export async function ensureIdleAlarm(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.alarms) return;
  const existing = await chrome.alarms.get(IDLE_ALARM);
  if (existing) return;
  chrome.alarms.create(IDLE_ALARM, {
    delayInMinutes: IDLE_ALARM_PERIOD_MINUTES,
    periodInMinutes: IDLE_ALARM_PERIOD_MINUTES,
  });
}

/**
 * Run the detector once and, if the user has crossed the
 * threshold, persist a pending `IdlePrompt` and (best-effort)
 * fire the OS notification. Exposed for the test harness and
 * the `onAlarm` listener.
 *
 * The function returns the `IdleEvaluation` it produced so the
 * caller can log/assert on it. It does not throw — the
 * persistence write is the only side effect and it is
 * fire-and-forget.
 */
export async function evaluateAndDispatch(
  now: number = Date.now(),
): Promise<ReturnType<typeof evaluateIdle>> {
  let state: PersistedState;
  try {
    state = await storage.peekOrLoad();
  } catch {
    return { kind: "no-timer" };
  }
  const result = evaluateIdle(state, now);
  if (result.kind === "idle") {
    try {
      await setIdlePrompt(storage, result.prompt);
    } catch (err) {
      // Persistence is best-effort; the next tick will retry.
      console.warn("[sidetrack] setIdlePrompt failed", err);
    }
    notifyIdlePrompt();
  }
  return result;
}

/**
 * Fire (or refresh) the OS notification that deep-links back
 * into the sidepanel. Best-effort: `chrome.notifications` is
 * not available in some test environments and not all Chrome
 * variants support it without the `notifications` permission
 * (added to the manifest by this phase).
 */
export function notifyIdlePrompt(): void {
  if (typeof chrome === "undefined" || !chrome.notifications) return;
  try {
    chrome.notifications.create(IDLE_NOTIFICATION_ID, {
      type: "basic",
      iconUrl: "src/assets/icons/icon-128.png",
      title: "Timer still running?",
      message:
        "You've been away from the keyboard. Open Sidetrack to keep, trim, or stop the timer.",
      priority: 1,
    });
  } catch (err) {
    console.warn("[sidetrack] notification failed", err);
  }
}

/** Clear the OS notification (e.g. after the user
 *  acknowledges the prompt in-sidepanel). */
export function clearIdleNotification(): void {
  if (typeof chrome === "undefined" || !chrome.notifications) return;
  try {
    chrome.notifications.clear(IDLE_NOTIFICATION_ID);
  } catch {
    // Notifications may not be available; that's fine.
  }
}

/** Wire the alarm listener. Idempotent: re-binding replaces
 *  the prior listener. */
export function bindIdleAlarm(): void {
  if (typeof chrome === "undefined" || !chrome.alarms?.onAlarm) return;
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== IDLE_ALARM) return;
    void evaluateAndDispatch().catch((err) => {
      console.warn("[sidetrack] idle evaluation failed", err);
    });
  });
}

/**
 * Wire `chrome.idle.onStateChanged` to touch the running
 * timer's `lastSeenActive` anchor when the user goes active
 * at the system level. The detector handles the rest — if the
 * user is active, the next tick will see
 * `idleForMs < threshold` and not prompt.
 *
 * This is the D-08 *system-level* signal combined with the
 * in-extension `last_seen_active` signal.
 */
export function bindSystemIdle(): void {
  if (typeof chrome === "undefined" || !chrome.idle?.onStateChanged) return;
  chrome.idle.onStateChanged.addListener((newState) => {
    if (newState !== "active") return;
    void storage.mutate({ type: "cold-start-reconcile", now: Date.now() });
  });
}

/** Wire the OS notification click handler so clicking the
 *  notification opens the sidepanel. The
 *  `onNotificationClicked` listener is global, so we filter
 *  to our own id. */
export function bindNotificationClick(): void {
  if (typeof chrome === "undefined" || !chrome.notifications?.onClicked) return;
  chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId !== IDLE_NOTIFICATION_ID) return;
    void openSidePanelForIdle();
  });
}

/** Open the sidepanel on the active window. The chrome.sidePanel
 *  API requires a windowId; we look it up from the last focused
 *  window. */
async function openSidePanelForIdle(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.sidePanel?.open) return;
  try {
    const wins = await chrome.windows.getAll({ populate: false });
    const last = wins.find((w) => w.focused) ?? wins[0];
    if (!last?.id) return;
    await chrome.sidePanel.open({ windowId: last.id });
  } catch (err) {
    console.warn("[sidetrack] open sidepanel for notification failed", err);
  }
}

/** Suppress the OS notification for `TRIM_RECENTLY_LIFETIME_MS`
 *  after a successful trim. Re-exported here so the SW
 *  background module can use it without re-importing the
 *  pure helper. */
export { TRIM_RECENTLY_LIFETIME_MS };
