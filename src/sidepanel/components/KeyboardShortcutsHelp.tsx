import { useEffect, useRef } from "preact/hooks";

/**
 * Keyboard shortcuts help dialog.
 *
 * Phase 5 ships a single "?" / Shift+/ chord (and the
 * Settings → Keyboard menu item) to open this dialog.
 * The dialog documents every shortcut the sidepanel
 * responds to and points at the global chrome.commands
 * the user can rebind from chrome://extensions/shortcuts.
 *
 * The dialog is dismissable with Escape, Enter, or the
 * Close button. The keyboard listener is global so the
 * user can press Escape from anywhere.
 */
export interface KeyboardShortcutsHelpProps {
  onClose: () => void;
}

export function KeyboardShortcutsHelp({ onClose }: KeyboardShortcutsHelpProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      class="dialog-backdrop"
      data-testid="shortcuts-help-backdrop"
      onClick={onClose}
    >
      <div
        class="dialog dialog--shortcuts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header class="dialog__header">
          <h2 class="dialog__title" id="shortcuts-help-title">
            Keyboard shortcuts
          </h2>
        </header>
        <div class="dialog__body shortcuts__list">
          <section class="shortcuts__group">
            <h3 class="shortcuts__group-title">In the sidepanel</h3>
            <dl>
              <div class="shortcuts__row">
                <dt>
                  <kbd>Alt</kbd>
                  <span>+</span>
                  <kbd>Shift</kbd>
                  <span>+</span>
                  <kbd>A</kbd>
                </dt>
                <dd>Focus the quick-add input on the first column.</dd>
              </div>
              <div class="shortcuts__row">
                <dt>
                  <kbd>Alt</kbd>
                  <span>+</span>
                  <kbd>Shift</kbd>
                  <span>+</span>
                  <kbd>S</kbd>
                </dt>
                <dd>Open Settings (idle threshold and theme).</dd>
              </div>
              <div class="shortcuts__row">
                <dt>
                  <kbd>?</kbd>
                </dt>
                <dd>Open this help dialog.</dd>
              </div>
              <div class="shortcuts__row">
                <dt>
                  <kbd>Esc</kbd>
                </dt>
                <dd>Close the topmost dialog or the onboarding overlay.</dd>
              </div>
            </dl>
          </section>
          <section class="shortcuts__group">
            <h3 class="shortcuts__group-title">Idle prompt</h3>
            <dl>
              <div class="shortcuts__row">
                <dt>
                  <kbd>1</kbd>
                </dt>
                <dd>Keep all the time on the running entry.</dd>
              </div>
              <div class="shortcuts__row">
                <dt>
                  <kbd>2</kbd>
                </dt>
                <dd>Trim the idle period from the running entry.</dd>
              </div>
              <div class="shortcuts__row">
                <dt>
                  <kbd>3</kbd>
                </dt>
                <dd>Trim and stop the running timer.</dd>
              </div>
              <div class="shortcuts__row">
                <dt>
                  <kbd>←</kbd>
                  <span>/</span>
                  <kbd>→</kbd>
                </dt>
                <dd>Move focus between the three choices.</dd>
              </div>
            </dl>
          </section>
          <section class="shortcuts__group">
            <h3 class="shortcuts__group-title">Global (Chrome commands)</h3>
            <p class="shortcuts__note">
              These work even when the sidepanel is closed. Rebind them
              from{" "}
              <code>chrome://extensions/shortcuts</code>.
            </p>
            <dl>
              <div class="shortcuts__row">
                <dt>
                  <kbd>Alt</kbd>
                  <span>+</span>
                  <kbd>Shift</kbd>
                  <span>+</span>
                  <kbd>S</kbd>
                </dt>
                <dd>Open the Sidetrack sidepanel.</dd>
              </div>
              <div class="shortcuts__row">
                <dt>
                  <kbd>Alt</kbd>
                  <span>+</span>
                  <kbd>Shift</kbd>
                  <span>+</span>
                  <kbd>A</kbd>
                </dt>
                <dd>Quick-add a card in the focused column.</dd>
              </div>
              <div class="shortcuts__row">
                <dt>
                  <kbd>Alt</kbd>
                  <span>+</span>
                  <kbd>Shift</kbd>
                  <span>+</span>
                  <kbd>T</kbd>
                </dt>
                <dd>Start or stop the timer on the focused card.</dd>
              </div>
            </dl>
          </section>
        </div>
        <footer class="dialog__footer">
          <button
            ref={closeRef}
            class="btn btn--primary"
            type="button"
            onClick={onClose}
            data-testid="shortcuts-help-close"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
