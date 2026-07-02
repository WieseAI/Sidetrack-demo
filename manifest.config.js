// Single source of truth for the MV3 manifest. Lives in its own file
// (not vite.config.ts) so the build-verification test in tests/build.test.ts
// can import it and assert the same fields the CRX plugin will rewrite.
import { VERSION } from "./src/shared/version.js";

/** @type {import("@crxjs/vite-plugin").ManifestV3} */
export default {
  manifest_version: 3,
  name: "Sidetrack",
  version: VERSION,
  description:
    "A Chrome sidepanel that combines a kanban board with per-task time tracking. Offline-first, local-only.",
  minimum_chrome_version: "114",
  icons: {
    "16": "src/assets/icons/icon-16.png",
    "32": "src/assets/icons/icon-32.png",
    "48": "src/assets/icons/icon-48.png",
    "128": "src/assets/icons/icon-128.png",
  },
  action: {
    default_title: "Sidetrack",
    default_icon: {
      "16": "src/assets/icons/icon-16.png",
      "32": "src/assets/icons/icon-32.png",
      "48": "src/assets/icons/icon-48.png",
      "128": "src/assets/icons/icon-128.png",
    },
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  permissions: ["sidePanel", "storage", "alarms", "idle", "contextMenus", "notifications"],
  host_permissions: [],
  commands: {
    "open-sidepanel": {
      suggested_key: { default: "Alt+Shift+S" },
      description: "Open the Sidetrack sidepanel",
    },
    "quick-add": {
      suggested_key: { default: "Alt+Shift+A" },
      description: "Quick-add a card in the focused column",
    },
    "toggle-timer": {
      suggested_key: { default: "Alt+Shift+T" },
      description: "Start or stop the timer on the focused card",
    },
  },
};
