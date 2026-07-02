/**
 * Phase 5 — Accessibility contrast check.
 *
 * Issue #11 ("Accessibility & keyboard pass") lists the
 * "Automated contrast check" as a Phase 5 acceptance
 * criterion: every text-on-background pair in the light
 * and dark themes should be at least WCAG AA.
 *
 * axe-core is the de-facto choice for a full DOM-driven
 * a11y pass, but the sidepanel's visual structure is
 * driven by hand-picked CSS variables in
 * `src/sidepanel/styles.css`. The unit-level test below
 * reads the variable values straight out of the CSS and
 * asserts the ratio for each pair that the rest of the
 * stylesheet actually uses. A future Playwright +
 * axe-core pass (filed as a follow-up in the Phase 5
 * report) will catch anything we miss here.
 *
 * Algorithm: WCAG 2.x relative luminance.
 *   https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 *   https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 *
 * For normal text we require >= 4.5:1, for large text
 * (>= 18pt regular or 14pt bold) we require >= 3:1.
 * Every pair in the design tokens above is normal text
 * (small chip / label / button copy), so the threshold
 * is 4.5:1.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const STYLES_PATH = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "src",
  "sidepanel",
  "styles.css",
);

interface Tokens {
  [k: string]: string;
}

/** Parse the `--color-foo: #abcdef;` lines out of a CSS
 *  block. The CSS uses two parallel rule sets (one in
 *  `:root`, one inside the prefers-color-scheme + the
 *  `[data-theme="dark"]` block); the latter is the
 *  "dark theme" token map. We split on the dark block
 *  boundary so the test reads both maps explicitly. */
function readTokens(css: string, blockBoundary: RegExp): Tokens {
  const match = css.match(blockBoundary);
  if (!match) throw new Error("CSS block not found: " + blockBoundary);
  const block = match[0];
  const tokens: Tokens = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*--([a-z0-9-]+):\s*([^;]+);/);
    if (m) tokens[m[1]!] = m[2]!.trim();
  }
  return tokens;
}

const stylesCss = readFileSync(STYLES_PATH, "utf8");
const lightTokens = readTokens(stylesCss, /:root\s*\{[\s\S]*?\}\s*(?=@media|\[data-theme)/);
const darkTokens = readTokens(stylesCss, /\[data-theme="dark"\]\s*\{[\s\S]*?\}/);

/** Parse any color string we use in the stylesheet (hex or
 *  rgba()). Returns the r, g, b channels and an alpha
 *  component (1.0 for hex). */
type Rgba = { r: number; g: number; b: number; a: number };
function parseColor(value: string): Rgba {
  const trimmed = value.trim();
  const hex = trimmed.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 1 };
  }
  const m = trimmed.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:\s*,\s*([\d.]+))?/i);
  if (m) {
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] !== undefined ? Number(m[4]) : 1,
    };
  }
  throw new Error(`bad color: ${value}`);
}

/** Alpha-composite a translucent color over a solid background. */
function composite(fg: Rgba, bg: [number, number, number]): [number, number, number] {
  if (fg.a >= 1) return [fg.r, fg.g, fg.b];
  return [
    Math.round(fg.r * fg.a + bg[0] * (1 - fg.a)),
    Math.round(fg.g * fg.a + bg[1] * (1 - fg.a)),
    Math.round(fg.b * fg.a + bg[2] * (1 - fg.a)),
  ];
}

function hexToRgb(hex: string): [number, number, number] {
  const c = parseColor(hex);
  return [c.r, c.g, c.b];
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb;
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

function contrastRatio(
  fg: [number, number, number],
  bg: [number, number, number],
): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Resolve a token name to a concrete rgb triple, alpha-
 *  compositing any translucent value over the named
 *  base. The base is the surface the token actually sits
 *  on in the design (surface-2 for badge / chip tokens;
 *  bg for bar tokens). The CSS uses rgba for soft accent
 *  backgrounds so the test must composite to get the
 *  effective contrast. */
function resolve(
  tokens: Tokens,
  name: string,
  compositeOver: string,
): [number, number, number] {
  const raw = tokens[name];
  if (raw === undefined) throw new Error(`unknown token: ${name}`);
  const c = parseColor(raw);
  if (c.a >= 1) return [c.r, c.g, c.b];
  return composite(c, hexToRgb(tokens[compositeOver]!));
}

const pairs: Array<{
  fg: string;
  bg: string;
  threshold: number;
  desc: string;
}> = [
  // Light theme
  { fg: "color-text", bg: "color-bg", threshold: 4.5, desc: "body on background" },
  { fg: "color-text", bg: "color-surface", threshold: 4.5, desc: "text on card" },
  { fg: "color-text", bg: "color-surface-2", threshold: 4.5, desc: "text on column" },
  { fg: "color-text-muted", bg: "color-bg", threshold: 4.5, desc: "muted on bg" },
  { fg: "color-text-muted", bg: "color-surface", threshold: 4.5, desc: "muted on card" },
  { fg: "color-text-muted", bg: "color-surface-2", threshold: 4.5, desc: "muted on column" },
  { fg: "color-text-subtle", bg: "color-bg", threshold: 4.5, desc: "subtle on bg" },
  { fg: "color-text-subtle", bg: "color-surface", threshold: 4.5, desc: "subtle on card" },
  { fg: "color-text-subtle", bg: "color-surface-2", threshold: 4.5, desc: "subtle on column" },
  // accent-soft is translucent; composite over the column surface-2
  // (the "Inbox" badge surface) and over the body bg (the running-bar).
  // The "Inbox" badge is the only place accent text sits on
  // accent-soft in the light theme; in the dark theme the
  // rgba(...,0.12) is so transparent it is effectively the
  // surface underneath. The running bar text uses color-text,
  // not color-accent, so it is covered above.
  { fg: "color-accent", bg: "color-accent-soft", threshold: 4.5, desc: "accent on accent-soft (light, over surface-2)" },
  { fg: "color-accent-fg", bg: "color-accent", threshold: 4.5, desc: "primary button label" },
  { fg: "color-danger", bg: "color-surface", threshold: 4.5, desc: "danger text on card" },
  { fg: "color-danger-fg", bg: "color-danger", threshold: 4.5, desc: "danger button label" },
  { fg: "color-text", bg: "color-kbd-bg", threshold: 4.5, desc: "kbd text" },
  // Dark theme
  { fg: "color-text", bg: "color-bg", threshold: 4.5, desc: "dark: body on background" },
  { fg: "color-text", bg: "color-surface", threshold: 4.5, desc: "dark: text on card" },
  { fg: "color-text", bg: "color-surface-2", threshold: 4.5, desc: "dark: text on column" },
  { fg: "color-text-muted", bg: "color-bg", threshold: 4.5, desc: "dark: muted on bg" },
  { fg: "color-text-muted", bg: "color-surface", threshold: 4.5, desc: "dark: muted on card" },
  { fg: "color-text-muted", bg: "color-surface-2", threshold: 4.5, desc: "dark: muted on column" },
  { fg: "color-text-subtle", bg: "color-bg", threshold: 4.5, desc: "dark: subtle on bg" },
  { fg: "color-text-subtle", bg: "color-surface", threshold: 4.5, desc: "dark: subtle on card" },
  { fg: "color-text-subtle", bg: "color-surface-2", threshold: 4.5, desc: "dark: subtle on column" },
  { fg: "color-accent", bg: "color-accent-soft", threshold: 4.5, desc: "dark: accent on accent-soft" },
  { fg: "color-accent-fg", bg: "color-accent", threshold: 4.5, desc: "dark: primary button label" },
  { fg: "color-danger", bg: "color-surface", threshold: 4.5, desc: "dark: danger text on card" },
  { fg: "color-danger-fg", bg: "color-danger", threshold: 4.5, desc: "dark: danger button label" },
  { fg: "color-text", bg: "color-kbd-bg", threshold: 4.5, desc: "dark: kbd text" },
  { fg: "color-accent", bg: "color-surface-2", threshold: 4.5, desc: "dark: idle-prompt card title" },
  { fg: "color-warn", bg: "color-surface", threshold: 4.5, desc: "dark: warn entry source" },
  { fg: "color-success", bg: "color-surface", threshold: 4.5, desc: "dark: success on card" },
];

describe("Phase 5 — WCAG AA contrast for design tokens", () => {
  for (const { fg, bg, threshold, desc } of pairs) {
    const isDark = desc.startsWith("dark:");
    const tokens = isDark ? darkTokens : lightTokens;
    // Compositing base: surface-2 is the most common backdrop
    // for badge / chip / running-bar text. Pair tests where
    // the bg is a solid surface use that surface directly.
    const compositeBase =
      bg === "color-bg"
        ? "color-bg"
        : bg === "color-surface"
          ? "color-surface"
          : bg === "color-surface-2"
            ? "color-surface-2"
            : "color-surface-2";
    const ratio = contrastRatio(
      hexToRgb(tokens[fg]!),
      resolve(tokens, bg, compositeBase),
    );
    it(`${isDark ? "dark: " : ""}${desc} meets ${threshold}:1 (got ${ratio.toFixed(2)})`, () => {
      expect(
        ratio,
        `light: ${fg}=${tokens[fg]} on ${bg}=${tokens[bg]}: ${ratio.toFixed(2)} (need ${threshold})`,
      ).toBeGreaterThanOrEqual(threshold);
    });
  }
});
