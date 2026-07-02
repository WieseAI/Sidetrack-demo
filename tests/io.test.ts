import { describe, it, expect } from "vitest";
import { defaultState } from "../src/shared/seed";
import { createStorage, InMemoryStorage } from "../src/shared/storage";
import {
  buildEnvelope,
  defaultExportFilename,
  exportToJson,
  importFromJson,
} from "../src/shared/io";
import { SCHEMA_VERSION } from "../src/shared/model";

/**
 * Import / export round-trip tests.
 *
 * These cover brief AC #8: "Export JSON, wipe the extension,
 * import — everything is back." We simulate the wipe by
 * constructing a fresh storage handle on a fresh InMemoryStorage
 * and re-importing the export blob.
 */

describe("export envelope", () => {
  it("names the app and stamps the current schema version", () => {
    const state = defaultState(1_716_000_000_000);
    const env = buildEnvelope(state);
    expect(env.app).toBe("sidetrack");
    expect(env.schemaVersion).toBe(SCHEMA_VERSION);
    expect(env.state).toBe(state);
    expect(typeof env.exportedAt).toBe("number");
  });

  it("default filename uses the local date", () => {
    const d = new Date(2026, 6, 2); // July 2, 2026
    expect(defaultExportFilename(d)).toBe("sidetrack-2026-07-02.json");
  });
});

describe("round-trip", () => {
  it("preserves all data through a fresh storage handle", async () => {
    const store1 = createStorage(new InMemoryStorage());
    const seeded = await store1.loadState();
    // Add a custom card.
    await store1.mutate({
      type: "create-card",
      columnId: seeded.columns[0]!.id,
      title: "An exported thought",
    });
    // Add an entry to the welcome card.
    const welcome = seeded.cards[0]!;
    await store1.mutate({
      type: "add-entry",
      cardId: welcome.id,
      entry: {
        startAt: 1_716_000_000_000,
        endAt: 1_716_000_060_000,
        source: "manual",
      },
    });
    const json = exportToJson(await store1.exportState());

    // "Wipe" by constructing a fresh handle. Same InMemoryStorage
    // would retain the data, so we use a brand new one.
    const store2 = createStorage(new InMemoryStorage());
    const restored = importFromJson(json);
    await store2.importState(restored);

    const final = await store2.exportState();
    expect(final.cards.some((c) => c.title === "An exported thought")).toBe(
      true,
    );
    expect(final.cards[0]!.entries.length).toBe(1);
  });
});

describe("import validation", () => {
  it("refuses a JSON object that is not an envelope", () => {
    expect(() => importFromJson(JSON.stringify({ foo: "bar" }))).toThrow(
      /app=/,
    );
  });

  it("refuses a blob whose state block fails validation", () => {
    const bad = JSON.stringify({
      app: "sidetrack",
      schemaVersion: SCHEMA_VERSION,
      state: { schemaVersion: SCHEMA_VERSION },
    });
    expect(() => importFromJson(bad)).toThrow(/state block failed/);
  });
});
