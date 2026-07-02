import { describe, it, expect } from "vitest";
import manifest from "../manifest.config.js";

/**
 * Source-manifest contract test.
 *
 * The CRX plugin accepts a lot of fields without complaining, but
 * Chrome itself warns (or refuses to load) the extension if a
 * required field is missing. This test fails fast on the source
 * manifest so the build never has to be run to catch a typo.
 */
describe("manifest.config.js", () => {
  it("is an MV3 manifest", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it("declares a name and a semver version", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("declares the four MV3-required surface fields", () => {
    expect(manifest.action).toBeDefined();
    expect(manifest.background).toBeDefined();
    expect(manifest.background?.type).toBe("module");
    expect(manifest.side_panel).toBeDefined();
  });

  it("declares the chrome.commands we ship in Phase 0", () => {
    expect(manifest.commands).toBeDefined();
    expect(manifest.commands?.["open-sidepanel"]).toBeTruthy();
    expect(manifest.commands?.["quick-add"]).toBeTruthy();
    expect(manifest.commands?.["toggle-timer"]).toBeTruthy();
  });

  it("requests only the permissions we actually need in Phase 0+", () => {
    // We do not request host_permissions or any permission whose
    // corresponding feature is not yet implemented. The list grows
    // as later phases light up.
    const expected = ["sidePanel", "storage", "alarms", "idle", "contextMenus", "notifications"];
    expect(new Set(manifest.permissions ?? [])).toEqual(new Set(expected));
    expect(manifest.host_permissions ?? []).toEqual([]);
  });
});
