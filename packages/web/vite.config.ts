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
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: { port: 5173 },
  build: { outDir: "dist" },
});
