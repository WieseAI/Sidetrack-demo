/**
 * Dialog stack.
 *
 * The sidepanel can have at most one modal open at a time, but we
 * model it as a stack so a confirm dialog can pop up over a card
 * detail dialog (e.g. "delete this card?" from the detail view).
 *
 * Each entry is a discriminated union by `kind`. The `App` renders
 * the topmost entry.
 */

import { useCallback, useState } from "preact/hooks";
import type { CardId } from "../../shared/model";

export type Dialog =
  | {
      kind: "card";
      cardId: CardId;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
      onConfirm: () => void;
    }
  | {
      kind: "settings";
    }
  | {
      kind: "shortcuts";
    };

export interface DialogApi {
  stack: ReadonlyArray<Dialog>;
  push: (dialog: Dialog) => void;
  pop: () => void;
  clear: () => void;
}

export function useDialogStack(): DialogApi {
  const [stack, setStack] = useState<Dialog[]>([]);
  return {
    stack,
    push: useCallback((d: Dialog) => setStack((s) => [...s, d]), []),
    pop: useCallback(() => setStack((s) => s.slice(0, -1)), []),
    clear: useCallback(() => setStack([]), []),
  };
}
