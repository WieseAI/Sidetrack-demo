import { PROJECT_NAME, VERSION } from "../shared/version";

/**
 * Phase 0 empty state.
 *
 * Per D-12 and the Phase 0 issue's acceptance criteria, the sidepanel
 * shows a styled empty state with the project name and version on
 * first open. There are no user-visible features beyond this. Phase 1
 * replaces this with the board picker and the default board.
 */
export function App() {
  return (
    <main class="app" aria-label={`${PROJECT_NAME} sidepanel`}>
      <header class="app__header">
        <h1 class="app__title">{PROJECT_NAME}</h1>
        <span class="app__version" aria-label={`version ${VERSION}`}>
          v{VERSION}
        </span>
      </header>
      <section class="empty-state" role="status">
        <p class="empty-state__line">No boards yet.</p>
        <p class="empty-state__line empty-state__line--muted">
          Phase 1 will add the default board (Backlog, In Progress, Done).
        </p>
      </section>
      <footer class="app__footer">
        <kbd>Alt</kbd>
        <span>+</span>
        <kbd>Shift</kbd>
        <span>+</span>
        <kbd>S</kbd>
        <span class="app__footer-label">open this panel</span>
      </footer>
    </main>
  );
}
