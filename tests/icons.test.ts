import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Icon-presence test.
 *
 * Chrome refuses to load an extension that references an icon file
 * the manifest names but the bundle does not contain. The CRX plugin
 * copies icons declared in the manifest automatically, but only
 * those declared there. This test fails fast if the icon files
 * listed in src/assets/icons/ don't all exist on disk before the
 * build runs.
 */
const repoRoot = resolve(__dirname, "..");
const iconsDir = join(repoRoot, "src", "assets", "icons");

describe("action icons", () => {
  for (const size of [16, 32, 48, 128]) {
    it(`icon-${size}.png exists and is a valid PNG`, () => {
      const file = join(iconsDir, `icon-${size}.png`);
      expect(existsSync(file), file).toBe(true);
      const buf = readFileSync(file);
      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      const sig = [137, 80, 78, 71, 13, 10, 26, 10];
      expect(sig.every((v, i) => buf[i] === v)).toBe(true);
    });
  }
});
