import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { resolve } from "node:path";
import manifest from "./manifest.config.js";

// Phase 0 deliverable: a loadable MV3 extension with a sidepanel that
// renders an empty state. Vite produces dist/ and the CRX plugin
// rewrites the manifest with hashed asset paths.
export default defineConfig({
  resolve: {
    alias: {
      // Preact aliases the React imports for libraries that hardcode them
      // (per D-13 in docs/gsd/01-decisions.md). The data layer must not
      // import from "react" or "preact" — that boundary is enforced in
      // code review, not at build time.
      react: "preact/compat",
      "react-dom": "preact/compat",
    },
  },
  plugins: [crx({ manifest })],
  build: {
    target: "esnext",
    sourcemap: false,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "src/sidepanel/index.html"),
        background: resolve(__dirname, "src/background/index.ts"),
      },
      output: {
        // Stable, predictable filenames for the entry points the manifest
        // references. The CRX plugin handles hashing of dynamic chunks.
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name].js",
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
