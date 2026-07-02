import type { FunctionComponent } from "preact";
import type { ToastApi } from "../state/toasts";

/**
 * Toast view: a vertical stack at the bottom of the sidepanel.
 * Each toast auto-dismisses after a short timeout (handled in
 * `useToasts`). Clicking a toast dismisses it immediately.
 *
 * Phase 5: a toast may carry an optional `action` (rendered
 * as a button on the right). Clicking the action invokes its
 * callback *and* dismisses the toast, so the caller does not
 * need to also dismiss.
 */
export const Toast: FunctionComponent<{ toasts: ToastApi }> = ({ toasts }) => {
  if (toasts.toasts.length === 0) return null;
  return (
    <div class="toast-stack" role="status" aria-live="polite">
      {toasts.toasts.map((t) => (
        <div
          key={t.id}
          class={`toast toast--${t.kind}${t.action ? " toast--has-action" : ""}`}
        >
          <span
            class="toast__text"
            onClick={() => toasts.dismiss(t.id)}
            role={t.action ? "status" : "button"}
          >
            {t.text}
          </span>
          {t.action ? (
            <button
              class="toast__action"
              type="button"
              data-testid={`toast-action-${t.id}`}
              aria-label={t.action.ariaLabel ?? t.action.label}
              onClick={() => {
                toasts.dismiss(t.id);
                t.action!.onSelect();
              }}
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
};
