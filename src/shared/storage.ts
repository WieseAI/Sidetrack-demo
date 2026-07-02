/**
 * chrome.storage.local wrapper.
 *
 * Phase 1 ships three surfaces over the persisted blob:
 *
 *   - `loadState()`    — read the current state, or seed the
 *                         default board on first run.
 *   - `mutate(fn)`     — apply a reducer action under a
 *                         serialization lock and write the new
 *                         blob atomically (D-06 / R-01).
 *   - `subscribe(fn)`  — fan out `chrome.storage.onChanged` events
 *                         to in-memory caches, so the sidepanel
 *                         and the service worker stay in sync.
 *
 * The module is context-agnostic: it works in the service worker
 * (real `chrome.storage.local`) and in the sidepanel (same API).
 * Tests inject an in-memory `ChromeStorageShim` so we can drive
 * the whole flow without a browser.
 */

import type { Action, } from "./reducer.js";
import { applyAction } from "./reducer.js";
import {
  isPersistedState,
  SCHEMA_VERSION,
  type PersistedState,
} from "./model.js";
import { defaultState } from "./seed.js";

const STORAGE_KEY = "sidetrack.state.v1";

/** Minimal surface we need from `chrome.storage.local`. */
export interface ChromeStorageArea {
  get(
    keys: string | string[] | Record<string, unknown> | null,
  ): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface StorageChange {
  key: string;
  newValue: unknown;
  oldValue: unknown;
}

export interface StorageAdapter {
  local: ChromeStorageArea;
  onChanged: {
    addListener(
      cb: (changes: Record<string, StorageChange>, area: string) => void,
    ): void;
    removeListener(
      cb: (changes: Record<string, StorageChange>, area: string) => void,
    ): void;
  };
}

/** The real Chrome storage adapter (used in the extension). */
export const chromeStorage: StorageAdapter | undefined =
  typeof chrome !== "undefined" && chrome.storage?.local
    ? (chrome.storage as unknown as StorageAdapter)
    : undefined;

/** A simple in-memory adapter used by unit tests. */
export class InMemoryStorage implements StorageAdapter {
  readonly local: ChromeStorageArea;
  private readonly listeners = new Set<
    (changes: Record<string, StorageChange>, area: string) => void
  >();
  private store: Record<string, unknown> = {};
  constructor(seed: Record<string, unknown> = {}) {
    this.store = { ...seed };
    this.local = {
      get: async (keys) => {
        if (keys === null || keys === undefined) {
          return { ...this.store };
        }
        const list = Array.isArray(keys)
          ? keys
          : typeof keys === "string"
            ? [keys]
            : Object.keys(keys);
        const out: Record<string, unknown> = {};
        for (const k of list) {
          if (k in this.store) out[k] = this.store[k];
        }
        return out;
      },
      set: async (items) => {
        const changes: Record<string, StorageChange> = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = {
            key: k,
            oldValue: this.store[k],
            newValue: v,
          };
          this.store[k] = v;
        }
        this.fire(changes);
      },
      remove: async (keys) => {
        const list = Array.isArray(keys) ? keys : [keys];
        const changes: Record<string, StorageChange> = {};
        for (const k of list) {
          if (k in this.store) {
            changes[k] = {
              key: k,
              oldValue: this.store[k],
              newValue: undefined,
            };
            delete this.store[k];
          }
        }
        this.fire(changes);
      },
    };
  }
  readonly onChanged = {
    addListener: (
      cb: (changes: Record<string, StorageChange>, area: string) => void,
    ) => {
      this.listeners.add(cb);
    },
    removeListener: (
      cb: (changes: Record<string, StorageChange>, area: string) => void,
    ) => {
      this.listeners.delete(cb);
    },
  };
  private fire(changes: Record<string, StorageChange>) {
    for (const cb of this.listeners) cb(changes, "local");
  }
}

/** Construct a fresh storage facade. */
export interface StorageHandle {
  loadState(): Promise<PersistedState>;
  mutate(action: Action): Promise<PersistedState>;
  /** Dispatch multiple actions in a single write. */
  transact(actions: Action[]): Promise<PersistedState>;
  exportState(): Promise<PersistedState>;
  /** Replace the persisted state. Refuses blobs that fail the
   *  shape validator. */
  importState(state: PersistedState): Promise<PersistedState>;
  subscribe(listener: (state: PersistedState) => void): () => void;
  /** For tests: returns the current cached state without I/O. */
  peek(): PersistedState;
}

export function createStorage(adapter: StorageAdapter): StorageHandle {
  let cache: PersistedState | null = null;
  // The serialization lock is a chain of promises. Every mutate
  // appends a step that runs after the previous one resolves.
  // `chrome.storage.local.set` is atomic per key, so the chain
  // ensures we never interleave reads and writes (R-01). We seed
  // the chain with a resolved promise so the first call has
  // nothing to wait on.
  let writing: Promise<PersistedState> = Promise.resolve(
    // The `as` cast is safe because the chain is internal: the
    // only callers are `write()` (which returns the *next* state)
    // and the public `mutate()`/`transact()` (which await the
    // chain before consuming the return value).
    null as unknown as PersistedState,
  );

  const listeners = new Set<(state: PersistedState) => void>();

  adapter.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const change = changes[STORAGE_KEY];
    if (!change) return;
    const next = change.newValue;
    if (isPersistedState(next)) {
      cache = next;
      for (const cb of listeners) cb(next);
    }
  });

  async function read(): Promise<PersistedState> {
    if (cache) return cache;
    const got = await adapter.local.get(STORAGE_KEY);
    const raw = got[STORAGE_KEY];
    if (isPersistedState(raw)) {
      cache = raw;
      return raw;
    }
    // Either no state has been persisted yet, or the blob is
    // corrupt (wrong schema version, malformed JSON, etc.). In
    // both cases we seed the default board so the user has
    // something to click on.
    const fresh = defaultState(Date.now());
    await adapter.local.set({ [STORAGE_KEY]: fresh });
    cache = fresh;
    return fresh;
  }

  /**
   * Atomic read-modify-write under the serialization lock. We
   * chain the read on top of the previous write so the next
   * mutate sees the result of every prior mutate in the queue.
   * This is what makes R-01 hold under concurrent callers.
   */
  function applyUnderLock(
    fn: (current: PersistedState) => PersistedState,
  ): Promise<PersistedState> {
    const step: Promise<PersistedState> = writing.then(async () => {
      const current = await read();
      const next = fn(current);
      if (next === current) return current;
      cache = next;
      await adapter.local.set({ [STORAGE_KEY]: next });
      return next;
    });
    writing = step.then(
      () => cache as PersistedState,
      () => cache as PersistedState,
    );
    return step;
  }

  function mutate(action: Action): Promise<PersistedState> {
    return applyUnderLock((current) => applyAction(current, action));
  }

  function transact(actions: Action[]): Promise<PersistedState> {
    return applyUnderLock((current) => {
      let next = current;
      for (const a of actions) {
        next = applyAction(next, a);
      }
      return next;
    });
  }

  async function exportState(): Promise<PersistedState> {
    return read();
  }

  function importState(state: PersistedState): Promise<PersistedState> {
    if (!isPersistedState(state)) {
      return Promise.reject(
        new Error("sidetrack: cannot import invalid state blob"),
      );
    }
    if (state.schemaVersion !== SCHEMA_VERSION) {
      return Promise.reject(
        new Error(
          `sidetrack: cannot import schemaVersion=${String(state.schemaVersion)} (expected ${SCHEMA_VERSION})`,
        ),
      );
    }
    return applyUnderLock(() => state);
  }

  function subscribe(listener: (state: PersistedState) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function peek(): PersistedState {
    if (!cache) {
      throw new Error("sidetrack: peek() called before loadState()");
    }
    return cache;
  }

  return {
    loadState: read,
    mutate,
    transact,
    exportState,
    importState,
    subscribe,
    peek,
  };
}

/**
 * The default storage handle, bound to the real `chrome.storage`.
 * In the sidepanel and the service worker this is what the rest
 * of the app imports. Tests construct their own handle with
 * `InMemoryStorage`.
 */
export const storage: StorageHandle = chromeStorage
  ? createStorage(chromeStorage)
  : createStorage(new InMemoryStorage());
