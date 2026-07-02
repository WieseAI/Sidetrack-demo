import { useEffect, useRef, useState } from "preact/hooks";
import type { BoardId, PersistedState } from "../../shared/model";
import { useStorageHandle } from "../state/storage";
import type { ToastApi } from "../state/toasts";

/**
 * Board picker.
 *
 * Renders the active board's name as a button. Clicking it opens
 * a small menu with the other boards (click to switch), a "New
 * board…" item, and a "Delete board…" item (disabled when the
 * active board is the only one).
 *
 * The button is in the page header (h1) for Phase 1 simplicity;
 * Phase 5 may move it to a more conventional nav-bar position.
 */

export interface BoardPickerProps {
  state: PersistedState;
  activeBoardId: BoardId;
  onSelect: (id: BoardId) => void;
  /** Phase 5: toast API for the "board deleted" undo affordance. */
  toasts: ToastApi;
}

export function BoardPicker({ state, activeBoardId, onSelect, toasts }: BoardPickerProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const storage = useStorageHandle();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setCreating(false);
        setConfirmDelete(false);
      }
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const active = state.boards.find((b) => b.id === activeBoardId);
  if (!active) return <span>Unknown board</span>;

  return (
    <div class="board-picker" ref={wrapRef}>
      <button
        class="board-picker__button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span class="board-picker__name">{active.name}</span>
        <span class="board-picker__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div class="menu board-picker__menu" role="menu">
          {state.boards.map((b) => (
            <button
              key={b.id}
              class={`menu__item${b.id === activeBoardId ? " menu__item--active" : ""}`}
              type="button"
              role="menuitem"
              onClick={() => {
                onSelect(b.id);
                setOpen(false);
              }}
            >
              {b.name}
            </button>
          ))}
          <hr class="menu__separator" />
          {creating ? (
            <form
              class="board-picker__create-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const name = newName.trim();
                if (!name) {
                  setCreating(false);
                  return;
                }
                await storage.mutate({ type: "create-board", name });
                setNewName("");
                setCreating(false);
                setOpen(false);
              }}
            >
              <input
                class="field__input"
                type="text"
                placeholder="Board name"
                value={newName}
                autoFocus
                onInput={(e) =>
                  setNewName((e.currentTarget as HTMLInputElement).value)
                }
                aria-label="New board name"
              />
            </form>
          ) : (
            <button
              class="menu__item"
              type="button"
              role="menuitem"
              onClick={() => setCreating(true)}
            >
              + New board…
            </button>
          )}
          {confirmDelete ? (
            <div class="board-picker__confirm">
              <p>Delete "{active.name}"? This cannot be undone.</p>
              <div class="board-picker__confirm-actions">
                <button
                  class="btn btn--ghost btn--small"
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
                <button
                  class="btn btn--danger btn--small"
                  type="button"
                  data-testid="board-picker-confirm-delete"
                  onClick={async () => {
                    // Phase 5: snapshot the board and all of
                    // its columns and cards so the toast's
                    // Undo button can re-insert them in a
                    // single atomic write.
                    const boardColumns = state.columns.filter(
                      (c) => active.columnIds.includes(c.id),
                    );
                    const cardIds = new Set(
                      boardColumns.flatMap((c) => c.cardIds),
                    );
                    const boardCards = state.cards.filter((c) =>
                      cardIds.has(c.id),
                    );
                    const snapshot = {
                      board: { ...active, columnIds: [...active.columnIds] },
                      columns: boardColumns.map((c) => ({
                        ...c,
                        cardIds: [...c.cardIds],
                      })),
                      cards: boardCards.map((c) => ({
                        ...c,
                        entries: [...c.entries],
                      })),
                    };
                    await storage.mutate({
                      type: "delete-board",
                      boardId: active.id,
                    });
                    // Switch to the first remaining board.
                    const remaining = state.boards.filter(
                      (b) => b.id !== active.id,
                    );
                    if (remaining[0]) onSelect(remaining[0].id);
                    setConfirmDelete(false);
                    setOpen(false);
                    toasts.push({
                      kind: "info",
                      text: `Board "${active.name}" deleted.`,
                      action: {
                        label: "Undo",
                        ariaLabel: `Undo delete board ${active.name}`,
                        onSelect: async () => {
                          await storage.mutate({
                            type: "restore-board",
                            board: snapshot.board,
                            columns: snapshot.columns,
                            cards: snapshot.cards,
                          });
                        },
                      },
                    });
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <button
              class="menu__item menu__item--danger"
              type="button"
              role="menuitem"
              disabled={state.boards.length <= 1}
              title={
                state.boards.length <= 1
                  ? "A workspace must have at least one board."
                  : "Delete this board"
              }
              onClick={() => setConfirmDelete(true)}
            >
              Delete board…
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
