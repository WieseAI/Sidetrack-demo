/**
 * Theme resolution.
 *
 * The persisted state carries a `settings.theme` override of
 * "system" | "light" | "dark". This module turns the override
 * into the *effective* theme the UI should render by reading
 * `prefers-color-scheme` when the override is "system".
 *
 * Phase 5 also lets the user pick a theme in the settings
 * dialog. The sidepanel's top-level wrapper applies the
 * effective theme as a `data-theme` attribute on `<main>` and
 * the CSS uses `[data-theme="dark"]` /
 * `[data-theme="light"]` selectors layered on top of the
 * `prefers-color-scheme` rule. This module does not touch
 * CSS directly; it only computes the value the component
 * reads from.
 */

export type ThemeName = "light" | "dark";
export type ThemeOverride = "system" | ThemeName;

/** Resolve the override against the OS preference. Pure. */
export function resolveTheme(override: ThemeOverride): ThemeName {
  if (override === "light" || override === "dark") return override;
  // "system" — consult the media query. We only run this in
  // the browser; the storage default for tests is "system"
  // and `resolveTheme` then falls back to "light" so unit
  // tests that exercise a render path with no media-query
  // support see a deterministic value.
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

/** Human label for a theme override (used in the settings dialog). */
export function themeLabel(override: ThemeOverride): string {
  if (override === "system") return "Follow system";
  if (override === "dark") return "Dark";
  return "Light";
}
