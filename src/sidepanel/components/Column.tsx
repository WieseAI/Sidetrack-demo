import { useEffect, useRef, useState } from "preact/hooks";
import { useDroppable } from "@dnd-kit/core";
import type { PersistedState, ColumnId, CardId } from "../../shared/model";
import { useStorageHandle } from "../state/storage";
import { CardView } from "./Card";
import type { ToastApi } from "../state/toasts";

/**
 * Column view.
 *
 * Renders a column header (name + count + menu), a list of cards,
 * and a quick-add input at the bottom. The column itself is a
 * droppable so dropping into the empty area of a column appends
 * the card to the end (the dnd-kit overlay translates the column
 * id into "append to end" in `Board.onDragEnd`).
 *
 * Quick-add: an inline text input that creates a card on Enter and
 * clears. Esc cancels. This is the brief's "one keystroke to add
 * a card" flow.
 */

export interface ColumnProps {
  state: PersistedState;
  column: {
    id: ColumnId;
    name: string;
    cardIds: CardId[];
  };
  isInbox: boolean;
  onOpenCard: (cardId: CardId) => void;
  onConfirm: (opts: {
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => void;
  }) => void;
  toasts: ToastApi;
}

export function ColumnView({
  state,
  column,
  isInbox,
  onOpenCard,
  onConfirm,
  toasts,
}: ColumnProps) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const storage = useStorageHandle();
  const renameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setName(column.name);
  }, [column.name]);

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  const cards = column.cardIds
    .map((id) => state.cards.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  async function commitRename() {
    setRenaming(false);
    const trimmed = name.trim();
    if (!trimmed || trimmed === column.name) {
      setName(column.name);
      return;
    }
    await storage.mutate({
      type: "rename-column",
      columnId: column.id,
      name: trimmed,
    });
  }

  return (
    <div
      ref={setNodeRef}
      class={`column${isOver ? " column--over" : ""}`}
      role="listitem"
      aria-label={`Column: ${column.name}`}
    >
      <header class="column__header">
        {renaming ? (
          <input
            ref={renameRef}
            class="column__name-input"
            value={name}
            onInput={(e) =>
              setName((e.currentTarget as HTMLInputElement).value)
            }
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setName(column.name);
                setRenaming(false);
              }
            }}
            aria-label="Rename column"
          />
        ) : (
          <button
            class="column__name-button"
            type="button"
            onClick={() => setRenaming(true)}
            title="Click to rename"
          >
            <span class="column__name">{column.name}</span>
            <span class="column__count" aria-label={`${cards.length} cards`}>
              {cards.length}
            </span>
            {isInbox ? (
              <span class="column__badge" aria-label="Inbox column">
                Inbox
              </span>
            ) : null}
          </button>
        )}
        <button
          class="btn btn--icon column__menu-button"
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Column actions"
          onClick={() => setMenuOpen((o) => !o)}
        >
          ⋯
        </button>
        {menuOpen ? (
          <ColumnMenu
            column={column}
            state={state}
            isInbox={isInbox}
            onClose={() => setMenuOpen(false)}
            onConfirm={onConfirm}
            toasts={toasts}
          />
        ) : null}
      </header>
      <ol class="column__cards" role="list">
        {cards.map((card) => (
          <li key={card.id}>
            <CardView
              card={card}
              state={state}
              onOpen={() => onOpenCard(card.id)}
              toasts={toasts}
            />
          </li>
        ))}
      </ol>
      <QuickAdd columnId={column.id} />
    </div>
  );
}

function ColumnMenu({
  column,
  state,
  isInbox,
  onClose,
  onConfirm,
  toasts,
}: {
  column: { id: ColumnId; name: string; cardIds: CardId[] };
  state: PersistedState;
  isInbox: boolean;
  onClose: () => void;
  onConfirm: ColumnProps["onConfirm"];
  toasts: ToastApi;
}) {
  const storage = useStorageHandle();
  const menuRef = useRef<HTMLDivElement | null>(null);
  // toasts is consumed by the column-delete undo affordance
  // below; the reference here is intentional.

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  // Only allow deletion if the column has zero cards and is not
  // the Inbox column. This keeps the "every column has at least
  // one card to drag" mental model and matches the reducer's
  // safety net.
  const canDelete = !isInbox && column.cardIds.length === 0;
  // And only if it's not the last column of the only board.
  const onlyBoard = state.boards.length === 1;
  const owningBoard = state.boards.find((b) => b.columnIds.includes(column.id));
  const lastColumnOfOnlyBoard =
    onlyBoard && owningBoard != null && owningBoard.columnIds.length <= 1;
  const finalCanDelete = canDelete && !lastColumnOfOnlyBoard;

  return (
    <div class="menu" ref={menuRef} role="menu">
      <button
        class="menu__item"
        type="button"
        role="menuitem"
        disabled={!finalCanDelete}
        title={
          isInbox
            ? "The Inbox column cannot be deleted."
            : column.cardIds.length > 0
              ? "Move or delete the cards in this column first."
              : lastColumnOfOnlyBoard
                ? "A board must have at least one column."
                : "Delete this column"
        }
        onClick={() => {
          onClose();
          onConfirm({
            title: `Delete column "${column.name}"?`,
            message:
              "The column will be removed. Cards in it have already been moved or deleted.",
            confirmLabel: "Delete column",
            danger: true,
            onConfirm: () => {
              // Phase 5: snapshot the column and its cards
              // so the toast's Undo button can re-insert
              // them. The owning board is whichever board
              // currently lists this column in columnIds.
              const cardIds = new Set(column.cardIds);
              const columnCards = state.cards
                .filter((c) => cardIds.has(c.id))
                .map((c) => ({ ...c, entries: [...c.entries] }));
              const owningBoard = state.boards.find((b) =>
                b.columnIds.includes(column.id),
              );
              const snapshot = {
                boardId: owningBoard?.id,
                column: { ...column, cardIds: [...column.cardIds] },
                cards: columnCards,
              };
              void storage.mutate({
                type: "delete-column",
                columnId: column.id,
              });
              if (snapshot.boardId) {
                toasts.push({
                  kind: "info",
                  text: `Column "${column.name}" deleted.`,
                  action: {
                    label: "Undo",
                    ariaLabel: `Undo delete column ${column.name}`,
                    onSelect: async () => {
                      await storage.mutate({
                        type: "restore-column",
                        boardId: snapshot.boardId!,
                        column: snapshot.column,
                        cards: snapshot.cards,
                      });
                    },
                  },
                });
              }
            },
          });
        }}
      >
        Delete column
      </button>
    </div>
  );
}

function QuickAdd({ columnId }: { columnId: ColumnId }) {
  const [value, setValue] = useState("");
  const storage = useStorageHandle();

  return (
    <form
      class="quickadd"
      onSubmit={async (e) => {
        e.preventDefault();
        const title = value.trim();
        if (!title) return;
        await storage.mutate({ type: "create-card", columnId, title });
        setValue("");
      }}
    >
      <input
        data-quickadd-input
        class="quickadd__input"
        type="text"
        placeholder="+ Add a card"
        value={value}
        onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue("");
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        aria-label="Quick add a card to this column"
      />
    </form>
  );
}
