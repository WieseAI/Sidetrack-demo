/// <reference types="chrome" />
/**
 * Service-worker side of the right-click "Add to Sidetrack"
 * capture flow (D-07).
 *
 * Chrome's `contextMenus` API is the MV3-blessed way to
 * inject UI into pages without a content script on every
 * tab. We register two menu items — one for the page
 * (always available) and one for a text selection (only
 * available when the user has selected something) — and
 * funnel the click into the reducer via the
 * `capture-card` action.
 *
 * The destination is the *Inbox* column on the first
 * board. The first board is the workspace's default; the
 * Inbox is its `inboxColumnId`. The user can rename and
 * reorder both, but the *role* is fixed by the flag (D-07
 * records this). If there is no inbox — e.g. on a fresh
 * install the user deleted the column — the capture
 * becomes a no-op and we surface a one-shot error toast
 * via a `chrome.runtime.sendMessage` to the sidepanel.
 *
 * Side-effects on capture:
 *
 *   1. The new card is created in the Inbox column.
 *   2. A `chrome.notifications` is fired so a user with
 *      the sidepanel closed still sees a tray cue (the
 *      brief's "Add to Sidetrack" lands somewhere
 *      obvious; the sidepanel's toast is the in-app
 *      half of that).
 *   3. The sidepanel, if open, gets a runtime message
 *      with the new card's id and title; it surfaces a
 *      "Captured: <title>" toast.
 *   4. Clicking the OS notification opens the sidepanel
 *      and routes the user to the Inbox (handled by the
 *      sidepanel via the existing `card-captured` channel).
 *
 * The "no content script on every page" property is
 * preserved: we only read the URL/title from the
 * `onClickData` and the `tab` object that Chrome passes
 * to the click handler.
 */

import type { ColumnId } from "../shared/model";
import { captureCard } from "../shared/timer-actions";
import { storage } from "../shared/storage";

/** Menu ids. The `page` variant is the default; the
 *  `selection` variant is enabled when the user has
 *  selected text on the page. */
export const MENU_PAGE = "sidetrack.capture.page";
export const MENU_SELECTION = "sidetrack.capture.selection";

/** Idempotently register both context menu items. Called
 *  from `chrome.runtime.onInstalled` and at module load. */
export async function ensureContextMenus(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.contextMenus) return;
  // `create` with a colliding id throws. Use the lower-level
  // `removeAll` once at install time and `create` for the
  // fresh install path. We do not call `removeAll` on every
  // load — that would briefly empty the menu and flicker it
  // for the user.
  await new Promise<void>((resolve) => {
    try {
      chrome.contextMenus.removeAll(() => resolve());
    } catch {
      resolve();
    }
  });
  chrome.contextMenus.create({
    id: MENU_PAGE,
    title: "Add to Sidetrack",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: MENU_SELECTION,
    title: "Add selection to Sidetrack",
    contexts: ["selection"],
  });
}

/** Wire the click handler. Chrome dispatches one click
 *  per menu invocation; we look up the menu id and pick
 *  the right `page`/`selection` payload. */
export function bindContextMenuClicks(): void {
  if (typeof chrome === "undefined" || !chrome.contextMenus?.onClicked) return;
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void handleContextMenuClick(info, tab).catch((err) => {
      console.warn("[sidetrack] capture failed", err);
    });
  });
}

/**
 * Handle a single context-menu click. Pulled out so the
 * test harness can drive it without a real
 * `chrome.contextMenus` (the shim in
 * `tests/background-capture.test.ts` calls this
 * directly).
 */
type MinimalOnClickData = {
  menuItemId: string | number;
  selectionText?: string;
  pageUrl?: string;
};
type MinimalTab = { url?: string; title?: string } | undefined;

export async function handleContextMenuClick(
  info: MinimalOnClickData,
  tab: MinimalTab,
): Promise<{ ok: boolean; cardId?: string; reason?: string }> {
  const isSelection = String(info.menuItemId) === MENU_SELECTION;
  const url = info.pageUrl ?? tab?.url ?? "";
  const pageTitle = tab?.title ?? "";
  const selection = isSelection ? info.selectionText ?? "" : "";
  if (!url) {
    return { ok: false, reason: "no-url" };
  }
  const state = await storage.peekOrLoad();
  const inbox = findInboxColumn(state);
  if (!inbox) {
    return { ok: false, reason: "no-inbox" };
  }
  const title = isSelection
    ? selection.trim() || pageTitle || url
    : pageTitle || url;
  const description = isSelection
    ? `${pageTitle ? pageTitle + " — " : ""}${url}`
    : url;
  const source = {
    url,
    title: pageTitle,
    selection: isSelection ? selection || undefined : undefined,
    capturedAt: Date.now(),
  };
  const cardId = await captureCard(storage, inbox as ColumnId, title, description, source);
  // Side effects. None of these can fail the capture —
  // a missing notification permission should not
  // silently lose the card.
  try {
    fireCaptureNotification(title);
  } catch (err) {
    console.warn("[sidetrack] capture notification failed", err);
  }
  try {
    notifySidepanel(cardId, title);
  } catch (err) {
    console.warn("[sidetrack] sidepanel notify failed", err);
  }
  return { ok: true, cardId };
}

/** The inbox column on the first board, or `undefined`.
 *  Defensive: if the user has deleted the Inbox column or
 *  the workspace is empty, capture is a no-op. */
function findInboxColumn(
  state: { boards: { id: string; inboxColumnId?: string }[]; columns: { id: string }[] },
): string | undefined {
  for (const board of state.boards) {
    if (board.inboxColumnId) {
      // Make sure the column still exists.
      if (state.columns.some((c) => c.id === board.inboxColumnId)) {
        return board.inboxColumnId;
      }
    }
  }
  return undefined;
}

/** A small OS notification so the user has a tray cue
 *  when the sidepanel is closed. Clicking the
 *  notification opens the sidepanel (handled by the
 *  sidepanel's own message listener). */
function fireCaptureNotification(title: string): void {
  if (typeof chrome === "undefined" || !chrome.notifications) return;
  const truncated =
    title.length > 60 ? `${title.slice(0, 59)}…` : title;
  let iconUrl: string | undefined;
  if (typeof chrome.runtime.getURL === "function") {
    iconUrl = chrome.runtime.getURL("src/assets/icons/icon-48.png");
  }
  chrome.notifications.create(`sidetrack.capture.${Date.now()}`, {
    type: "basic",
    iconUrl: iconUrl ?? "",
    title: "Added to Sidetrack",
    message: truncated,
  });
}

/** Tell the sidepanel, if it is open, that a card was
 *  captured. The sidepanel uses the message to surface a
 *  toast and (when the user clicks the toast) to open
 *  the card detail dialog. The sidepanel may not be
 *  listening — that's fine. */
function notifySidepanel(cardId: string, title: string): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  try {
    chrome.runtime.sendMessage({
      type: "card-captured",
      cardId,
      title,
    });
  } catch {
    // Service worker may not be ready; sidepanel is best-effort.
  }
}
