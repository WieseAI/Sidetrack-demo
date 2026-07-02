/**
 * Sidepanel side of the storage boundary.
 *
 * The sidepanel never talks to `chrome.storage.local` directly. It
 * imports this module, which exposes:
 *
 *   - `useState()`: a Preact hook that subscribes the component to
 *                    storage changes and re-renders on every write.
 *   - `useStorage()`: returns the storage handle (only for
 *                     one-shot operations like export/import).
 *
 * Keeping the subscription in a single hook means we have one place
 * to add the live-tick subscription (Phase 2) and the in-sidepanel
 * idle-prompt subscription (Phase 3) without touching every
 * component.
 */

import { useEffect, useState } from "preact/hooks";
import { storage as defaultStorage } from "../../shared/storage";
import type { StorageHandle } from "../../shared/storage";
import type { PersistedState } from "../../shared/model";

/** Pluggable storage handle. The default is the singleton bound to
 *  the real `chrome.storage.local`; tests inject an in-memory one. */
let active: StorageHandle = defaultStorage;

export function setActiveStorage(handle: StorageHandle): void {
  active = handle;
}

export function useStorageHandle(): StorageHandle {
  return active;
}

/** Returns the current persisted state, re-rendering on every write. */
export function usePersistedState(): PersistedState | null {
  const [state, setState] = useState<PersistedState | null>(null);
  useEffect(() => {
    let cancelled = false;
    active.loadState().then((s) => {
      if (!cancelled) setState(s);
    });
    const unsubscribe = active.subscribe((s) => setState(s));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return state;
}

/** Imperative mutation API for components. */
export function mutate(): StorageHandle["mutate"] {
  return active.mutate.bind(active);
}
