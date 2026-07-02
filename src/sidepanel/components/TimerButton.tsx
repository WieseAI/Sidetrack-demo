import type { Card, PersistedState } from "../../shared/model";
import { isRunningOn } from "../../shared/timer";
import { useTimerActions } from "../state/timer";
import { useTickingNow } from "../state/tick";
import { totalWithRunning } from "../../shared/timer";
import { formatDurationCompact } from "../../shared/format";

/**
 * Start / stop button + live total.
 *
 * The button is the brief's "one click to start, one click to
 * stop" surface. The total updates every second via
 * `useTickingNow()`; the underlying value is always
 * `now - startedAt` for the running entry plus the sum of
 * closed entries (D-04, no accumulated tick).
 *
 * The whole component is small enough to live next to the card
 * body. It does not own its own state: the source of truth is
 * `state.runningTimer` and `card.entries`, both of which the
 * parent re-renders on every storage change.
 */
export function TimerButton({
  state,
  card,
}: {
  state: PersistedState;
  card: Card;
}) {
  const actions = useTimerActions();
  const now = useTickingNow();
  const running = isRunningOn(state, card.id);
  const total = totalWithRunning(card, state.runningTimer, now);
  return (
    <div class="card__timer" data-running={running ? "true" : "false"}>
      <button
        class={`btn btn--icon card__timer-button${running ? " card__timer-button--running" : ""}`}
        type="button"
        data-card-timer-button
        data-testid={`timer-button-${card.id}`}
        aria-label={running ? `Stop the timer on ${card.title}` : `Start a timer on ${card.title}`}
        aria-pressed={running}
        onClick={async (e) => {
          e.stopPropagation();
          if (running) {
            await actions.stop();
          } else {
            await actions.start(card.id);
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {running ? (
          <span class="card__timer-icon" aria-hidden="true">
            ■
          </span>
        ) : (
          <span class="card__timer-icon" aria-hidden="true">
            ▶
          </span>
        )}
      </button>
      <span
        class="card__chip card__chip--time"
        title={running ? "Live tracked time" : "Total tracked time"}
      >
        {running ? "● " : ""}
        {formatDurationCompact(total)}
      </span>
    </div>
  );
}
