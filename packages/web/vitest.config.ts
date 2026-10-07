import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "node:path";

// Icons are decorative: they sit inside a labelled control or beside text.
const SVGR = {
  include: "**/*.svg?react",
  svgrOptions: { titleProp: true, svgProps: { "aria-hidden": "true", focusable: "false" } },
};

export default defineConfig({
  plugins: [react(), svgr(SVGR)],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
});
