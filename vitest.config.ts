import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // @dnd-kit's CJS shims `require("react")`, which bypasses
      // Vite's resolver. We point the package entry at the ESM
      // build so all `react` imports go through Vite and hit the
      // alias below. We do the same for the related packages
      // that dnd-kit pulls in.
      "@dnd-kit/core": "@dnd-kit/core/dist/core.esm.js",
      "@dnd-kit/utilities": "@dnd-kit/utilities/dist/utilities.esm.js",
      "@dnd-kit/accessibility": "@dnd-kit/accessibility/dist/accessibility.esm.js",
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
