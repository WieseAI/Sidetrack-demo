/// <reference types="chrome" />
/**
 * MV3 service worker.
 *
 * Responsibilities:
 *   - Open the side panel when the user clicks the toolbar action
 *     (Phase 0, D-02).
 *   - Log the (D-17) `chrome.commands` chords; the actions they
 *     trigger are dispatched in Phase 5 (R-11).
 *   - Own the timer-reconciliation alarm (Phase 2, D-15) and the
 *     message channel the sidepanel uses to start / stop the timer
 *     without touching `chrome.storage` directly (D-06).
 *
 * The service worker is MV3 (D-01): it is started on events, runs
 * to idle, and can be killed at any time. All state that must
 * survive a kill lives in `chrome.storage` (D-05), not in module
 * memory. The running-timer invariant is owned by the reducer in
 * `src/shared/reducer.ts`; the SW here is just the alarm + the
 * message bus.
 */

import {
  bindTimerAlarm,
  bindTimerMessages,
  ensureTimerAlarm,
  reconcileOnStartup,
} from "./timer";
import {
  bindIdleAlarm,
  bindNotificationClick,
  bindSystemIdle,
  clearIdleNotification,
  ensureIdleAlarm,
} from "./idle";
import { bindContextMenuClicks, ensureContextMenus } from "./capture";

const SIDEPANEL_TOGGLE_BEHAVIOR = {
  // Open, don't toggle, on the active tab. We do not call setOptions
  // (which would change the global default) because that would lock
  // the behavior across all tabs; per-call openPath keeps the user
  // on the tab they clicked from.
  openPanelOnActionClick: true,
} as const;

chrome.action.onClicked.addListener(async (tab) => {
  if (!SIDEPANEL_TOGGLE_BEHAVIOR.openPanelOnActionClick) return;
  // `tab.windowId` is the window the user clicked in. Opening the
  // sidepanel on that window keeps the panel associated with the
  // window the user is looking at, even if they switch tabs.
  const windowId = tab.windowId;
  if (typeof windowId !== "number") return;
  try {
    await chrome.sidePanel.open({ windowId, tabId: tab.id });
  } catch (err) {
    // The sidepanel API throws if called from a context that cannot
    // host a panel (e.g. chrome:// pages). We swallow the error
    // intentionally; the toolbar action will simply do nothing in
    // that case. The user can still open the panel from the
    // extension menu.
    console.warn("[sidetrack] could not open sidepanel", err);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.info("[sidetrack] installed");
  void reconcileOnStartup();
  // Phase 4: register the right-click "Add to Sidetrack"
  // context menu items (D-07). The installer is the
  // natural time to do this so the menu is available
  // before the user opens the sidepanel.
  void ensureContextMenus();
});

chrome.runtime.onStartup?.addListener(() => {
  void reconcileOnStartup();
});

// Phase 2 wiring: timer alarm + sidepanel message bus.
ensureTimerAlarm();
bindTimerAlarm();
bindTimerMessages();

// Phase 3 wiring: idle alarm + system-idle + notification deep link.
ensureIdleAlarm();
bindIdleAlarm();
bindSystemIdle();
bindNotificationClick();

// Phase 4 wiring: right-click "Add to Sidetrack" context
// menu (D-07). The click handler is bound at module load
// so the menu is live as soon as the SW starts; the menu
// items themselves are created in `onInstalled` (above).
bindContextMenuClicks();

// Sidepanel can ask us to clear the OS notification once
// the user has acknowledged the prompt in-sidepanel. The
// sidepanel pings us via chrome.runtime.sendMessage on
// dialog open and on each Keep/Trim/Stop click.
chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  const m = message as { type?: string } | null;
  if (m && m.type === "clear-idle-notification") {
    clearIdleNotification();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

chrome.commands?.onCommand.addListener((command) => {
  // The commands are declared in manifest.config.js (D-17) and
  // become available on chrome://extensions/shortcuts. Phase 5
  // forwards the chord to the sidepanel via a runtime message
  // so the sidepanel can dispatch the action (focus the
  // quick-add input, start/stop the focused card's timer, or
  // open the sidepanel). The message is fire-and-forget; the
  // sidepanel may not be open, in which case the SW opens it
  // for the "open-sidepanel" command and drops the others.
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    return;
  }
  if (command === "open-sidepanel") {
    // The user is asking to open the sidepanel. The toolbar
    // action already does this; we just open on the focused
    // window for parity with the keyboard chord.
    void (async () => {
      try {
        const wins = await chrome.windows.getAll({ populate: false });
        const last = wins.find((w) => w.focused) ?? wins[0];
        if (last?.id) await chrome.sidePanel.open({ windowId: last.id });
      } catch (err) {
        console.warn("[sidetrack] open sidepanel via command failed", err);
      }
    })();
    return;
  }
  try {
    chrome.runtime.sendMessage({ type: "command", command });
  } catch {
    // The sidepanel may not be open; that's fine for chords
    // that only matter inside the panel.
  }
});

export {}; // ensure this is treated as a module by the bundler
