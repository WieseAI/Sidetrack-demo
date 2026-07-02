/**
 * Export / import.
 *
 * Brief AC #8: "Export JSON, wipe the extension, import —
 * everything is back." The format is the same `PersistedState` we
 * already persist, wrapped in an envelope that names the
 * application and the schema version. The envelope is what makes
 * future migrations safer: if Sidetrack v2 changes the shape,
 * v1 exports still identify themselves as v1 and the importer
 * can branch.
 *
 * The functions in this module are pure: they take or return
 * `string` and never touch `chrome.storage` or the network. The
 * sidepanel wires them to file inputs/outputs.
 */

import {
  isPersistedState,
  SCHEMA_VERSION,
  type PersistedState,
} from "./model.js";

/** Stable export envelope. The shape is part of the public API:
 *  a v1 export from a future Sidetrack v2 must still validate
 *  against this shape and be importable as-is or migrated. */
export interface ExportEnvelope {
  app: "sidetrack";
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: number;
  state: PersistedState;
}

/** Build an export envelope from the current state. */
export function buildEnvelope(state: PersistedState): ExportEnvelope {
  return {
    app: "sidetrack",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    state,
  };
}

/** Serialize an envelope to a JSON string with stable formatting. */
export function exportToJson(state: PersistedState): string {
  return JSON.stringify(buildEnvelope(state), null, 2);
}

/** Parse + validate a JSON string. Throws on anything invalid. */
export function importFromJson(text: string): PersistedState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `sidetrack: export is not valid JSON (${(err as Error).message})`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("sidetrack: export root is not an object");
  }
  const v = parsed as Record<string, unknown>;
  if (v.app !== "sidetrack") {
    throw new Error(
      `sidetrack: export has app=${String(v.app)} (expected "sidetrack")`,
    );
  }
  if (v.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `sidetrack: export schemaVersion=${String(v.schemaVersion)} is not understood (this build supports ${SCHEMA_VERSION})`,
    );
  }
  const state = v.state;
  if (!isPersistedState(state)) {
    throw new Error("sidetrack: export state block failed validation");
  }
  return state;
}

/** Construct a filename like `sidetrack-2026-07-02.json`. */
export function defaultExportFilename(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `sidetrack-${y}-${m}-${d}.json`;
}
