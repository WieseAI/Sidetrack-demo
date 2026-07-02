import type { FunctionComponent } from "preact";
import type { ToastApi } from "../state/toasts";

/**
 * Toast view: a vertical stack at the bottom of the sidepanel.
 * Each toast auto-dismisses after a short timeout (handled in
 * `useToasts`). Clicking a toast dismisses it immediately.
 */
export const Toast: FunctionComponent<{ toasts: ToastApi }> = ({ toasts }) => {
  if (toasts.toasts.length === 0) return null;
  return (
    <div class="toast-stack" role="status" aria-live="polite">
      {toasts.toasts.map((t) => (
        <div
          key={t.id}
          class={`toast toast--${t.kind}`}
          onClick={() => toasts.dismiss(t.id)}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
};
