import { useEffect, useState } from "preact/hooks";
import type { PersistedState } from "../../shared/model";

/**
 * First-run onboarding overlay.
 *
 * Brief AC #1: "Fresh install → I understand and can use the
 * board within 30 seconds, no docs." The overlay is a small
 * panel that names the three primary affordances the user
 * should discover on day one: quick-add, the timer button,
 * and the Inbox column. The overlay is dismissed by:
 *
 *   - clicking "Get started"
 *   - pressing Enter or Escape
 *
 * Dismissal is persisted in `localStorage` (not the persisted
 * state) so it does not pollute the export shape. The
 * sidepanel reads the dismissal flag on every render and
 * hides the overlay if it is set.
 *
 * The overlay is rendered *above* the sidepanel's main
 * content, not as a modal. The user can see the board
 * behind it; the panel just points at three things in the
 * layout. This is intentional: a full modal would block
 * the user from interacting with the board (and we want
 * them to feel the kanban is usable the moment they open
 * the sidepanel).
 *
 * "Is it a first run?" is decided by `state.createdAt`. If
 * the timestamp is within the last five minutes of wall
 * clock, the user is on their first run (the seeded board
 * was just created). Five minutes is a generous window:
 * the user might click the toolbar, the sidepanel opens,
 * and they read the overlay for a moment before clicking
 * "Get started."
 */

const DISMISS_KEY = "sidetrack.onboardingDismissed.v1";
const FIRST_RUN_WINDOW_MS = 5 * 60 * 1000;

export interface OnboardingOverlayProps {
  state: PersistedState;
}

function isDismissed(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function markDismissed(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // localStorage can throw under storage pressure or in
    // private mode; the overlay just re-appears next time,
    // which is fine.
  }
}

export function OnboardingOverlay({ state }: OnboardingOverlayProps) {
  const [dismissed, setDismissed] = useState<boolean>(isDismissed);
  // Recompute on each render: the parent re-renders the
  // overlay when the persisted state changes (e.g. after a
  // fresh storage load), and we want the dismissal flag to
  // be re-read.
  const visible = !dismissed && isFirstRun(state);
  if (!visible) return null;

  function dismiss() {
    markDismissed();
    setDismissed(true);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        dismiss();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <aside
      class="onboarding"
      role="region"
      aria-label="Welcome to Sidetrack"
      data-testid="onboarding-overlay"
    >
      <div class="onboarding__panel">
        <h2 class="onboarding__title">Welcome to Sidetrack</h2>
        <p class="onboarding__lede">
          A kanban board with a per-card timer, all in the
          Chrome sidepanel. Three things to try first:
        </p>
        <ol class="onboarding__steps">
          <li class="onboarding__step">
            <span class="onboarding__step-kbd" aria-hidden="true">
              <kbd>Alt</kbd>
              <span>+</span>
              <kbd>Shift</kbd>
              <span>+</span>
              <kbd>A</kbd>
            </span>
            <div>
              <strong>Quick-add</strong>
              <p>
                Press the chord to focus the quick-add input on
                the column you're looking at. Type a title and
                hit <kbd>Enter</kbd>.
              </p>
            </div>
          </li>
          <li class="onboarding__step">
            <span class="onboarding__step-icon" aria-hidden="true">
              ▶
            </span>
            <div>
              <strong>Start a timer</strong>
              <p>
                Click the play button on any card. Start a
                timer on a different card to stop the previous
                one — Sidetrack will let you know.
              </p>
            </div>
          </li>
          <li class="onboarding__step">
            <span class="onboarding__step-icon" aria-hidden="true">
              📥
            </span>
            <div>
              <strong>The Inbox column</strong>
              <p>
                Right-click any page in Chrome and pick "Add
                to Sidetrack" to capture the page title and
                URL into the Inbox.
              </p>
            </div>
          </li>
        </ol>
        <p class="onboarding__hint">
          Drag any card to reorder it. Press <kbd>?</kbd> in
          the sidepanel to see all keyboard shortcuts.
        </p>
        <div class="onboarding__actions">
          <button
            class="btn btn--primary"
            type="button"
            onClick={dismiss}
            data-testid="onboarding-dismiss"
            aria-label="Dismiss the welcome panel"
          >
            Get started
          </button>
        </div>
      </div>
    </aside>
  );
}

/**
 * Has the user been on this install for less than the first-run
 * window? Pure: caller passes the persisted state. The window
 * is wall-clock-relative; if the user opens the sidepanel a
 * week after install, the overlay stays dismissed.
 */
function isFirstRun(state: PersistedState): boolean {
  if (!state.createdAt) return false;
  const age = Date.now() - state.createdAt;
  return age >= 0 && age < FIRST_RUN_WINDOW_MS;
}
