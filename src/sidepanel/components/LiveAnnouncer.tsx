import { useEffect, useState } from "preact/hooks";

/**
 * Off-screen ARIA live region for screen-reader announcements.
 *
 * Phase 5 ships a single live region with `aria-live="polite"`
 * that the rest of the app pushes short messages into via
 * the `announce()` function exported from this module. We
 * use this for events that are visible to sighted users but
 * easy to miss in a screen reader:
 *
 *   - drag start / drag end (the visible card lifts but
 *     screen readers see no immediate change)
 *   - timer start / stop
 *   - "timer stopped on X" auto-swap announcements
 *   - undo affordances
 *
 * The region is visually hidden (the existing `.visually-hidden`
 * utility in the styles) but read by screen readers on every
 * change. We cycle the text through a short empty-string
 * step so consecutive identical messages are still
 * re-announced.
 *
 * Implementation note: this is a tiny pub-sub on the module
 * level. The sidepanel is a single instance (a Chrome
 * sidepanel), so module-level state is the right granularity
 * and avoids prop-drilling an announcer object through every
 * component that wants to fire one.
 */

type Listener = (message: string) => void;
const listeners = new Set<Listener>();

/** Push a message into the live region. Safe to call from
 *  anywhere; ignored if no `LiveAnnouncer` is mounted. */
export function announce(message: string): void {
  for (const l of listeners) l(message);
}

/**
 * The actual <div> that lives in the DOM. Place this once
 * near the top of the sidepanel; `announce()` anywhere else
 * pushes messages into it.
 */
export function LiveAnnouncer() {
  const [text, setText] = useState("");
  useEffect(() => {
    const listener: Listener = (m) => {
      // Cycle through empty string so consecutive identical
      // messages are still re-announced by the AT.
      setText("");
      setTimeout(() => setText(m), 16);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return (
    <div
      class="visually-hidden"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="live-announcer"
    >
      {text}
    </div>
  );
}
