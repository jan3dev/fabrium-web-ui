import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Icons are decorative: they sit inside a labelled control or beside text.
const SVGR = {
  include: "**/*.svg?react",
  svgrOptions: { titleProp: true, svgProps: { "aria-hidden": "true", focusable: "false" } },
};

export default defineConfig({
  plugins: [react(), svgr(SVGR), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: { port: 5173 },
  build: { outDir: "dist" },
});
