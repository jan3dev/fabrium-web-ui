import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { buildArtifactRuntime } from "./scripts/build-artifact-runtime.mjs";

let artifactRuntime: Promise<void> | undefined;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // In `config`, before the dev server lists public/; once per process.
    {
      name: "artifact-runtime",
      async config() {
        await (artifactRuntime ??= buildArtifactRuntime());
      },
    },
    {
      name: "preview-frame-src",
      // deploy/Dockerfile sets PREVIEW_FRAME_SRC (empty: no previews); `zooid dev` and e2e use the default.
      transformIndexHtml: (html) =>
        html.replace("__PREVIEW_FRAME_SRC__", process.env.PREVIEW_FRAME_SRC ?? "http://*.preview.localhost:*"),
    },
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: { port: 5173 },
  build: { outDir: "dist" },
});
