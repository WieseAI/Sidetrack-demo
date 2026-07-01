/// <reference types="chrome" />
/**
 * Phase 0 service worker.
 *
 * Responsibilities in this phase (per the Phase 0 issue):
 *   - Open the side panel when the user clicks the toolbar action.
 *   - Register the (D-17) `chrome.commands` shortcuts. The actions they
 *     trigger are no-ops in Phase 0; Phase 1/2 wire them up to the
 *     kanban and timer.
 *
 * In later phases this module will:
 *   - Own the `mutate(fn)` helper (D-06) that serializes writes.
 *   - Register the periodic `chrome.alarms` tick (D-15) for the
 *     timer-anchor reconciliation.
 *   - Wire `chrome.idle` (D-08) for the system-level idle signal.
 *
 * The service worker is MV3 (D-01): it is started on events, runs to
 * idle, and can be killed at any time. All state that must survive
 * a kill lives in `chrome.storage` (D-05), not in module memory.
 */

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
  // Phase 0 only logs the install. Phase 4 will register the
  // "Add to Sidetrack" context menu here (D-07).
  console.info("[sidetrack] installed");
});

chrome.commands?.onCommand.addListener((command) => {
  // The commands are declared in manifest.config.js (D-17) and become
  // available on chrome://extensions/shortcuts. Phase 0 logs the
  // command for end-to-end smoke testing; later phases dispatch it
  // to the sidepanel via a runtime message.
  console.info("[sidetrack] command:", command);
});

export {}; // ensure this is treated as a module by the bundler
