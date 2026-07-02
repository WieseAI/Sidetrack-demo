/**
 * Service-worker capture glue.
 *
 * Exercises `src/background/capture.ts` against a fake
 * `chrome.contextMenus` and a fake `chrome.runtime` shim.
 *
 * The point of this test is to prove:
 *
 *   1. The page-variant click creates an Inbox card with
 *      the page title and a `source.url` provenance.
 *   2. The selection-variant click uses the selection
 *      text as the card title and includes the page URL
 *      in the description.
 *   3. The SW posts a `card-captured` message to the
 *      sidepanel.
 *   4. A click with no resolvable URL is a no-op.
 *   5. A workspace with no Inbox column is a no-op.
 *
 * The reducer is the authoritative writer; the SW code is
 * plumbing. The reducer itself is covered in
 * `tests/capture.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Module-level handles the chrome.* shims write into. Read
// by the tests via the fake's `mock.calls`; the variables
// exist to make the shim's closures happy and are not used
// directly here.
let messageListener:
  | ((m: unknown, _s: unknown, cb: (r: unknown) => void) => void)
  | null = null;
let notificationListener:
  | ((id: string) => void)
  | null = null;
void messageListener;
void notificationListener;
let notificationCreateSpy: ReturnType<typeof vi.fn>;
let sendMessageSpy: ReturnType<typeof vi.fn>;
let getURLSpy: ReturnType<typeof vi.fn>;
let notificationsCreated: Array<{
  id: string;
  options: {
    type?: string;
    iconUrl?: string;
    title?: string;
    message?: string;
  };
}>;

function makeFakeChrome() {
  notificationCreateSpy = vi.fn(
    (id: string, options: { type?: string; iconUrl?: string; title?: string; message?: string }) => {
      notificationsCreated.push({ id, options });
      return Promise.resolve(id);
    },
  );
  sendMessageSpy = vi.fn();
  getURLSpy = vi.fn((p: string) => `chrome-extension://abc/${p}`);
  notificationsCreated = [];
  return {
    contextMenus: {
      create: vi.fn(),
      removeAll: vi.fn((cb: () => void) => cb()),
      onClicked: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    notifications: {
      create: notificationCreateSpy,
      onClicked: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      clear: vi.fn(),
    },
    runtime: {
      onMessage: {
        addListener: vi.fn((cb: (m: unknown, _s: unknown, resp: (r: unknown) => void) => void) => {
          messageListener = cb;
        }),
        removeListener: vi.fn(),
      },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      sendMessage: sendMessageSpy,
      getURL: getURLSpy,
      lastError: undefined,
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    alarms: {
      create: vi.fn(),
      get: vi.fn(async () => undefined),
      onAlarm: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    sidePanel: { open: vi.fn() },
    action: { onClicked: { addListener: vi.fn() } },
    idle: {
      onStateChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      getAutoLockDelay: vi.fn(),
    },
  };
}

let fake: ReturnType<typeof makeFakeChrome>;

beforeEach(async () => {
  messageListener = null;
  notificationListener = null;
  fake = makeFakeChrome();
  (globalThis as unknown as { chrome: unknown }).chrome = fake;
  // Reset the storage singleton so each test starts clean.
  const storageMod = await import("../src/shared/storage");
  const seedMod = await import("../src/shared/seed");
  await storageMod.storage.importState(seedMod.defaultState(Date.now()));
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
  vi.resetModules();
});

async function importModules() {
  // Reload modules so the storage singleton picks up the
  // freshly-set `chrome` global.
  vi.resetModules();
  return await import("../src/background/capture");
}

describe("background capture glue", () => {
  it("ensureContextMenus creates two items (page + selection)", async () => {
    const { ensureContextMenus, MENU_PAGE, MENU_SELECTION } =
      await importModules();
    await ensureContextMenus();
    const calls = fake.contextMenus.create.mock.calls;
    const ids = calls.map((c) => (c[0] as { id: string }).id);
    expect(ids).toContain(MENU_PAGE);
    expect(ids).toContain(MENU_SELECTION);
  });

  it("page-variant click creates a card with the page title and source.url", async () => {
    const { handleContextMenuClick, MENU_PAGE } = await importModules();
    const storageMod = await import("../src/shared/storage");
    const state = await storageMod.storage.peekOrLoad();
    const inboxId = state.boards[0]!.inboxColumnId!;
    const result = await handleContextMenuClick(
      { menuItemId: MENU_PAGE },
      { url: "https://example.com/article", title: "An interesting article" },
    );
    expect(result.ok).toBe(true);
    const after = await storageMod.storage.exportState();
    const inbox = after.columns.find((c) => c.id === inboxId)!;
    const created = after.cards.find((c) => c.id === inbox.cardIds[0])!;
    expect(created).toBeTruthy();
    expect(created.title).toBe("An interesting article");
    expect(created.source?.url).toBe("https://example.com/article");
    expect(created.source?.selection).toBeUndefined();
    // Description includes the URL.
    expect(created.description).toContain("https://example.com/article");
  });

  it("selection-variant click uses the selected text as the title", async () => {
    const { handleContextMenuClick, MENU_SELECTION } = await importModules();
    const result = await handleContextMenuClick(
      {
        menuItemId: MENU_SELECTION,
        selectionText: "  pick me  ",
        pageUrl: "https://example.com",
      },
      { url: "https://example.com", title: "Source page" },
    );
    expect(result.ok).toBe(true);
    const storageMod = await import("../src/shared/storage");
    const after = await storageMod.storage.exportState();
    const last = after.cards[after.cards.length - 1]!;
    expect(last.title).toBe("pick me");
    expect(last.source?.selection).toBe("  pick me  ");
    expect(last.source?.url).toBe("https://example.com");
    expect(last.description).toContain("https://example.com");
  });

  it("selection-variant click falls back to the page title when selection is empty", async () => {
    const { handleContextMenuClick, MENU_SELECTION } = await importModules();
    await handleContextMenuClick(
      {
        menuItemId: MENU_SELECTION,
        selectionText: "",
        pageUrl: "https://example.com",
      },
      { url: "https://example.com", title: "Page title" },
    );
    const storageMod = await import("../src/shared/storage");
    const after = await storageMod.storage.exportState();
    const last = after.cards[after.cards.length - 1]!;
    expect(last.title).toBe("Page title");
    expect(last.source?.selection).toBeUndefined();
  });

  it("posts a card-captured message to the sidepanel", async () => {
    const { handleContextMenuClick, MENU_PAGE } = await importModules();
    const result = await handleContextMenuClick(
      { menuItemId: MENU_PAGE },
      { url: "https://example.com/x", title: "X" },
    );
    expect(result.ok).toBe(true);
    expect(sendMessageSpy).toHaveBeenCalled();
    const sent = sendMessageSpy.mock.calls[0]![0] as {
      type: string;
      cardId: string;
      title: string;
    };
    expect(sent.type).toBe("card-captured");
    expect(sent.title).toBe("X");
    expect(typeof sent.cardId).toBe("string");
    expect(sent.cardId.length).toBeGreaterThan(0);
  });

  it("fires a chrome.notifications tray cue (best-effort)", async () => {
    const { handleContextMenuClick, MENU_PAGE } = await importModules();
    await handleContextMenuClick(
      { menuItemId: MENU_PAGE },
      { url: "https://example.com", title: "Tray cue" },
    );
    expect(notificationCreateSpy).toHaveBeenCalled();
    const args = notificationCreateSpy.mock.calls[0]!;
    const opts = args[1] as { title: string; message: string };
    expect(opts.title).toBe("Added to Sidetrack");
    expect(opts.message).toBe("Tray cue");
  });

  it("is a no-op when the URL is missing", async () => {
    const { handleContextMenuClick, MENU_PAGE } = await importModules();
    const storageMod = await import("../src/shared/storage");
    const before = (await storageMod.storage.exportState()).cards.length;
    const result = await handleContextMenuClick(
      { menuItemId: MENU_PAGE },
      { url: "", title: "" },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-url");
    const after = (await storageMod.storage.exportState()).cards.length;
    expect(after).toBe(before);
  });

  it("is a no-op when there is no Inbox column", async () => {
    const { handleContextMenuClick, MENU_PAGE } = await importModules();
    // Clear the inboxColumnId on the only board.
    const storageMod = await import("../src/shared/storage");
    const s = await storageMod.storage.exportState();
    const board = s.boards[0]!;
    const cleared = {
      ...s,
      boards: s.boards.map((b) =>
        b.id === board.id ? { ...b, inboxColumnId: undefined } : b,
      ),
    };
    await storageMod.storage.importState(cleared);
    const result = await handleContextMenuClick(
      { menuItemId: MENU_PAGE },
      { url: "https://example.com", title: "X" },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-inbox");
  });

  it("falls back to the URL when the page title is empty", async () => {
    const { handleContextMenuClick, MENU_PAGE } = await importModules();
    await handleContextMenuClick(
      { menuItemId: MENU_PAGE },
      { url: "https://example.com/lonely", title: "" },
    );
    const storageMod = await import("../src/shared/storage");
    const after = await storageMod.storage.exportState();
    const last = after.cards[after.cards.length - 1]!;
    expect(last.title).toBe("https://example.com/lonely");
  });
});
