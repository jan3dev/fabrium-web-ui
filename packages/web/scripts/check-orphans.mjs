// Orphan guard: every source file in src/ must be reachable from the app entry
// (src/main.tsx). Tests and stories are entries for nothing; a file only they
// import is an orphan. Run from packages/web.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const EXTS = [".ts", ".tsx", "/index.ts", "/index.tsx"];
const isAux = (f) =>
  /\.(test|stories)\.tsx?$/.test(f) ||
  f.endsWith(".d.ts") ||
  f.endsWith(".mdx");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function resolveSpec(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(src, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext;
  return null;
}

const IMPORT =
  /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(?\s*["']([^"']+)["']/g;
const seen = new Set();
const queue = [join(src, "main.tsx")];
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  if (!/\.tsx?$/.test(file)) continue;
  for (const m of readFileSync(file, "utf8").matchAll(IMPORT)) {
    const dep = resolveSpec(file, m[1] ?? m[2]);
    if (dep) queue.push(dep);
  }
}

const orphans = walk(src)
  .filter((f) => /\.tsx?$/.test(f) && !isAux(f) && !seen.has(f))
  .map((f) => relative(root, f));
if (orphans.length) {
  console.log(
    `\n✗ Not reachable from src/main.tsx; delete or wire up\n${orphans.join("\n")}`,
  );
  process.exit(1);
}
console.log("check-orphans: ok");
