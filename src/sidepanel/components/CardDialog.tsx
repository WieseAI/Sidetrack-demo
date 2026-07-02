import { useEffect, useRef, useState } from "preact/hooks";
import type { CardId, PersistedState } from "../../shared/model";
import { useStorageHandle } from "../state/storage";

/**
 * Card detail dialog.
 *
 * Full edit form for a card: title (required), description
 * (optional, multiline), due date (optional YYYY-MM-DD), and a
 * read-only list of the card's time entries. Phase 2 lets the
 * user edit / delete entries from this view; Phase 1 just shows
 * the list with a placeholder "0m tracked."
 *
 * The dialog is dismissed by:
 *   - clicking the backdrop
 *   - pressing Escape
 *   - clicking the close button
 *
 * Changes are written through the storage handle so the parent
 * (which subscribes to storage) re-renders with the latest data.
 */
export interface CardDialogProps {
  state: PersistedState;
  cardId: CardId;
  onClose: () => void;
}

export function CardDialog({ state, cardId, onClose }: CardDialogProps) {
  const card = state.cards.find((c) => c.id === cardId);
  const storage = useStorageHandle();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const [title, setTitle] = useState(card?.title ?? "");
  const [description, setDescription] = useState(card?.description ?? "");
  const [dueDate, setDueDate] = useState(card?.dueDate ?? "");

  // Sync the form when the underlying card changes (e.g. a
  // background storage update arrives while the dialog is open).
  useEffect(() => {
    if (!card) return;
    setTitle(card.title);
    setDescription(card.description ?? "");
    setDueDate(card.dueDate ?? "");
  }, [card?.id, card?.title, card?.description, card?.dueDate, card]);

  // Escape closes the dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!card) {
    return (
      <div class="dialog-backdrop" onClick={onClose}>
        <div
          class="dialog"
          ref={dialogRef}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <p>Card not found.</p>
        </div>
      </div>
    );
  }

  async function save() {
    if (!card) return;
    const trimmedTitle = title.trim() || card.title;
    await storage.mutate({
      type: "update-card",
      cardId: card.id,
      patch: {
        title: trimmedTitle,
        description: description.trim() || undefined,
        dueDate: dueDate || undefined,
      },
    });
    onClose();
  }

  return (
    <div
      class="dialog-backdrop"
      onClick={onClose}
      data-testid="card-dialog-backdrop"
    >
      <div
        class="dialog"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit card: ${card.title}`}
      >
        <header class="dialog__header">
          <h2 class="dialog__title">Edit card</h2>
          <button
            class="btn btn--icon"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <form
          class="dialog__body"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label class="field">
            <span class="field__label">Title</span>
            <input
              class="field__input"
              type="text"
              value={title}
              autoFocus
              onInput={(e) =>
                setTitle((e.currentTarget as HTMLInputElement).value)
              }
              required
              maxLength={200}
            />
          </label>
          <label class="field">
            <span class="field__label">Description</span>
            <textarea
              class="field__input field__input--textarea"
              value={description}
              onInput={(e) =>
                setDescription((e.currentTarget as HTMLTextAreaElement).value)
              }
              rows={5}
              placeholder="Optional details, links, notes…"
            />
          </label>
          <label class="field">
            <span class="field__label">Due date</span>
            <input
              class="field__input"
              type="date"
              value={dueDate}
              onInput={(e) =>
                setDueDate((e.currentTarget as HTMLInputElement).value)
              }
            />
          </label>
          <div class="dialog__entries">
            <h3 class="dialog__entries-title">Time entries</h3>
            {card.entries.length === 0 ? (
              <p class="dialog__entries-empty">
                No entries yet. Timers come in Phase 2.
              </p>
            ) : (
              <ul class="dialog__entries-list">
                {card.entries.map((e) => (
                  <li key={e.id} class="dialog__entries-item">
                    {new Date(e.startAt).toLocaleString()} –{" "}
                    {e.endAt
                      ? new Date(e.endAt).toLocaleString()
                      : "running"}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <footer class="dialog__footer">
            <button
              class="btn btn--ghost"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button class="btn btn--primary" type="submit">
              Save
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
