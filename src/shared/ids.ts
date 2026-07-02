/**
 * Branded-ID factories.
 *
 * The branded `Id<T>` type is structural; at runtime it's a plain
 * string. We use `crypto.randomUUID()` where available (MV3 service
 * workers and modern browsers have it) and fall back to a 16-byte
 * `Math.random` hex string in unit tests and other non-browser
 * contexts.
 *
 * The fallback is deliberately noisy in dev — if you see a hex ID
 * in the sidepanel, you are running outside a real browser.
 */

import type {
  BoardId,
  CardId,
  ColumnId,
  EntryId,
  Id,
} from "./model.js";

/** Returns a fresh ID brand for the given kind. */
export function makeId<T extends string>(): Id<T> {
  const raw =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : fallbackId();
  return raw as Id<T>;
}

export const makeBoardId = (): BoardId => makeId<"Board">();
export const makeColumnId = (): ColumnId => makeId<"Column">();
export const makeCardId = (): CardId => makeId<"Card">();
export const makeEntryId = (): EntryId => makeId<"Entry">();

function fallbackId(): string {
  // 128 bits of entropy encoded as 32 hex chars. Good enough for
  // local-only storage where collisions are practically impossible.
  const bytes = new Uint8Array(16);
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}
