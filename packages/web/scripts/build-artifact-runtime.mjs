// Vendor the artifact preview runtimes into public/artifact-runtime/ (gitignored).
// Runs from vite.config.ts on every dev server, build and `vite build --watch`.
// Previews run under `default-src 'none'` (src/lib/artifacts/srcdoc.ts), so the
// frame can't fetch anything. The parent fetches these files from its own origin
// and hands the source to the frame over postMessage.
// Babel and Tailwind ship browser globals and are copied; React 19 has no UMD
// build, so it is bundled through a shim that assigns the globals.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public/artifact-runtime");
const require = createRequire(join(root, "package.json"));

const SOURCES = ["@babel/standalone", "@tailwindcss/browser", "react", "react-dom"];

export async function buildArtifactRuntime() {
  // Skip when the vendored files came from these package versions and this script.
  const stamp = JSON.stringify([
    createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),
    ...(await Promise.all(
      SOURCES.map(async (name) => {
        const pkg = JSON.parse(await readFile(require.resolve(`${name}/package.json`), "utf8"));
        return `${name}@${pkg.version}`;
      }),
    )),
  ]);
  const stampFile = join(outDir, ".stamp");
  if ((await readFile(stampFile, "utf8").catch(() => "")) === stamp) return;
  await mkdir(outDir, { recursive: true });

  for (const [name, from] of [
    ["jsx", "@babel/standalone/babel.min.js"],
    ["tailwind", "@tailwindcss/browser"],
  ]) {
    const source = await readFile(require.resolve(from), "utf8");
    // The frame's CSP would block a source map fetch anyway.
    await writeFile(
      join(outDir, `${name}.js`),
      source.replace(/\n?\/\/# sourceMappingURL=.*$/m, "\n"),
    );
  }

  // Per process: parallel builds must not delete each other's entry.
  const entry = join(outDir, `.react.entry.${process.pid}.js`);
  await writeFile(
    entry,
    'import * as React from "react";\nimport * as ReactDOM from "react-dom/client";\nwindow.React = React;\nwindow.ReactDOM = ReactDOM;\n',
  );
  try {
    await build({
      configFile: false,
      logLevel: "warn",
      root,
      publicDir: false,
      define: { "process.env.NODE_ENV": '"production"' },
      build: {
        outDir,
        emptyOutDir: false,
        lib: {
          entry,
          formats: ["iife"],
          name: "FabriumReactRuntime",
          fileName: () => "react.js",
        },
      },
    });
  } finally {
    await rm(entry, { force: true });
  }
  await writeFile(stampFile, stamp);
}
