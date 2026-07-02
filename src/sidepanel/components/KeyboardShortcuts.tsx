import { useEffect } from "preact/hooks";

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
 */
export interface KeyboardShortcutsProps {
  onQuickAdd: () => void;
}

export function KeyboardShortcuts({ onQuickAdd }: KeyboardShortcutsProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === "A" || e.key === "a") {
          e.preventDefault();
          onQuickAdd();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onQuickAdd]);
  return null;
}
