import { describe, it, expect } from "vitest";
import { render } from "preact";
import { App } from "../src/sidepanel/App";
import { PROJECT_NAME, VERSION } from "../src/shared/version";

/**
 * Phase 0 acceptance criterion #4:
 *   "Clicking the toolbar action opens the sidepanel, which shows a
 *    styled empty state with the project name and version."
 *
 * The toolbar-click → sidepanel-open path requires a real Chrome
 * runtime and is verified by the Definition of Done in
 * docs/issues/00-phase-0-research-and-foundation.md (load unpacked
 * in a clean Chrome profile). Here we unit-test that the App
 * component renders the project name and version into the empty
 * state, so a future refactor that drops either field fails in CI.
 */
describe("<App /> empty state", () => {
  it("renders the project name and version", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(<App />, container);

    const text = container.textContent ?? "";
    expect(text).toContain(PROJECT_NAME);
    expect(text).toContain(VERSION);

    // The version badge uses the "v0.0.0" convention; the "v" prefix
    // is what the README / acceptance criteria expect.
    expect(text).toContain(`v${VERSION}`);
  });

  it("renders an accessible main landmark with the project name", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(<App />, container);

    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    const label = main?.getAttribute("aria-label") ?? "";
    expect(label).toContain(PROJECT_NAME);
  });

  it("renders a status region for the empty state", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(<App />, container);

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
  });

  it("renders the D-17 keyboard chord hint in the footer", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(<App />, container);

    const footer = container.querySelector("footer");
    expect(footer).not.toBeNull();
    const text = footer?.textContent ?? "";
    // We don't pin to "Alt+Shift+S" exactly because the brief leaves
    // chord choice to the implementation; we assert the three keys
    // we ship are visible.
    expect(text).toContain("Alt");
    expect(text).toContain("Shift");
    expect(text).toContain("S");
  });
});
