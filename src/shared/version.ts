/**
 * Single source of truth for the extension's version string.
 *
 * Mirrors `version` in `package.json`. We do not import from package.json
 * because:
 *   1. The CRX plugin requires the manifest's `version` to be a literal
 *      string at config time, not a dynamic import.
 *   2. Vite's `import.meta.env.PACKAGE_VERSION` would need an extra
 *      `define` rule and would couple us to a particular plugin's
 *      opinion. A typed constant is simpler and traceable.
 *
 * The empty-state UI surfaces this string (D-12). Phase 5 injects a
 * build-time version when we cut a release.
 */
export const VERSION = "0.0.0";

/** Human-readable project name. Used in the empty state (D-12). */
export const PROJECT_NAME = "Sidetrack";
