/**
 * Toast queue.
 *
 * The sidepanel surfaces transient feedback ("Saved.", "Card
 * deleted.", "Timer started on 'X'.") as a stack of toasts that
 * auto-dismiss after a short timeout. Toasts are visual only — no
 * state is mutated by them — so the queue is a pure UI concern
 * that lives in a hook.
 *
 * Phase 5 adds an optional action button to a toast. The
 * Phase-5 destructive-action flows (delete card, delete
 * board, delete time entry) push a toast with an "Undo"
 * button; the button calls a function supplied by the caller
 * and dismisses the toast. The button label is configurable
 * so future flows (e.g. "Open the report" after a capture)
 * can reuse the same plumbing.
 */

import { useCallback, useRef, useState } from "preact/hooks";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  /** Optional action button. Renders to the right of the text. */
  action?: ToastAction;
}

export interface ToastAction {
  /** Visible label, e.g. "Undo". */
  label: string;
  /** Called when the user clicks the button. The toast is
   *  dismissed immediately before the callback fires so the
   *  callback does not need to also dismiss. */
  onSelect: () => void;
  /** Short, accessible name (e.g. "Undo delete card"). */
  ariaLabel?: string;
}

export interface ToastApi {
  toasts: ReadonlyArray<Toast>;
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

const DEFAULT_TIMEOUT_MS = 4_000;
const UNDO_TIMEOUT_MS = 6_000;

export function useToasts(): ToastApi {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((curr) => curr.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = ++seq.current;
      setToasts((curr) => [...curr, { ...toast, id }]);
      const timeout = toast.action
        ? UNDO_TIMEOUT_MS
        : toast.kind === "error"
          ? DEFAULT_TIMEOUT_MS * 2
          : DEFAULT_TIMEOUT_MS;
      setTimeout(() => dismiss(id), timeout);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}
