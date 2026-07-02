import { useEffect, useMemo, useRef } from "preact/hooks";
import type { IdlePrompt, PersistedState } from "../../shared/model";
import { formatDurationLong, formatDurationCompact } from "../../shared/format";

/**
 * The idle prompt — the heart of the product.
 *
 * Brief AC #5: "If a timer is running and I haven't been
 * active for X minutes, notify me. The notification/prompt
 * gives me real choices, at minimum: keep all the time,
 * trim the idle time away (retroactively, back to when I
 * went idle), or stop the timer (also trimmed)."
 *
 * The UX is the centerpiece of the product, not a generic
 * browser notification. Per D-16 the prompt renders in the
 * sidepanel as the primary surface; an OS notification is
 * only a deep-link from the notification tray.
 *
 * Layout (top to bottom):
 *   - Header: "You've been away for X" + the card title.
 *   - Body: a one-line explanation of what each choice
 *     does, then the three buttons.
 *   - Footer: a small Esc-to-dismiss hint (Esc == Keep all
 *     when no choice has been made).
 *
 * Keyboard:
 *   - 1/2/3   → Keep all / Trim / Stop (and trim)
 *   - ← / →   → Move focus between buttons
 *   - Enter   → Activate the focused button
 *   - Esc     → Dismiss (= Keep all, with a toast)
 *
 * The default focus is **Trim** because the brief says it
 * is the sensible default for the cold-start gap, and
 * because it is what the user almost always wants (the
 * timer's whole point is accurate time, not "give me a
 * free hour because I forgot to stop it").
 */

export type IdleChoice = "keep" | "trim" | "stop";

export interface IdlePromptDialogProps {
  state: PersistedState;
  prompt: IdlePrompt;
  onResolve: (choice: IdleChoice) => void | Promise<void>;
}

export function IdlePromptDialog({
  state,
  prompt,
  onResolve,
}: IdlePromptDialogProps) {
  const keepRef = useRef<HTMLButtonElement | null>(null);
  const trimRef = useRef<HTMLButtonElement | null>(null);
  const stopRef = useRef<HTMLButtonElement | null>(null);
  // Track the currently focused button so ←/→ can move
  // focus without resetting on every render.
  const focusIndex = useRef<1 | 2 | 3>(2);
  // busy: the user clicked something; we keep the dialog
  // mounted until the parent has resolved and unmounted it.
  // We use it to disable all three buttons so a double
  // click cannot double-fire.
  const busy = useRef(false);

  const card = useMemo(
    () => state.cards.find((c) => c.id === prompt.cardId) ?? null,
    [state.cards, prompt.cardId],
  );

  // Focus "Trim" on mount.
  useEffect(() => {
    trimRef.current?.focus();
    focusIndex.current = 2;
  }, []);

  // Global key handler so the dialog is reachable with the
  // chord keys (1/2/3 and ←/→) regardless of which sidepanel
  // control happens to have focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // 1/2/3 choose directly. We also accept the numpad
      // equivalents via `e.code === "Digit1"`.
      if (e.key === "1" || e.code === "Digit1") {
        e.preventDefault();
        if (busy.current) return;
        busy.current = true;
        void onResolve("keep");
        return;
      }
      if (e.key === "2" || e.code === "Digit2") {
        e.preventDefault();
        if (busy.current) return;
        busy.current = true;
        void onResolve("trim");
        return;
      }
      if (e.key === "3" || e.code === "Digit3") {
        e.preventDefault();
        if (busy.current) return;
        busy.current = true;
        void onResolve("stop");
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (busy.current) return;
        busy.current = true;
        // Esc = Keep all (with a toast hint that explains
        // what happened, set by the caller).
        void onResolve("keep");
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const next = e.key === "ArrowLeft"
          ? Math.max(1, focusIndex.current - 1)
          : Math.min(3, focusIndex.current + 1);
        focusIndex.current = next as 1 | 2 | 3;
        if (next === 1) keepRef.current?.focus();
        if (next === 2) trimRef.current?.focus();
        if (next === 3) stopRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onResolve]);

  const idle = Math.max(0, prompt.idleForMs);
  const idleText = formatDurationLong(idle);

  return (
    <div
      class="dialog-backdrop"
      data-testid="idle-prompt-backdrop"
      role="presentation"
    >
      <div
        class="dialog dialog--idle"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-prompt-title"
        aria-describedby="idle-prompt-body"
        onClick={(e) => e.stopPropagation()}
      >
        <header class="dialog__header">
          <h2 class="dialog__title" id="idle-prompt-title">
            You've been away for {idleText}
          </h2>
        </header>
        <div class="dialog__body" id="idle-prompt-body">
          <p class="idle-prompt__lede">
            The timer is still running on{" "}
            <strong class="idle-prompt__card-title">
              {card?.title ?? "(deleted card)"}
            </strong>
            . What do you want to do with the idle time?
          </p>
          <ul class="idle-prompt__choices" role="list">
            <li class="idle-prompt__choice">
              <span class="idle-prompt__choice-key" aria-hidden="true">
                1
              </span>
              <div>
                <strong>Keep all the time</strong>
                <p class="idle-prompt__choice-detail">
                  Counts the full {idleText} as tracked time. Use this if
                  you were actually working off-screen.
                </p>
              </div>
            </li>
            <li class="idle-prompt__choice idle-prompt__choice--default">
              <span class="idle-prompt__choice-key" aria-hidden="true">
                2
              </span>
              <div>
                <strong>Trim idle time</strong>
                <p class="idle-prompt__choice-detail">
                  Retroactively close the entry at the last moment you
                  were active, then keep running. The {idleText} is not
                  counted.
                </p>
              </div>
            </li>
            <li class="idle-prompt__choice">
              <span class="idle-prompt__choice-key" aria-hidden="true">
                3
              </span>
              <div>
                <strong>Stop the timer</strong>
                <p class="idle-prompt__choice-detail">
                  Same as Trim, then stop the timer. Total counted time
                  on the card stops at the last active moment.
                </p>
              </div>
            </li>
          </ul>
        </div>
        <footer class="dialog__footer idle-prompt__footer">
          <button
            ref={keepRef}
            class="btn btn--ghost"
            type="button"
            data-testid="idle-choice-keep"
            aria-keyshortcuts="1"
            onClick={() => {
              if (busy.current) return;
              busy.current = true;
              void onResolve("keep");
            }}
            onFocus={() => (focusIndex.current = 1)}
          >
            <span class="idle-prompt__btn-key" aria-hidden="true">
              1
            </span>
            Keep all
            <span class="idle-prompt__btn-hint">
              +{formatDurationCompact(idle)}
            </span>
          </button>
          <button
            ref={trimRef}
            class="btn btn--primary"
            type="button"
            data-testid="idle-choice-trim"
            onClick={() => {
              if (busy.current) return;
              busy.current = true;
              void onResolve("trim");
            }}
            onFocus={() => (focusIndex.current = 2)}
            aria-keyshortcuts="2"
          >
            <span class="idle-prompt__btn-key" aria-hidden="true">
              2
            </span>
            Trim idle time
          </button>
          <button
            ref={stopRef}
            class="btn btn--danger"
            type="button"
            data-testid="idle-choice-stop"
            onClick={() => {
              if (busy.current) return;
              busy.current = true;
              void onResolve("stop");
            }}
            onFocus={() => (focusIndex.current = 3)}
            aria-keyshortcuts="3"
          >
            <span class="idle-prompt__btn-key" aria-hidden="true">
              3
            </span>
            Stop &amp; trim
          </button>
        </footer>
        <p class="idle-prompt__hint" aria-hidden="true">
          <kbd>Esc</kbd> keeps all · <kbd>←</kbd>/<kbd>→</kbd> to choose
        </p>
      </div>
    </div>
  );
}
