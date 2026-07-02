import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { PersistedState } from "../../shared/model";
import type { BoardId, CardId, ColumnId } from "../../shared/model";
import { ColumnView } from "./Column";
import { CardView } from "./Card";
import { useStorageHandle } from "../state/storage";
import type { ToastApi } from "../state/toasts";
import { announce } from "./LiveAnnouncer";

/**
 * Board view: a horizontal flexbox of columns wrapped in a
 * `DndContext` for drag-and-drop. The context owns the active
 * drag id and a `DragOverlay` that renders a ghost copy of the
 * dragged card (so the card itself doesn't have to re-render
 * while the user is dragging).
 *
 * Drops are translated into `move-card` actions on the storage
 * handle. The optimistic update is implicit: the storage handle
 * re-emits the new state via `subscribe`, so the next render of
 * the board shows the card in its new position.
 */

export interface BoardProps {
  state: PersistedState;
  boardId: BoardId;
  onOpenCard: (cardId: CardId) => void;
  onConfirm: (opts: {
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => void;
  }) => void;
  onError: (msg: string) => void;
  /** Phase 5: toast API for undo affordances on destructive actions. */
  toasts: ToastApi;
}

export function Board({
  state,
  boardId,
  onOpenCard,
  onConfirm,
  onError,
  toasts,
}: BoardProps) {
  const board = state.boards.find((b) => b.id === boardId);
  const storage = useStorageHandle();

  // Active drag id is a card id. The overlay renders a copy of
  // the card with reduced opacity so the user can see what's
  // being moved.
  const [activeCardId, setActiveCardId] = useState<CardId | null>(null);

  // Pointer sensor with a small activation distance so click
  // events on cards (which open the detail dialog) still work.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      // Use Space to start a card drag; Enter is reserved for
      // the card-level 'open dialog' action. The global
      // window-level handleKeyDown in dnd-kit still ends the
      // drag on Enter once a drag is in progress, so the
      // experience is consistent.
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space", "Enter", "Tab"],
      },
    }),
  );

  // We track which column each card currently lives in so the
  // drag handler can compute the source column from the active
  // drag id without re-walking the state on every drag tick.
  const cardToColumn = useMemo(() => {
    const map = new Map<CardId, ColumnId>();
    for (const col of state.columns) {
      for (const cardId of col.cardIds) {
        map.set(cardId, col.id);
      }
    }
    return map;
  }, [state.columns]);

  if (!board) {
    return (
      <section class="board board--missing" role="status">
        <p>Board not found.</p>
      </section>
    );
  }

  const orderedColumns = board.columnIds
    .map((id) => state.columns.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  function onDragStart(event: DragStartEvent) {
    const id = event.active.id;
    if (typeof id === "string") {
      setActiveCardId(id as CardId);
      const card = state.cards.find((c) => c.id === id);
      if (card) announce(`Picked up card ${card.title}.`);
    }
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveCardId(null);
    const { active, over } = event;
    if (!over) {
      announce("Drag cancelled.");
      return;
    }
    const cardId = active.id as CardId;
    const overId = over.id as string;

    // We accept two drop targets:
    //   - a column id: append to the end
    //   - a card id: insert at that card's index
    let toColumnId: ColumnId;
    let toIndex: number;
    const asColumn = state.columns.find((c) => c.id === overId);
    if (asColumn) {
      toColumnId = asColumn.id;
      toIndex = asColumn.cardIds.length;
    } else {
      const overCardId = overId as CardId;
      const overColId = cardToColumn.get(overCardId);
      if (!overColId) return;
      toColumnId = overColId;
      const col = state.columns.find((c) => c.id === overColId)!;
      toIndex = col.cardIds.indexOf(overCardId);
      if (toIndex < 0) toIndex = col.cardIds.length;
    }

    const fromColumnId = cardToColumn.get(cardId);
    if (!fromColumnId) return;

    try {
      await storage.mutate({
        type: "move-card",
        cardId,
        toColumnId,
        toIndex,
      });
      const destCol = state.columns.find((c) => c.id === toColumnId);
      const card = state.cards.find((c) => c.id === cardId);
      if (destCol && card) {
        announce(`Moved ${card.title} to ${destCol.name}.`);
      }
    } catch (err) {
      onError((err as Error).message);
    }
  }

  const activeCard = activeCardId
    ? state.cards.find((c) => c.id === activeCardId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveCardId(null)}
    >
      <section class="board" aria-label={`Board: ${board.name}`}>
        <div class="board__columns" role="list">
          {orderedColumns.map((column) => (
            <ColumnView
              key={column.id}
              state={state}
              column={column}
              isInbox={board.inboxColumnId === column.id}
              onOpenCard={onOpenCard}
              onConfirm={onConfirm}
              toasts={toasts}
            />
          ))}
          <AddColumn boardId={boardId} />
        </div>
      </section>
      <DragOverlay>
        {activeCard ? <CardView card={activeCard} state={state} ghost toasts={toasts} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function AddColumn({ boardId }: { boardId: BoardId }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const storage = useStorageHandle();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <div class="column column--add" role="listitem">
        <button
          class="btn btn--ghost column__add-button"
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Add a new column"
        >
          + Add column
        </button>
      </div>
    );
  }

  return (
    <form
      class="column column--add column--add-editing"
      role="listitem"
      onSubmit={async (e) => {
        e.preventDefault();
        const name = value.trim();
        if (!name) {
          setEditing(false);
          setValue("");
          return;
        }
        await storage.mutate({
          type: "create-column",
          boardId,
          name,
        });
        setValue("");
        setEditing(false);
      }}
    >
      <input
        ref={inputRef}
        class="column__name-input"
        type="text"
        placeholder="Column name"
        value={value}
        onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
        onBlur={() => {
          if (!value.trim()) setEditing(false);
        }}
        aria-label="New column name"
      />
    </form>
  );
}
