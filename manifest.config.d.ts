// The manifest export is a ManifestV3 literal (not a function or
// promise) — vite.config.ts and the manifest test both rely on this.
import type { ManifestV3 } from "@crxjs/vite-plugin";

declare const manifest: ManifestV3;
export default manifest;
