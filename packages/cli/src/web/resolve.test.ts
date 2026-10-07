import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWebRoot, webPackageDir } from "./resolve.js";

let root: string;
let cliRoot: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zooid-resolve-"));
  cliRoot = join(root, "packages", "cli");
  mkdirSync(cliRoot, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.ZOOID_DEV_WEB_ROOT_OVERRIDE;
});

function buildWeb(): string {
  const dist = join(root, "packages", "web", "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "index.html"), "<html/>");
  return dist;
}

describe("resolveWebRoot", () => {
  it("env override wins over the in-repo dist", () => {
    buildWeb();
    const override = join(root, "override");
    mkdirSync(override, { recursive: true });
    writeFileSync(join(override, "index.html"), "<html/>");
    process.env.ZOOID_DEV_WEB_ROOT_OVERRIDE = override;
    expect(resolveWebRoot(cliRoot)).toBe(override);
  });

  it("serves packages/web/dist from the repo", () => {
    const dist = buildWeb();
    expect(resolveWebRoot(cliRoot)).toBe(dist);
  });

  it("ignores an override without index.html", () => {
    const dist = buildWeb();
    process.env.ZOOID_DEV_WEB_ROOT_OVERRIDE = join(root, "missing");
    expect(resolveWebRoot(cliRoot)).toBe(dist);
  });

  it("tells the user to build when dist is missing", () => {
    expect(() => resolveWebRoot(cliRoot)).toThrow("pnpm -C packages/web build");
  });
});

describe("webPackageDir", () => {
  it("is the sibling packages/web", () => {
    expect(webPackageDir(cliRoot)).toBe(join(root, "packages", "web"));
  });
});
