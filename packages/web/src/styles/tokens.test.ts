import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Loads the real token sheets plus index.css's shadcn alias block (index.css
// itself starts with Tailwind at-rules the DOM shim can't parse).
const read = (file: string) => readFileSync(join(import.meta.dirname, file), "utf8");
const aliasBlock = /:root,\s*\[data-theme\]\s*\{[^}]*--background:[^}]*\}/.exec(read("../index.css"))?.[0];

describe("shadcn aliases", () => {
  const style = document.createElement("style");
  beforeAll(() => {
    style.textContent = [read("tokens.css"), read("fabrium-tokens.css"), aliasBlock].join("\n");
    document.head.append(style);
  });
  afterAll(() => {
    style.remove();
    delete document.documentElement.dataset.theme;
  });

  it("index.css still has the alias block", () => {
    expect(aliasBlock).toBeDefined();
  });

  it.each(["dark", "light"])("--background resolves to --surface-background in %s", (theme) => {
    document.documentElement.dataset.theme = theme;
    const css = getComputedStyle(document.documentElement);
    const background = css.getPropertyValue("--background").trim();
    expect(background).toBe(css.getPropertyValue("--surface-background").trim());
    expect(background).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("the two themes differ", () => {
    const value = (theme: string) => {
      document.documentElement.dataset.theme = theme;
      return getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
    };
    expect(value("dark")).not.toBe(value("light"));
  });
});
