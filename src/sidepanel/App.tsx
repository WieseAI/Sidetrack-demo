import { useEffect, useState } from "preact/hooks";
import { PROJECT_NAME, VERSION } from "../shared/version";
import { usePersistedState, useStorageHandle as useStorageHandleLocal } from "./state/storage";
import { exportToJson, defaultExportFilename, importFromJson } from "../shared/io";
import { Board } from "./components/Board";
import { BoardPicker } from "./components/BoardPicker";
import { CardDialog } from "./components/CardDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { Toast } from "./components/Toast";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { useToasts } from "./state/toasts";
import { useDialogStack } from "./state/dialogs";
import type { BoardId, PersistedState } from "../shared/model";


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

  // Global keyboard shortcuts (Alt+Shift+A quick-add, etc.). The
  // D-17 chords are the manifest's `commands`, which the service
  // worker relays to the sidepanel via chrome.runtime messages.
  // For now we listen for keyboard events on the sidepanel itself;
  // the global command listener is wired up in Phase 2 when
  // start/stop-timer has user-visible behavior.
  return (
    <main class="app" aria-label={`${PROJECT_NAME} sidepanel`}>
      <Header
        state={state}
        activeBoardId={activeBoardId}
        onSelectBoard={setActiveBoardId}
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
        />
      ) : (
        <Skeleton />
      )}
      <Footer />
      <DialogRenderer state={state} dialogs={dialogs} />
      <Toast toasts={toasts} />
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
      />
    </main>
  );
}

function Header(props: {
  state: PersistedState | null;
  activeBoardId: BoardId | null;
  onSelectBoard: (id: BoardId) => void;
  onImport: (text: string) => void | Promise<void>;
  onExport: () => void | Promise<void>;
}) {
  const { state, activeBoardId, onSelectBoard, onImport, onExport } = props;
  return (
    <header class="app__header" role="banner">
      <h1 class="app__title">
        {state && activeBoardId ? (
          <BoardPicker
            state={state}
            activeBoardId={activeBoardId}
            onSelect={onSelectBoard}
          />
        ) : (
          PROJECT_NAME
        )}
      </h1>
      <div class="app__header-actions">
        <ImportButton onImport={onImport} />
        <ExportButton onExport={onExport} />
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
}: {
  state: PersistedState | null;
  dialogs: ReturnType<typeof useDialogStack>;
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

