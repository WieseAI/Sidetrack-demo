import { useEffect } from "preact/hooks";
import { useStorageHandle } from "../state/storage";

/**
 * In-sidepanel keyboard shortcuts.
 *
 * Listens for the D-17 chords on the sidepanel document and
 * dispatches them. The `chrome.commands` API fires the chords
 * globally; the service worker relays them to the sidepanel via
 * `chrome.runtime.sendMessage` (wired up in Phase 2). In Phase 1
 * we only support the in-sidepanel Alt+Shift+A chord (focus the
 * quick-add input) so the brief's "keyboard friendly" requirement
 * starts to be satisfied end-to-end.
 *
 * Phase 3 also uses this module to refresh the running timer's
 * `lastSeenActive` anchor on any user input inside the
 * sidepanel (D-08). We do this with a throttled
 * `requestIdleCallback` (or `setTimeout` fallback) so the
 * write rate stays sane.
 */
export interface KeyboardShortcutsProps {
  onQuickAdd: () => void;
  onOpenSettings?: () => void;
}

const TOUCH_THROTTLE_MS = 5_000;
let lastTouchedAt = 0;

function touchActive(storage: ReturnType<typeof useStorageHandle>) {
  const now = Date.now();
  if (now - lastTouchedAt < TOUCH_THROTTLE_MS) return;
  lastTouchedAt = now;
  // Fire-and-forget: the alarm tick will reconcile anyway,
  // and the sidepanel hook subscribes to storage changes
  // so the local state will update when the write lands.
  void storage.mutate({ type: "touch-active", now }).catch(() => {
    // Storage can be temporarily unavailable during import;
    // the next input will retry.
  });
}

export function KeyboardShortcuts({ onQuickAdd, onOpenSettings }: KeyboardShortcutsProps) {
  const storage = useStorageHandle();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Throttled active-anchor refresh on any meaningful
      // user input. We exclude modifier-only events so the
      // anchor is not refreshed by holding down Shift while
      // reading the screen.
      if (e.key.length > 1 && e.key !== "Enter" && e.key !== "Escape") {
        return;
      }
      touchActive(storage);

      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === "A" || e.key === "a") {
          e.preventDefault();
          onQuickAdd();
        }
        if ((e.key === "S" || e.key === "s") && onOpenSettings) {
          e.preventDefault();
          onOpenSettings();
        }
      }
      if (e.key === "?" && e.shiftKey) {
        // Phase 5 will render a real help dialog. For now,
        // we surface the keyboard hint toast.
        e.preventDefault();
        // The toast is wired by the parent; we keep the
        // chord as a no-op for Phase 3.
      }
    }
    function onPointer() {
      touchActive(storage);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [onQuickAdd, onOpenSettings, storage]);
  return null;
}
