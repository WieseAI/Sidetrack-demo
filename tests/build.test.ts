import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

/**
 * Build-output contract test.
 *
 * This is the only test that runs the actual build (it's slow). It
 * exists so a future agent who changes vite.config.ts or the CRX
 * plugin version catches a broken `dist/` *before* the Phase 0 AC
 * ("loadable in a clean Chrome profile") regresses silently.
 *
 * We do not unit-test the bundler itself; we assert the output shape
 * Chrome cares about.
 */
const repoRoot = resolve(__dirname, "..");
const distDir = join(repoRoot, "dist");

beforeAll(() => {
  // Run the production build once. We invoke `vite build` (not
  // `npm run build`) because the npm script also runs `tsc --noEmit`,
  // which is exercised by the App unit test on a separate run.
  execSync("npx vite build", {
    cwd: repoRoot,
    stdio: "pipe",
    env: { ...process.env, NODE_ENV: "production" },
  });
}, 120_000);

describe("dist/ build output", () => {
  it("produces a dist/ directory", () => {
    expect(existsSync(distDir)).toBe(true);
    expect(statSync(distDir).isDirectory()).toBe(true);
  });

  it("contains a manifest.json with no missing fields Chrome warns on", () => {
    const manifestPath = join(distDir, "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

    // MV3 + name + version are the fields Chrome always complains
    // about if missing. We assert them as required.
    expect(manifest.manifest_version).toBe(3);
    expect(typeof manifest.name).toBe("string");
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(typeof manifest.version).toBe("string");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);

    // The toolbar action is what makes the sidepanel reachable.
    expect(manifest.action).toBeDefined();
    expect(manifest.action.default_title).toBeTruthy();

    // Service worker is the MV3 background surface.
    expect(manifest.background).toBeDefined();
    expect(manifest.background.service_worker).toBeTruthy();
    expect(manifest.background.type).toBe("module");

    // side_panel.default_path is what chrome.sidePanel.open() loads.
    expect(manifest.side_panel).toBeDefined();
    expect(manifest.side_panel.default_path).toBeTruthy();

    // Icons at all four sizes Chrome documents; the CRX plugin
    // copies them next to manifest.json, so the paths are bare
    // filenames (no leading "src/" or "dist/").
    expect(manifest.icons).toBeDefined();
    for (const size of ["16", "32", "48", "128"]) {
      expect(manifest.icons[size]).toBeTruthy();
      const iconFile = join(distDir, manifest.icons[size]);
      expect(existsSync(iconFile), `icon ${size} at ${iconFile}`).toBe(
        true,
      );
    }

    // The action's default_icon must be a 16/32/48/128 set.
    expect(manifest.action.default_icon).toBeDefined();
    for (const size of ["16", "32", "48", "128"]) {
      const ref = manifest.action.default_icon[size];
      expect(ref, `action icon ${size}`).toBeTruthy();
      expect(existsSync(join(distDir, ref))).toBe(true);
    }

    // commands must include the three D-17 chords.
    expect(manifest.commands).toBeDefined();
    expect(manifest.commands["open-sidepanel"]).toBeTruthy();
    expect(manifest.commands["quick-add"]).toBeTruthy();
    expect(manifest.commands["toggle-timer"]).toBeTruthy();
  });

  it("contains the service worker file the manifest references", () => {
    const manifest = JSON.parse(
      readFileSync(join(distDir, "manifest.json"), "utf8"),
    );
    const swRel = manifest.background.service_worker as string;
    const swPath = join(distDir, swRel);
    expect(existsSync(swPath)).toBe(true);
    const contents = readFileSync(swPath, "utf8");
    expect(contents.length).toBeGreaterThan(0);
  });

  it("contains the sidepanel HTML the manifest references", () => {
    const manifest = JSON.parse(
      readFileSync(join(distDir, "manifest.json"), "utf8"),
    );
    const sidepanelRel = manifest.side_panel.default_path as string;
    const sidepanelPath = join(distDir, sidepanelRel);
    expect(existsSync(sidepanelPath)).toBe(true);
    const html = readFileSync(sidepanelPath, "utf8");
    expect(html).toMatch(/<script[^>]+type="module"/);
  });

  it("sidepanel HTML resolves to a bundled JS file that exists", () => {
    const manifest = JSON.parse(
      readFileSync(join(distDir, "manifest.json"), "utf8"),
    );
    const sidepanelPath = join(distDir, manifest.side_panel.default_path as string);
    const html = readFileSync(sidepanelPath, "utf8");
    const match = html.match(/<script[^>]+src="([^"]+)"/);
    expect(match, "sidepanel html has a <script src>").toBeTruthy();
    const scriptRel = match![1] as string;
    const scriptPath = join(distDir, scriptRel);
    expect(existsSync(scriptPath), `sidepanel bundle at ${scriptPath}`).toBe(
      true,
    );
    const js = readFileSync(scriptPath, "utf8");
    expect(js).toMatch(/Sidetrack/);
  });
});
