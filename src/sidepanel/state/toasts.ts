/**
 * Toast queue.
 *
 * The sidepanel surfaces transient feedback ("Saved.", "Card
 * deleted.", "Timer started on 'X'.") as a stack of toasts that
 * auto-dismiss after a short timeout. Toasts are visual only — no
 * state is mutated by them — so the queue is a pure UI concern
 * that lives in a hook.
 *
 * Phase 1 uses the toast for import/export feedback and for the
 * "card deleted" undo banner (Phase 5 may add a real undo stack).
 */

import { useCallback, useRef, useState } from "preact/hooks";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface ToastApi {
  toasts: ReadonlyArray<Toast>;
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

const DEFAULT_TIMEOUT_MS = 4_000;

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
      const timeout =
        toast.kind === "error"
          ? DEFAULT_TIMEOUT_MS * 2
          : DEFAULT_TIMEOUT_MS;
      setTimeout(() => dismiss(id), timeout);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}
