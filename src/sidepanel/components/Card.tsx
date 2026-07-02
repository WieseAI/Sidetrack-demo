import { useDraggable } from "@dnd-kit/core";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Card, PersistedState } from "../../shared/model";
import { formatDurationCompact, formatDueDate, totalTrackedMs } from "../../shared/format";
import { useStorageHandle } from "../state/storage";

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
}

export function CardView({ card, state, onOpen, ghost, isDragging }: CardProps) {
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
  const totalMs = totalTrackedMs(card.entries);
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
      class={`card${dragging ? " card--dragging" : ""}${ghost ? " card--ghost" : ""}`}
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
        <span class="card__chip card__chip--time" title="Total tracked time">
          ⏱ {formatDurationCompact(totalMs)}
        </span>
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
}: {
  state: PersistedState;
  card: Card;
  position: { x: number; y: number };
  onClose: () => void;
  onMove: (columnId: string) => void;
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
          onClick={async () => {
            await storage.mutate({ type: "delete-card", cardId: card.id });
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
