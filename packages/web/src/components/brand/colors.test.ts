import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BRAND_COLORS, BRAND_COLOR_PRIMITIVES } from "./colors";

// Reads the real stylesheets, so a copied value can't drift from the tokens silently.
const TOKENS = readFileSync(join(import.meta.dirname, "../../styles/tokens.css"), "utf8");
const INDEX_HTML = readFileSync(join(import.meta.dirname, "../../../index.html"), "utf8");

function primitive(name: string): string | undefined {
  const match = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(TOKENS);
  return match?.[1]?.trim().toLowerCase();
}

describe("brand colours", () => {
  it.each(Object.keys(BRAND_COLORS) as (keyof typeof BRAND_COLORS)[])(
    "%s still equals the primitive it names",
    (key) => {
      const name = BRAND_COLOR_PRIMITIVES[key];
      const declared = primitive(name);
      expect(declared, `${name} is not declared in tokens.css`).toBeDefined();
      expect(declared).toBe(BRAND_COLORS[key].toLowerCase());
    },
  );

  it("index.html's theme bootstrap uses the same values", () => {
    expect(INDEX_HTML).toContain(BRAND_COLORS.background);
    expect(INDEX_HTML).toContain(BRAND_COLORS.foreground);
  });
});
