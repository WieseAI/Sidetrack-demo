import type { PersistedState } from "../../shared/model";
import { formatDurationCompact, formatDurationLong } from "../../shared/format";
import {
  cardForRunning,
  runningCardTitle,
  runningLocation,
} from "../../shared/timer";
import { useTickingNow } from "../state/tick";
import { useTimerActions } from "../state/timer";

/**
 * Always-visible "running timer" bar.
 *
 * Brief: "The running timer is always visible somewhere prominent
 * in the sidepanel, including which task it belongs to and
 * elapsed time, even while I'm looking at a different board."
 *
 * When no timer is running, the bar renders nothing (zero chrome
 * when idle). When a timer is running, the bar shows:
 *
 *   [board › column]  card title   ⏱ 01:23:45   [Stop]
 *
 * The bar is sticky to the top of the sidepanel so it stays
 * visible while the user scrolls horizontally through columns.
 * The elapsed time is recomputed every second from the persisted
 * `startedAt` (D-04), not accumulated.
 */

export function RunningTimerBar({ state }: { state: PersistedState }) {
  const now = useTickingNow();
  const timer = state.runningTimer;
  if (!timer) return null;
  const live = cardForRunning(state);
  if (!live) return null;
  const elapsed = Math.max(0, now - timer.startedAt);
  const location = runningLocation(state);
  const title = runningCardTitle(state);
  const actions = useTimerActions();
  return (
    <aside
      class="running-bar"
      role="status"
      aria-live="polite"
      data-testid="running-timer-bar"
    >
      <div class="running-bar__left">
        <span class="running-bar__dot" aria-hidden="true" />
        <div class="running-bar__meta">
          {location ? (
            <div class="running-bar__location">
              <span class="running-bar__board">{location.boardName}</span>
              <span class="running-bar__sep" aria-hidden="true">
                ›
              </span>
              <span class="running-bar__column">{location.columnName}</span>
            </div>
          ) : null}
          <div class="running-bar__title" title={title ?? ""}>
            {title ?? "(deleted card)"}
          </div>
        </div>
      </div>
      <div class="running-bar__right">
        <span
          class="running-bar__elapsed"
          aria-label={`Elapsed time ${formatDurationLong(elapsed)}`}
        >
          {formatDurationCompact(elapsed)}
        </span>
        <button
          class="btn btn--small btn--ghost"
          type="button"
          onClick={async () => {
            await actions.stop();
          }}
          aria-label="Stop the running timer"
        >
          Stop
        </button>
      </div>
    </aside>
  );
}
