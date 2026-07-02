import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { PROJECT_NAME, VERSION } from "../shared/version";
import { usePersistedState, useStorageHandle as useStorageHandleLocal } from "./state/storage";
import { exportToJson, defaultExportFilename, importFromJson } from "../shared/io";
import { Board } from "./components/Board";
import { BoardPicker } from "./components/BoardPicker";
import { CardDialog } from "./components/CardDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { IdlePromptDialog, type IdleChoice } from "./components/IdlePromptDialog";
import { RunningTimerBar } from "./components/RunningTimerBar";
import { SettingsDialog } from "./components/SettingsDialog";
import { Toast } from "./components/Toast";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { ReportView } from "./components/ReportView";
import { OnboardingOverlay } from "./components/OnboardingOverlay";
import { useToasts } from "./state/toasts";
import { useDialogStack } from "./state/dialogs";
import {
  dismissIdlePrompt,
  setIdlePrompt,
  trimTimer,
  trimTimerAndStop,
} from "../shared/timer-actions";
import { isPromptStale } from "../shared/idle";
import { formatDurationLong } from "../shared/format";
import type { BoardId, CardId, IdlePrompt, PersistedState } from "../shared/model";
import { resolveTheme } from "../shared/theme";


/**
 * Top-level sidepanel component.
 *
 * Owns:
 *   - the active board id (defaults to the first board)
 *   - the dialog stack (card details, confirmations)
 *   - the toast queue (transient feedback for "saved", "deleted", …)
 *   - the import-from-file input (a hidden <input type="file">)
 *
 * The state, dialog, and toast modules are local to the sidepanel
 * (no chrome.* APIs); everything chrome-specific lives in
 * `state/storage.ts`.
 */
export function App() {
  const state = usePersistedState();
  const toasts = useToasts();
  const dialogs = useDialogStack();

  // The "active" board is a UI concern. We default to the first
  // board; the picker writes the user's choice to localStorage so
  // it persists across sidepanel closes.
  const [activeBoardId, setActiveBoardId] = useState<BoardId | null>(null);

  // Phase 4 — the active view. "board" is the kanban, "reports"
  // is the time report. The Header has a small tab strip to
  // switch between them. Default is "board" so the first-run
  // UX is unchanged from Phase 1.
  type View = "board" | "reports";
  const [view, setView] = useState<View>("board");

  // Initialize the active board once state is loaded.
  useEffect(() => {
    if (!state) return;
    if (activeBoardId) return;
    const remembered = readRememberedBoard();
    if (remembered && state.boards.some((b) => b.id === remembered)) {
      setActiveBoardId(remembered);
    } else if (state.boards[0]) {
      setActiveBoardId(state.boards[0].id);
    }
  }, [state, activeBoardId]);

  // Persist active board id whenever it changes.
  useEffect(() => {
    if (activeBoardId) writeRememberedBoard(activeBoardId);
  }, [activeBoardId]);

  // Brief AC #4: when starting a timer on a new card automatically
  // stops the previous one, inform the user. We detect the swap
  // by watching the running timer's cardId and pushing a toast
  // if it changes to a non-null value AND the previous one was
  // also non-null. The reducer is the only writer; the toasts
  // are visual only.
  const prevTimerCardRef = useRef<CardId | null>(null);
  useEffect(() => {
    if (!state) return;
    const current = state.runningTimer?.cardId ?? null;
    const prev = prevTimerCardRef.current;
    prevTimerCardRef.current = current;
    if (current && prev && current !== prev) {
      const prevCard = state.cards.find((c) => c.id === prev);
      toasts.push({
        kind: "info",
        text: `Timer stopped on "${prevCard?.title ?? "previous card"}"`,
      });
    }
  }, [state?.runningTimer?.cardId, state, toasts]);

  // Phase 4 — listen for capture notifications from the
  // service worker. The SW sends `{ type: "card-captured",
  // cardId, title }` after a successful right-click
  // "Add to Sidetrack" (D-07). We surface a toast so the
  // user sees a confirmation without having to open the
  // Inbox. The sidepanel may not be open when the capture
  // happens; in that case the message is dropped silently
  // (the OS notification handles that case; see
  // `src/background/capture.ts`).
  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
    const listener = (
      message: unknown,
      _sender: unknown,
      _sendResponse: (resp: unknown) => void,
    ) => {
      if (!message || typeof message !== "object") return;
      const m = message as { type?: unknown; cardId?: unknown; title?: unknown };
      if (m.type === "card-captured" && typeof m.title === "string") {
        const cardId = typeof m.cardId === "string" ? m.cardId : "";
        toasts.push({
          kind: "success",
          text: `Captured: "${m.title.length > 60 ? `${m.title.slice(0, 59)}…` : m.title}"`,
        });
        if (cardId) {
          // Switch to the board that owns the new card and
          // open its detail dialog. The user gets a
          // single-click path from "right-click on a page"
          // to "looking at the card in Sidetrack".
          const ownedCard = state?.cards.find((c) => c.id === cardId);
          const ownedColumn = ownedCard
            ? state?.columns.find((c) => c.cardIds.includes(ownedCard.id))
            : undefined;
          const ownedBoard = ownedColumn
            ? state?.boards.find((b) => b.columnIds.includes(ownedColumn.id))
            : undefined;
          if (ownedBoard) setActiveBoardId(ownedBoard.id);
          if (cardId) dialogs.push({ kind: "card", cardId: cardId as CardId });
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      try {
        chrome.runtime.onMessage.removeListener(listener);
      } catch {
        // ignore
      }
    };
  }, [state, toasts, dialogs]);

  // Phase 3 — R-03 cold-start gap detection.
  //
  // When the sidepanel opens, the persisted state may already
  // have a `pendingIdlePrompt` (the SW set it while we were
  // closed, R-02) or the gap since `lastSeenActive` may be
  // large enough to warrant one (R-03 — "browser was closed").
  //
  // We delegate the *detection* to the pure helper in
  // `src/shared/idle.ts` and the *write* to the SW via a
  // runtime message; the SW owns the timer-side write
  // (D-06). The resolution (Keep/Trim/Stop) is handled in
  // the `resolveIdleChoice` callback below.
  //
  // We also clear any stale prompt whose entryId no longer
  // matches an open entry (defensive: shouldn't happen in
  // practice, but the idle detector depends on the prompt
  // pointing at a live entry).
  const hasBootstrappedRef = useRef(false);
  useEffect(() => {
    if (!state) return;
    if (hasBootstrappedRef.current) return;
    hasBootstrappedRef.current = true;
    if (state.pendingIdlePrompt) {
      if (isPromptStale(state, state.pendingIdlePrompt)) {
        void setIdlePrompt(useStorageHandleLocal(), undefined);
      } else {
        toasts.push({
          kind: "info",
          text: `Idle prompt pending: ${formatDurationLong(state.pendingIdlePrompt.idleForMs)} on "${state.cards.find((c) => c.id === state.pendingIdlePrompt!.cardId)?.title ?? "card"}"`,
        });
      }
    } else {
      // No pending prompt yet; the SW's 1-minute alarm tick
      // will create one if the running timer has crossed the
      // threshold while we were closed. We do not need to do
      // anything synchronously here — the dialog will appear
      // when the SW writes the prompt and our state hook
      // re-renders.
    }
  }, [state, toasts]);

  /**
   * Apply the user's idle-prompt choice. This is the
   * brief's keep/trim/stop UX wired to the reducer.
   * `onResolve` is called by `IdlePromptDialog` and
   * dispatches to the appropriate timer action.
   */
  const resolveIdleChoice = useCallback(
    async (prompt: IdlePrompt, choice: IdleChoice) => {
      const handle = useStorageHandleLocal();
      if (choice === "keep") {
        // Keep all: just clear the prompt. The running entry
        // stays open. We also touch the anchor so the next
        // alarm tick waits another full threshold before
        // re-prompting (the user just acknowledged).
        await dismissIdlePrompt(handle);
        await handle.mutate({ type: "touch-active", now: Date.now() });
        toasts.push({ kind: "info", text: "Kept all the time." });
      } else if (choice === "trim") {
        // Trim: retroactively close the current entry at
        // `lastSeenActive` and start a new one there.
        await trimTimer(handle, prompt.lastSeenActive);
        toasts.push({
          kind: "info",
          text: `Trimmed ${formatDurationLong(prompt.idleForMs)} of idle time.`,
        });
      } else {
        // Stop (and trim): single atomic action that closes
        // the running entry at `lastSeenActive` and clears
        // the running block. No new entry is opened because
        // the user picked Stop.
        await trimTimerAndStop(handle, prompt.lastSeenActive);
        toasts.push({
          kind: "info",
          text: `Trimmed idle time and stopped the timer.`,
        });
      }
      // Best-effort: clear the OS notification if we can.
      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: "clear-idle-notification" });
        }
      } catch {
        // The service worker may not be listening; that's fine.
      }
    },
    [toasts],
  );

  // Global keyboard shortcuts (Alt+Shift+A quick-add, etc.). The
  // D-17 chords are the manifest's `commands`, which the service
  // worker relays to the sidepanel via chrome.runtime messages.
  // For now we listen for keyboard events on the sidepanel itself;
  // the global command listener is wired up in Phase 2 when
  // start/stop-timer has user-visible behavior.
  // Phase 5: resolve the theme override against the OS
  // preference and apply it as a data-theme attribute on the
  // <main> element. CSS uses [data-theme=…] selectors
  // layered on top of prefers-color-scheme. We also subscribe
  // to the OS-level change so the bar follows the OS while
  // the user is on the "Follow system" override.
  const themeOverride = state?.settings.theme ?? "system";
  const effectiveTheme = resolveTheme(themeOverride);
  // Force a re-render when the OS theme changes while the
  // override is "system". The data-theme attribute is
  // computed at render time, so we need to re-render.
  const [, setSystemTick] = useState(0);
  useEffect(() => {
    if (themeOverride !== "system") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setSystemTick((n) => n + 1);
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    // Safari < 14 fallback.
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, [themeOverride]);
  return (
    <main class="app" data-theme={effectiveTheme} aria-label={`${PROJECT_NAME} sidepanel`}>
      <Header
        state={state}
        activeBoardId={activeBoardId}
        view={view}
        onSelectBoard={setActiveBoardId}
        onSelectView={setView}
        onOpenSettings={() => dialogs.push({ kind: "settings" })}
        toasts={toasts}
        onImport={async (text) => {
          try {
            const imported = importFromJson(text);
            // Validate + replace via the storage handle.
            const handle = useStorageHandleLocal();
            await handle.importState(imported);
            toasts.push({ kind: "info", text: "Import complete." });
          } catch (err) {
            toasts.push({
              kind: "error",
              text: `Import failed: ${(err as Error).message}`,
            });
          }
        }}
        onExport={async () => {
          const handle = useStorageHandleLocal();
          const json = exportToJson(await handle.exportState());
          downloadJson(defaultExportFilename(), json);
          toasts.push({ kind: "info", text: "Exported." });
        }}
      />
      {state && activeBoardId ? (
        view === "board" ? (
          <Board
            state={state}
            boardId={activeBoardId}
            onOpenCard={(cardId) =>
              dialogs.push({
                kind: "card",
                cardId,
              })
            }
            onConfirm={({ title, message, confirmLabel, danger, onConfirm }) =>
              dialogs.push({
                kind: "confirm",
                title,
                message,
                confirmLabel,
                danger,
                onConfirm,
              })
            }
            onError={(msg) => toasts.push({ kind: "error", text: msg })}
            toasts={toasts}
          />
        ) : (
          <ReportView
            state={state}
            onOpenCard={(cardId, boardId) => {
              setActiveBoardId(boardId as BoardId);
              setView("board");
              dialogs.push({ kind: "card", cardId });
            }}
          />
        )
      ) : (
        <Skeleton />
      )}
      {state && state.pendingIdlePrompt && state.pendingIdlePrompt.kind === "open" ? (
        <IdlePromptDialog
          state={state}
          prompt={state.pendingIdlePrompt}
          onResolve={async (choice) => {
            await resolveIdleChoice(state.pendingIdlePrompt!, choice);
          }}
        />
      ) : null}
      {state ? <RunningTimerBar state={state} /> : null}
      <Footer />
      <DialogRenderer state={state} dialogs={dialogs} toasts={toasts} />
      <Toast toasts={toasts} />
      {state ? <OnboardingOverlay state={state} /> : null}
      <KeyboardShortcuts
        onQuickAdd={() => {
          // The quick-add input is the most recently focused
          // column's input. We approximate by finding the first
          // column with a visible quick-add and focusing it. The
          // DndContext overlay doesn't capture keyboard events,
          // so a global listener is safe.
          const target = document.querySelector<HTMLInputElement>(
            "[data-quickadd-input]",
          );
          if (target) {
            target.focus();
            target.select();
          }
        }}
        onOpenSettings={() => dialogs.push({ kind: "settings" })}
      />
    </main>
  );
}

function Header(props: {
  state: PersistedState | null;
  activeBoardId: BoardId | null;
  view: "board" | "reports";
  onSelectBoard: (id: BoardId) => void;
  onSelectView: (v: "board" | "reports") => void;
  onImport: (text: string) => void | Promise<void>;
  onExport: () => void | Promise<void>;
  onOpenSettings: () => void;
  toasts: ReturnType<typeof useToasts>;
}) {
  const { state, activeBoardId, view, onSelectBoard, onSelectView, onImport, onExport, onOpenSettings, toasts } = props;
  return (
    <header class="app__header" role="banner">
      <h1 class="app__title">
        {state && activeBoardId ? (
          <BoardPicker
            state={state}
            activeBoardId={activeBoardId}
            onSelect={onSelectBoard}
            toasts={toasts}
          />
        ) : (
          PROJECT_NAME
        )}
      </h1>
      <div class="app__view-tabs" role="tablist" aria-label="View">
        <button
          type="button"
          role="tab"
          aria-selected={view === "board"}
          class={`app__view-tab${view === "board" ? " app__view-tab--active" : ""}`}
          onClick={() => onSelectView("board")}
          data-testid="view-tab-board"
        >
          Board
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "reports"}
          class={`app__view-tab${view === "reports" ? " app__view-tab--active" : ""}`}
          onClick={() => onSelectView("reports")}
          data-testid="view-tab-reports"
        >
          Reports
        </button>
      </div>
      <div class="app__header-actions">
        <ImportButton onImport={onImport} />
        <ExportButton onExport={onExport} />
        <SettingsButton onOpen={onOpenSettings} />
        <span class="app__version" aria-label={`version ${VERSION}`}>
          v{VERSION}
        </span>
      </div>
    </header>
  );
}

function ImportButton({
  onImport,
}: {
  onImport: (text: string) => void | Promise<void>;
}) {
  return (
    <label class="btn btn--ghost" title="Import from a Sidetrack JSON file">
      Import
      <input
        type="file"
        accept="application/json,.json"
        class="visually-hidden"
        onChange={async (e) => {
          const file = (e.currentTarget as HTMLInputElement).files?.[0];
          if (!file) return;
          const text = await file.text();
          await onImport(text);
          // Reset so the same file can be re-selected later.
          (e.currentTarget as HTMLInputElement).value = "";
        }}
      />
    </label>
  );
}

function ExportButton({
  onExport,
}: {
  onExport: () => void | Promise<void>;
}) {
  return (
    <button
      class="btn btn--ghost"
      type="button"
      onClick={() => onExport()}
      title="Export all data to a JSON file"
    >
      Export
    </button>
  );
}

function Skeleton() {
  return (
    <section class="empty-state" role="status" aria-busy="true">
      <p class="empty-state__line">Loading…</p>
    </section>
  );
}

function SettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      class="btn btn--ghost"
      type="button"
      title="Settings"
      onClick={onOpen}
      data-testid="settings-button"
      aria-label="Open settings"
    >
      Settings
    </button>
  );
}

function Footer() {
  return (
    <footer class="app__footer">
      <kbd>Alt</kbd>
      <span>+</span>
      <kbd>Shift</kbd>
      <span>+</span>
      <kbd>A</kbd>
      <span class="app__footer-label">quick-add</span>
    </footer>
  );
}

function DialogRenderer({
  state,
  dialogs,
  toasts,
}: {
  state: PersistedState | null;
  dialogs: ReturnType<typeof useDialogStack>;
  toasts: ReturnType<typeof useToasts>;
}) {
  // Render the top dialog. The dialog stack lives in `state/dialogs`
  // and is independent of the persisted state.
  const top = dialogs.stack[dialogs.stack.length - 1];
  if (!top || !state) return null;
  if (top.kind === "card") {
    return (
      <CardDialog
        state={state}
        cardId={top.cardId}
        onClose={() => dialogs.pop()}
        toasts={toasts}
      />
    );
  }
  if (top.kind === "confirm") {
    return (
      <ConfirmDialog
        title={top.title}
        message={top.message}
        confirmLabel={top.confirmLabel}
        danger={top.danger}
        onCancel={() => dialogs.pop()}
        onConfirm={() => {
          top.onConfirm();
          dialogs.pop();
        }}
      />
    );
  }
  if (top.kind === "settings") {
    return (
      <SettingsDialog state={state} onClose={() => dialogs.pop()} />
    );
  }
  return null;
}

function downloadJson(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer the revoke so the browser has time to start the
  // download. The blob is small (the whole workspace as JSON).
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const REMEMBERED_BOARD_KEY = "sidetrack.lastBoardId.v1";

function readRememberedBoard(): BoardId | null {
  try {
    const v = localStorage.getItem(REMEMBERED_BOARD_KEY);
    if (!v) return null;
    return v as BoardId;
  } catch {
    return null;
  }
}

function writeRememberedBoard(id: BoardId) {
  try {
    localStorage.setItem(REMEMBERED_BOARD_KEY, id);
  } catch {
    // localStorage can throw in private-browsing or storage-full
    // situations. The "remember last board" feature is a
    // nicety; we never want it to break the app.
  }
}

