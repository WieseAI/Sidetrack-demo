import { defineConfig } from "vitest/config";

// Test config is separate from vite.config.ts because:
//   1. The CRX plugin is for build only and has no role in unit tests.
//   2. Tests run in happy-dom, not a real browser, so the alias to
//      preact/compat is unnecessary.
export default defineConfig({
  resolve: {
    alias: {
      react: "preact/compat",
      "react-dom": "preact/compat",
    },
  },
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globals: false,
  },
});
