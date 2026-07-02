import { useEffect, useRef } from "preact/hooks";

/**
 * Reusable confirmation dialog.
 *
 * Used by destructive actions (delete column, etc.). The actual
 * action is supplied as an `onConfirm` callback; the dialog is
 * just a styled yes/no prompt.
 */
export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    }
    document.addEventListener("keydown", onKey);
    confirmRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

  return (
    <div class="dialog-backdrop" onClick={onCancel}>
      <div
        class="dialog dialog--confirm"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <header class="dialog__header">
          <h2 class="dialog__title">{title}</h2>
        </header>
        <div class="dialog__body">
          <p>{message}</p>
        </div>
        <footer class="dialog__footer">
          <button class="btn btn--ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            class={`btn ${danger ? "btn--danger" : "btn--primary"}`}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
