import { useMemo, useState } from "preact/hooks";
import type { CardId, PersistedState } from "../../shared/model";
import {
  computeReport,
  reportRangeLabel,
  type ReportRange,
  type ReportRow,
  type ReportBoardRow,
} from "../../shared/reports";
import { formatDurationCompact, formatDurationLong } from "../../shared/format";
import { useTickingNow } from "../state/tick";

/**
 * Time report view.
 *
 * Phase 4 ships "Today" and "This week" reports answering
 * the brief's "where did my time go today / this week?"
 * question. The data is computed by the pure helper in
 * `src/shared/reports.ts`; this component is a thin
 * presentation layer over it.
 *
 * Layout:
 *
 *   [Today] [This week]                <range selector>
 *
 *   <board rollup>                    <empty state or per-board list>
 *
 *   <per-task list>                   <rows: title, duration, bar>
 *
 * Clicking a row opens the card's detail dialog and
 * switches the active board to the card's board (so the
 * "click a row to jump to that card" acceptance criterion
 * lands the user on the right card, not on the same board
 * they were looking at before).
 */

export interface ReportViewProps {
  state: PersistedState;
  onOpenCard: (cardId: CardId, boardId: string) => void;
}

export function ReportView({ state, onOpenCard }: ReportViewProps) {
  // Default to "today" — it's the most-asked question.
  const [range, setRange] = useState<ReportRange>("today");
  // The report re-renders every second while a timer is
  // running (an open entry contributes live time to the
  // range it's currently intersecting). When no timer is
  // running, the `useTickingNow` subscription still ticks
  // but the data is stable.
  const now = useTickingNow();
  const report = useMemo(
    () => computeReport(state, range, now),
    [state, range, now],
  );

  return (
    <section class="report" aria-label="Time report">
      <header class="report__header">
        <div class="report__tabs" role="tablist" aria-label="Report range">
          {(["today", "this-week"] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={r === range}
              class={`report__tab${r === range ? " report__tab--active" : ""}`}
              onClick={() => setRange(r)}
              data-testid={`report-tab-${r}`}
            >
              {reportRangeLabel(r)}
            </button>
          ))}
        </div>
        <div class="report__total" aria-live="polite">
          <span class="report__total-label">Total</span>
          <span class="report__total-value" data-testid="report-total">
            {formatDurationLong(report.totalMs)}
          </span>
          <span class="report__total-compact">
            {formatDurationCompact(report.totalMs)}
          </span>
        </div>
      </header>

      {report.hasAny ? (
        <>
          <BoardRollup rows={report.perBoard} totalMs={report.totalMs} />
          <TaskList
            rows={report.perTask}
            totalMs={report.totalMs}
            state={state}
            onOpenCard={onOpenCard}
          />
        </>
      ) : (
        <ReportEmpty range={range} />
      )}
    </section>
  );
}

function BoardRollup({
  rows,
  totalMs,
}: {
  rows: ReportBoardRow[];
  totalMs: number;
}) {
  if (rows.length === 0) return null;
  return (
    <div class="report__board-rollup" aria-label="Per-board totals">
      <h3 class="report__section-title">By board</h3>
      <ul class="report__board-list" role="list">
        {rows.map((b) => (
          <li key={b.boardId} class="report__board-row">
            <span class="report__board-name">{b.boardName}</span>
            <span
              class="report__board-bar"
              aria-hidden="true"
            >
              <span
                class="report__board-bar-fill"
                style={{ width: `${(b.share * 100).toFixed(1)}%` }}
              />
            </span>
            <span class="report__board-duration">
              {formatDurationCompact(b.totalMs)}
            </span>
            <span class="report__board-share">
              {totalMs > 0
                ? `${((b.share * 100).toFixed(0))}%`
                : "0%"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TaskList({
  rows,
  totalMs,
  state,
  onOpenCard,
}: {
  rows: ReportRow[];
  totalMs: number;
  state: PersistedState;
  onOpenCard: (cardId: CardId, boardId: string) => void;
}) {
  return (
    <div class="report__tasks">
      <h3 class="report__section-title">By card</h3>
      <ul class="report__task-list" role="list">
        {rows.map((r) => {
          const card = state.cards.find((c) => c.id === r.cardId);
          const column = card
            ? state.columns.find((c) => c.cardIds.includes(card.id))
            : undefined;
          const board = column
            ? state.boards.find((b) => b.columnIds.includes(column.id))
            : undefined;
          return (
            <li key={r.cardId} class="report__task-row">
              <button
                type="button"
                class="report__task-button"
                onClick={() => {
                  if (board) onOpenCard(r.cardId, board.id);
                }}
                data-testid={`report-task-${r.cardId}`}
                title={board ? `Open on ${board.name}` : "Open card"}
              >
                <span class="report__task-title">{r.cardTitle}</span>
                {column ? (
                  <span class="report__task-location">
                    {board?.name ? `${board.name} › ` : ""}
                    {column.name}
                  </span>
                ) : null}
                <span
                  class="report__task-bar"
                  aria-hidden="true"
                >
                  <span
                    class="report__task-bar-fill"
                    style={{ width: `${(r.share * 100).toFixed(1)}%` }}
                  />
                </span>
                <span class="report__task-duration">
                  {formatDurationCompact(r.totalMs)}
                </span>
                <span class="report__task-share">
                  {totalMs > 0
                    ? `${((r.share * 100).toFixed(0))}%`
                    : "0%"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReportEmpty({ range }: { range: ReportRange }) {
  return (
    <div class="report__empty" role="status">
      <p class="report__empty-line">
        No tracked time {range === "today" ? "today" : "this week"} yet.
      </p>
      <p class="report__empty-hint">
        Start a timer on any card to see it show up here.
      </p>
    </div>
  );
}
