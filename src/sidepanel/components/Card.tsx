import { useDraggable } from "@dnd-kit/core";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Card, PersistedState } from "../../shared/model";
import { formatDueDate } from "../../shared/format";
import { isRunningOn } from "../../shared/timer";
import { useStorageHandle } from "../state/storage";
import { TimerButton } from "./TimerButton";
import type { ToastApi } from "../state/toasts";

/**
 * Card view.
 *
 * Displays the card's title, an optional description preview, the
 * due date, and the total tracked time. The whole card is
 * draggable via @dnd-kit. Clicking the card opens the detail
 * dialog; right-clicking (or the menu button on touch) opens a
 * context menu with rename / move / delete.
 *
 * Phase 1 has no timer yet, so the time chip just shows
 * "0m tracked" (the brief's placeholder copy). Phase 2 replaces
 * the chip with a real start/stop button.
 */

export interface CardProps {
  card: Card;
  state: PersistedState;
  /** Click handler — opens the detail dialog. */
  onOpen?: () => void;
  /** Render as a drag ghost (slightly transparent, no events). */
  ghost?: boolean;
  /** When true, the card is being dragged; we render a cursor and
   *  disable interactions. */
  isDragging?: boolean;
  /** Phase 5: toast API for the "card deleted" undo affordance. */
  toasts: ToastApi;
}

export function CardView({ card, state, onOpen, ghost, isDragging, toasts }: CardProps) {
  // dnd-kit injects `role="button"` and `tabIndex={0}` into the
  // draggable's `attributes`. We let it — its defaults are exactly
  // what we want — and just spread them into the underlying div.
  const { attributes, listeners, setNodeRef, isDragging: dndDragging } =
    useDraggable({ id: card.id });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const storage = useStorageHandle();

  useEffect(() => {
    if (!menu) return;
    function close() {
      setMenu(null);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const dragging = isDragging || dndDragging;
  const running = isRunningOn(state, card.id);
  const due = formatDueDate(card.dueDate);

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  async function moveToColumn(columnId: string) {
    const col = state.columns.find((c) => c.id === columnId);
    if (!col) return;
    await storage.mutate({
      type: "move-card",
      cardId: card.id,
      toColumnId: col.id,
      toIndex: col.cardIds.length,
    });
  }

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        cardRef.current = el;
      }}
      class={`card${dragging ? " card--dragging" : ""}${ghost ? " card--ghost" : ""}${running ? " card--running" : ""}`}
      {...(attributes as unknown as Record<string, unknown>)}
      role="button"
      tabIndex={0}
      aria-label={`Card: ${card.title}`}
      onClick={(e) => {
        // Suppress the click that follows a drag (dnd-kit fires
        // click after pointerup with no movement, but our
        // activation distance of 5px is well above the click
        // threshold, so this is just belt-and-braces).
        if (dragging) return;
        // Don't open on a click that started on the menu
        // button (it has its own click handler).
        const target = e.target as HTMLElement;
        if (target.closest("[data-card-menu-button]")) return;
        onOpen?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.();
        }
      }}
      onContextMenu={handleContextMenu}
      {...listeners}
    >
      <div class="card__body">
        <h3 class="card__title">{card.title}</h3>
        {card.description ? (
          <p class="card__description">{truncate(card.description, 120)}</p>
        ) : null}
      </div>
      <footer class="card__meta">
        {due ? <span class="card__chip card__chip--date">📅 {due}</span> : null}
        <TimerButton state={state} card={card} />
        <button
          class="btn btn--icon card__menu-button"
          type="button"
          data-card-menu-button
          aria-label="Card actions"
          aria-haspopup="menu"
          onClick={(e) => {
            e.stopPropagation();
            const rect = cardRef.current?.getBoundingClientRect();
            setMenu({
              x: rect ? rect.left + rect.width - 8 : 0,
              y: rect ? rect.bottom : 0,
            });
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          ⋯
        </button>
      </footer>
      {menu ? (
        <CardMenu
          state={state}
          card={card}
          position={menu}
          onClose={() => setMenu(null)}
          onMove={moveToColumn}
          toasts={toasts}
        />
      ) : null}
    </div>
  );
}

function CardMenu({
  state,
  card,
  position,
  onClose,
  onMove,
  toasts,
}: {
  state: PersistedState;
  card: Card;
  position: { x: number; y: number };
  onClose: () => void;
  onMove: (columnId: string) => void;
  toasts: ToastApi;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const storage = useStorageHandle();
  const [showConfirm, setShowConfirm] = useState(false);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);
  // Where is the card currently? Filter it out of the move list.
  const sourceColumnId = state.columns.find((c) => c.cardIds.includes(card.id))?.id;
  const inbox = state.boards.find((b) => b.inboxColumnId)?.inboxColumnId;
  if (showConfirm) {
    return (
      <div
        ref={ref}
        class="menu menu--card"
        role="menu"
        style={{
          position: "fixed",
          left: `${position.x}px`,
          top: `${position.y}px`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="menu__section-title">Delete card?</div>
        <p class="menu__message">" {card.title} " will be removed.</p>
        <button
          class="menu__item menu__item--danger"
          type="button"
          role="menuitem"
          data-testid="card-menu-confirm-delete"
          onClick={async () => {
            // Phase 5: snapshot the card + its source column /
            // index before the delete so the toast's Undo
            // button can re-insert it in the right place.
            const sourceColumn = state.columns.find((c) =>
              c.cardIds.includes(card.id),
            );
            const snapshot = {
              card: { ...card, entries: [...card.entries] },
              columnId: sourceColumn?.id ?? state.columns[0]!.id,
              index: sourceColumn
                ? sourceColumn.cardIds.indexOf(card.id)
                : 0,
            };
            await storage.mutate({ type: "delete-card", cardId: card.id });
            toasts.push({
              kind: "info",
              text: `Card "${card.title}" deleted.`,
              action: {
                label: "Undo",
                ariaLabel: `Undo delete card ${card.title}`,
                onSelect: async () => {
                  await storage.mutate({
                    type: "restore-card",
                    card: snapshot.card,
                    columnId: snapshot.columnId as never,
                    index: snapshot.index,
                  });
                },
              },
            });
            onClose();
          }}
        >
          Delete
        </button>
        <button
          class="menu__item"
          type="button"
          role="menuitem"
          onClick={() => setShowConfirm(false)}
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div
      ref={ref}
      class="menu menu--card"
      role="menu"
      style={{
        position: "fixed",
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div class="menu__section-title">Move to…</div>
      {state.columns
        .filter((c) => c.id !== sourceColumnId)
        .map((c) => (
          <button
            key={c.id}
            class="menu__item"
            type="button"
            role="menuitem"
            onClick={() => {
              onMove(c.id);
              onClose();
            }}
          >
            {c.name}
            {c.id === inbox ? " (Inbox)" : ""}
          </button>
        ))}
      <hr class="menu__separator" />
      <button
        class="menu__item menu__item--danger"
        type="button"
        role="menuitem"
        onClick={() => setShowConfirm(true)}
      >
        Delete card…
      </button>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
