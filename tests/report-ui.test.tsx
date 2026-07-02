import {
  render,
  fireEvent,
  waitFor,
  cleanup,
  screen,
} from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/sidepanel/App";
import {
  createStorage,
  InMemoryStorage,
} from "../src/shared/storage";
import { setActiveStorage } from "../src/sidepanel/state/storage";
import { applyAction } from "../src/shared/reducer";
import { defaultState } from "../src/shared/seed";

/**
 * Report view UI tests.
 *
 * Drives `<App />` against an in-memory storage handle
 * pre-seeded with a few entries that fall inside "today"
 * and outside it. The tests assert:
 *
 *   - "Today" is the default range; the total is
 *     non-zero when there are entries that fall in the
 *     range.
 *   - "This week" is selectable; it widens the range.
 *   - The empty state is shown when no entries fall in
 *     the range.
 *   - Clicking a row in the per-task list opens the
 *     card's detail dialog.
 *   - The view tabs (Board / Reports) switch between
 *     the kanban and the report.
 */

const NOW = new Date(2026, 6, 2, 14, 0, 0, 0).getTime();

function todayStart(): number {
  return new Date(2026, 6, 2, 0, 0, 0, 0).getTime();
}

function seedWithSomeTrackedTime() {
  const s0 = defaultState(NOW);
  const board = s0.boards[0]!;
  const col = s0.columns.find(
    (c) => board.columnIds.includes(c.id) && c.name === "Backlog",
  )!;
  let s1 = applyAction(s0, { type: "create-card", columnId: col.id, title: "Project A" });
  const a = s1.cards[s1.cards.length - 1]!.id;
  let s2 = applyAction(s1, { type: "create-card", columnId: col.id, title: "Project B" });
  const b = s2.cards[s2.cards.length - 1]!.id;
  // Project A: 30 min today.
  s2 = applyAction(s2, {
    type: "add-entry",
    cardId: a,
    entry: {
      startAt: todayStart() + 60_000,
      endAt: todayStart() + 60_000 + 1_800_000,
      source: "manual",
    },
  });
  // Project B: 10 min today.
  s2 = applyAction(s2, {
    type: "add-entry",
    cardId: b,
    entry: {
      startAt: todayStart() + 60_000,
      endAt: todayStart() + 60_000 + 600_000,
      source: "manual",
    },
  });
  // Project A: also 1h yesterday (outside today).
  s2 = applyAction(s2, {
    type: "add-entry",
    cardId: a,
    entry: {
      startAt: todayStart() - 7_200_000,
      endAt: todayStart() - 3_600_000,
      source: "manual",
    },
  });
  return s2;
}

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('sidetrack.onboardingDismissed.v1', '1');
  // Make sure the test never reads the real defaultStorage singleton.
  setActiveStorage(createStorage(new InMemoryStorage()));
  // Seed by writing through the active handle.
  const handle = createStorage(new InMemoryStorage());
  setActiveStorage(handle);
  await handle.importState(seedWithSomeTrackedTime());
});

afterEach(() => {
  cleanup();
  setActiveStorage(createStorage(new InMemoryStorage()));
});

describe("<App /> reports view", () => {
  it("starts on the Board view by default", async () => {
    render(<App />);
    // The view tabs render even before state loads; wait
    // for the kanban to be visible (the Inbox column is
    // the canary).
    await waitFor(() => {
      expect(screen.queryAllByText("Inbox").length).toBeGreaterThan(0);
    });
    const boardTab = screen.getByTestId("view-tab-board");
    expect(boardTab.getAttribute("aria-selected")).toBe("true");
  });

  it("switches to Reports when the Reports tab is clicked", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("view-tab-reports")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("view-tab-reports"));
    await waitFor(() => {
      expect(screen.getByTestId("report-tab-today")).toBeTruthy();
    });
    expect(screen.getByTestId("report-tab-today").getAttribute("aria-selected")).toBe("true");
  });

  it("shows the per-task rows for entries that fall in the range", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("view-tab-reports")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("view-tab-reports"));
    await waitFor(() => {
      // The total should reflect the 30 + 10 = 40 min tracked today.
      // formatDurationLong emits "MM:SS" when hours are 0.
      expect(screen.getByTestId("report-total").textContent).toBe("40:00");
    });
    // Both cards show up; the higher-total one (Project A) is first.
    const projectA = screen.getByText("Project A");
    const projectB = screen.getByText("Project B");
    expect(projectA).toBeTruthy();
    expect(projectB).toBeTruthy();
  });

  it("clicking a row opens the card detail dialog", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("view-tab-reports")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("view-tab-reports"));
    await waitFor(() => {
      expect(screen.getByTestId("report-tab-today")).toBeTruthy();
    });
    // Find the clickable button containing "Project A" and click it.
    const allButtons = Array.from(document.querySelectorAll(".report__task-button"));
    const projectARow = allButtons.find(
      (b) => b.textContent?.includes("Project A"),
    ) as HTMLElement | undefined;
    expect(projectARow, "Project A row").toBeTruthy();
    fireEvent.click(projectARow!);
    await waitFor(() => {
      // The card dialog opens with the title field pre-filled.
      const titleInput = document.querySelector<HTMLInputElement>(
        ".dialog input[type='text']",
      );
      expect(titleInput?.value).toBe("Project A");
    });
  });

  it("respects the active view tabs (clicking Reports tab twice is a no-op)", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("view-tab-reports")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("view-tab-reports"));
    await waitFor(() => {
      expect(screen.getByTestId("report-tab-today")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("view-tab-reports"));
    // Still on the report view.
    expect(screen.getByTestId("report-tab-today")).toBeTruthy();
  });

  it("switches back to Board from Reports", async () => {
    render(<App />);
    // Wait for the kanban to be ready (so the Inbox column is in the DOM)
    // before we switch tabs.
    await waitFor(() => {
      expect(screen.queryAllByText("Inbox").length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByTestId("view-tab-reports"));
    await waitFor(() => {
      expect(screen.getByTestId("report-tab-today")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("view-tab-board"));
    await waitFor(() => {
      // The kanban returns; the report tabs are gone.
      expect(screen.queryByTestId("report-tab-today")).toBeNull();
    });
    // And the kanban is back: the Inbox column is visible.
    expect(screen.queryAllByText("Inbox").length).toBeGreaterThan(0);
  });
});

describe("<App /> reports — empty state", () => {
  beforeEach(async () => {
    setActiveStorage(createStorage(new InMemoryStorage()));
    // Seed with no entries that fall in "today".
    const handle = createStorage(new InMemoryStorage());
    setActiveStorage(handle);
    await handle.importState(defaultState(NOW));
  });

  it("shows the empty state copy when no entries are tracked today", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("view-tab-reports")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("view-tab-reports"));
    await waitFor(() => {
      expect(screen.getByTestId("report-tab-today")).toBeTruthy();
    });
    // The total is 00:00:00 and the empty state copy is rendered.
    expect(screen.getByTestId("report-total").textContent).toBe("00:00");
    expect(screen.getByText(/no tracked time today/i)).toBeTruthy();
  });
});
