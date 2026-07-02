import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { CardId, EntryId, PersistedState, TimeEntry } from "../../shared/model";
import { useStorageHandle } from "../state/storage";
import { useTickingNow } from "../state/tick";
import { formatDurationLong } from "../../shared/format";
import { isRunningOn } from "../../shared/timer";

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
  const [editingEntryId, setEditingEntryId] = useState<EntryId | null>(null);

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

  async function addManualEntry() {
    if (!card) return;
    const now = Date.now();
    const start = now - 60_000; // 1 min ago, so the new entry is editable
    await storage.mutate({
      type: "add-entry",
      cardId: card.id,
      entry: { startAt: start, endAt: now, source: "manual" },
    });
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
          <TimeEntries
            card={card}
            state={state}
            editingEntryId={editingEntryId}
            onEditEntry={setEditingEntryId}
            onCloseEdit={() => setEditingEntryId(null)}
            onAddManual={() => void addManualEntry()}
          />
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

/**
 * Time entries list.
 *
 * Shows every `TimeEntry` on the card, oldest first. Each row
 * has:
 *   - start / end timestamps
 *   - duration (live for the running entry, static for closed)
 *   - source label ("manual" / "timer" / "idle-trim")
 *   - edit and delete buttons
 *
 * Editing an entry opens an inline form with two datetime-local
 * inputs and a "Save" button. Deletion is a single click; we
 * don't gate it behind a confirm dialog because the entry can
 * be re-added by hand and the data is local.
 *
 * The brief's Phase 2 AC: "Manually editing an entry's start/end
 * and saving reflects immediately in the card's total."
 */
function TimeEntries(props: {
  card: import("../../shared/model").Card;
  state: import("../../shared/model").PersistedState;
  editingEntryId: EntryId | null;
  onEditEntry: (id: EntryId | null) => void;
  onCloseEdit: () => void;
  onAddManual: () => void;
}) {
  const { card, state, editingEntryId, onEditEntry, onCloseEdit, onAddManual } =
    props;
  const storage = useStorageHandle();
  const now = useTickingNow();
  const running = isRunningOn(state, card.id);
  // Sort entries oldest first so the running entry (always
  // last in `entries`) is at the bottom of the list.
  const entries = useMemo(
    () => [...card.entries].sort((a, b) => a.startAt - b.startAt),
    [card.entries],
  );
  if (entries.length === 0) {
    return (
      <div class="dialog__entries">
        <div class="dialog__entries-header">
          <h3 class="dialog__entries-title">Time entries</h3>
          <button
            class="btn btn--ghost btn--small"
            type="button"
            onClick={onAddManual}
            aria-label="Add a manual time entry"
          >
            + Add entry
          </button>
        </div>
        <p class="dialog__entries-empty">
          No entries yet. Start the timer on this card to begin tracking.
        </p>
      </div>
    );
  }
  return (
    <div class="dialog__entries">
      <div class="dialog__entries-header">
        <h3 class="dialog__entries-title">Time entries</h3>
        <button
          class="btn btn--ghost btn--small"
          type="button"
          onClick={onAddManual}
          aria-label="Add a manual time entry"
        >
          + Add entry
        </button>
      </div>
      <ul class="dialog__entries-list">
        {entries.map((e) => (
          <EntryRow
            key={e.id}
            entry={e}
            now={now}
            running={running}
            editing={editingEntryId === e.id}
            onEdit={() => onEditEntry(e.id)}
            onClose={onCloseEdit}
            onDelete={async () => {
              await storage.mutate({
                type: "delete-entry",
                cardId: card.id,
                entryId: e.id,
              });
            }}
            onSave={async (patch) => {
              await storage.mutate({
                type: "update-entry",
                cardId: card.id,
                entryId: e.id,
                patch,
              });
              onCloseEdit();
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function EntryRow(props: {
  entry: TimeEntry;
  now: number;
  running: boolean;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
  onDelete: () => void | Promise<void>;
  onSave: (patch: Partial<Pick<TimeEntry, "startAt" | "endAt" | "note">>) => void | Promise<void>;
}) {
  const { entry, now, running, editing, onEdit, onClose, onDelete, onSave } =
    props;
  const isOpen = entry.endAt === null;
  const start = entry.startAt;
  const end = isOpen ? now : entry.endAt!;
  const duration = Math.max(0, end - start);

  if (editing) {
    return (
      <li class="dialog__entries-item dialog__entries-item--editing">
        <EntryEditor
          entry={entry}
          onCancel={onClose}
          onSave={onSave}
        />
      </li>
    );
  }

  return (
    <li class="dialog__entries-item" data-entry-source={entry.source}>
      <div class="dialog__entries-main">
        <div class="dialog__entries-time">
          <span>{formatLocal(start)}</span>
          <span aria-hidden="true">→</span>
          <span>{isOpen ? "now" : formatLocal(end)}</span>
        </div>
        <div class="dialog__entries-meta">
          <span class="dialog__entries-duration">
            {formatDurationLong(duration)}
          </span>
          <span class={`dialog__entries-source dialog__entries-source--${entry.source}`}>
            {entry.source}
          </span>
        </div>
      </div>
      <div class="dialog__entries-actions">
        <button
          class="btn btn--ghost btn--small"
          type="button"
          onClick={onEdit}
          disabled={isOpen && running}
          title={
            isOpen && running
              ? "Stop the timer before editing this entry"
              : "Edit this entry"
          }
          aria-label="Edit entry"
        >
          Edit
        </button>
        <button
          class="btn btn--ghost btn--small btn--danger-ghost"
          type="button"
          onClick={onDelete}
          aria-label="Delete entry"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function EntryEditor(props: {
  entry: TimeEntry;
  onCancel: () => void;
  onSave: (
    patch: Partial<Pick<TimeEntry, "startAt" | "endAt" | "note">>,
  ) => void | Promise<void>;
}) {
  const { entry, onCancel, onSave } = props;
  // datetime-local wants a YYYY-MM-DDTHH:mm string. We render
  // in local time; the reducer is timezone-agnostic.
  const [start, setStart] = useState(toLocalInput(entry.startAt));
  const [end, setEnd] = useState(
    entry.endAt !== null ? toLocalInput(entry.endAt) : toLocalInput(Date.now()),
  );
  const [note, setNote] = useState(entry.note ?? "");

  return (
    <form
      class="dialog__entries-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        const startAt = fromLocalInput(start);
        const endAt = fromLocalInput(end);
        if (Number.isNaN(startAt) || Number.isNaN(endAt)) return;
        if (endAt <= startAt) return;
        await onSave({
          startAt,
          endAt,
          note: note.trim() || undefined,
        });
      }}
    >
      <label class="field field--inline">
        <span class="field__label">Start</span>
        <input
          class="field__input"
          type="datetime-local"
          value={start}
          step={60}
          onInput={(e) =>
            setStart((e.currentTarget as HTMLInputElement).value)
          }
        />
      </label>
      <label class="field field--inline">
        <span class="field__label">End</span>
        <input
          class="field__input"
          type="datetime-local"
          value={end}
          step={60}
          onInput={(e) =>
            setEnd((e.currentTarget as HTMLInputElement).value)
          }
        />
      </label>
      <label class="field field--inline">
        <span class="field__label">Note</span>
        <input
          class="field__input"
          type="text"
          value={note}
          placeholder="Optional"
          onInput={(e) => setNote((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <div class="dialog__entries-editor-actions">
        <button class="btn btn--ghost btn--small" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button class="btn btn--primary btn--small" type="submit">
          Save
        </button>
      </div>
    </form>
  );
}

function formatLocal(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toLocalInput(ms: number): string {
  // YYYY-MM-DDTHH:mm in local time, no seconds.
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function fromLocalInput(value: string): number {
  // datetime-local has no timezone; treat as local time.
  const d = new Date(value);
  return d.getTime();
}
