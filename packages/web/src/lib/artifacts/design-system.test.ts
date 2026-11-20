import { describe, expect, it } from "vitest";
import {
  addValueRef,
  cssValue,
  designSystemSectionPage,
  designSystemSections,
  fontFamilies,
  LIMITS,
  parseDesignSystem,
  type DesignSystem,
} from "./design-system";

const FULL = {
  overview: "# Brand\n\nQuiet and clear.",
  colors: [{ name: "brand", value: "#3355ff", description: "Primary actions" }],
  spacing: [{ name: "sm", value: "8px" }],
  typography: [{ name: "h1", value: '600 32px/1.2 "Inter", sans-serif' }],
  radius: [{ name: "card", value: "12px" }],
  shadows: [{ name: "surface", value: "0 1px 2px rgb(0 0 0 / 0.2)" }],
  components: [{ name: "Button", description: "Primary action", html: '<button style="background:var(--color-brand)">Save</button>' }],
  assets: [{ name: "Logo", svg: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>' }],
  unknown: 1,
};

const parse = (v: unknown) => parseDesignSystem(JSON.stringify(v))!;

describe("parseDesignSystem", () => {
  it("reads a valid system", () => {
    const s = parse(FULL);
    expect(s.overview).toBe(FULL.overview);
    expect(s.colors).toEqual(FULL.colors);
    expect(s.components[0]).toEqual(FULL.components[0]);
    expect(s.assets[0]).toEqual(FULL.assets[0]);
    expect(designSystemSections(s).map((x) => x.key)).toEqual([
      "overview", "colors", "spacing", "typography", "radius", "shadows", "components", "assets",
    ]);
  });

  it("returns null for anything but a JSON object", () => {
    expect(parseDesignSystem("not json")).toBeNull();
    expect(parseDesignSystem("[]")).toBeNull();
    expect(parseDesignSystem("null")).toBeNull();
    expect(parseDesignSystem('"text"')).toBeNull();
  });

  it("drops items of the wrong shape and keeps the rest", () => {
    const s = parse({
      overview: 5,
      colors: [
        { name: "ok", value: "red" },
        { name: "", value: "red" },
        { name: "no-value" },
        { name: "num", value: 1 },
        { name: "bad-desc", value: "red", description: {} },
        "red",
        null,
        { name: "ok", value: "blue" }, // duplicate name
      ],
      spacing: { name: "sm", value: "8px" },
      components: [{ name: "No html" }, { name: "X", html: "<b>x</b>" }],
      assets: [{ svg: "<svg/>" }],
    });
    expect(s.overview).toBe("");
    expect(s.colors).toEqual([{ name: "ok", value: "red" }]);
    expect(s.spacing).toEqual([]);
    expect(s.components).toEqual([{ name: "X", html: "<b>x</b>" }]);
    expect(s.assets).toEqual([]);
    expect(designSystemSections(s)).toEqual([
      { key: "colors", label: "Colors", count: 1 },
      { key: "components", label: "Components", count: 1 },
    ]);
  });

  it("normalises token names to kebab-case", () => {
    expect(parse({ colors: [{ name: "Brand Primary!", value: "red" }] }).colors[0]!.name).toBe("brand-primary");
  });

  it("applies the limits", () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ name: `c${i}`, value: "red" }));
    const s = parse({
      overview: "x".repeat(LIMITS.overview + 10),
      colors: many,
      spacing: [{ name: "long", value: "x".repeat(LIMITS.value + 1) }],
      radius: [{ name: "n".repeat(LIMITS.name + 1), value: "1px" }],
      components: [{ name: "Big", html: "x".repeat(LIMITS.markup + 1) }],
    });
    expect(s.overview).toHaveLength(LIMITS.overview);
    expect(s.colors).toHaveLength(LIMITS.items);
    expect(s.spacing).toEqual([]);
    expect(s.radius).toEqual([]);
    expect(s.components).toEqual([]);
  });
});

describe("cssValue", () => {
  it("keeps ordinary values", () => {
    for (const v of ["#3355ff", "8px", '600 32px/1.2 "Inter", sans-serif', "0 1px 2px rgb(0 0 0 / 0.2)", "calc(1rem + 2px)"])
      expect(cssValue(v)).toBe(v);
  });
  it("rejects values that could leave their slot", () => {
    for (const v of ["red;}</style>", "red}", "a{", "red /* x", "x */", '"open', "rgb(0 0 0", "a)", "\\7d", "red\nblue"])
      expect(cssValue(v)).toBe("");
  });
});

describe("designSystemSectionPage", () => {
  const s = parse(FULL);

  it("exposes every token as a CSS variable on :root", () => {
    const page = designSystemSectionPage(s, "components");
    expect(page).toContain("--color-brand: #3355ff;");
    expect(page).toContain("--spacing-sm: 8px;");
    expect(page).toContain('--font-h1: 600 32px/1.2 "Inter", sans-serif;');
    expect(page).toContain("--radius-card: 12px;");
    expect(page).toContain("--shadow-surface: 0 1px 2px rgb(0 0 0 / 0.2);");
  });

  it("gives each item a stable id", () => {
    expect(designSystemSectionPage(s, "colors")).toContain('id="color-brand"');
    expect(designSystemSectionPage(s, "spacing")).toContain('id="spacing-sm"');
    expect(designSystemSectionPage(s, "typography")).toContain('id="font-h1"');
    expect(designSystemSectionPage(s, "radius")).toContain('id="radius-card"');
    expect(designSystemSectionPage(s, "shadows")).toContain('id="shadow-surface"');
    expect(designSystemSectionPage(s, "components")).toContain('id="component-1"');
    expect(designSystemSectionPage(s, "assets")).toContain('id="asset-1"');
  });

  it("puts each component and asset into its own shadow root, as data the page script cannot end", () => {
    const markup = (page: string) =>
      JSON.parse(/var M=(\[.*?\]);document/.exec(page)![1]!) as string[];
    expect(markup(designSystemSectionPage(s, "components"))).toEqual([FULL.components[0]!.html]);
    expect(markup(designSystemSectionPage(s, "assets"))[0]).toContain(FULL.assets[0]!.svg);
    const page = designSystemSectionPage(
      { ...parse({}), components: [{ name: "Broken", html: "<div><!-- </script><table>" }] },
      "components",
    );
    expect(page).toContain('attachShadow({mode:"open"})');
    expect(page.match(/<\/script>/g)).toHaveLength(1);
    expect(page).not.toContain("<!--");
    expect(markup(page)).toEqual(["<div><!-- </script><table>"]);
  });

  it("escapes a hostile value and name", () => {
    const evil = "red;}</style><script>alert(1)</script>";
    const hostile: DesignSystem = {
      ...parse({}),
      colors: [{ name: "x", value: evil, description: '"><img src=x onerror=alert(1)>' }],
      components: [{ name: '"><script>alert(2)</script>', html: "<b>ok</b>" }],
    };
    const colors = designSystemSectionPage(hostile, "colors");
    // Not a CSS variable at all, and only ever shown as text.
    expect(colors).not.toContain("--color-x:");
    expect(colors).not.toContain("<script>");
    expect(colors).toContain("red;}&lt;/style&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(colors).not.toContain("<img");
    expect(colors.match(/<\/style>/g)).toHaveLength(1);
    expect(colors).toContain('style="background:var(--color-x)"');

    const components = designSystemSectionPage(hostile, "components");
    expect(components).not.toContain("<script>alert");
    expect(components).toContain("&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("re-normalises names on a hand-built system", () => {
    const page = designSystemSectionPage({ ...parse({}), colors: [{ name: 'a"b c', value: "red" }] }, "colors");
    expect(page).toContain("--color-a-b-c: red;");
    expect(page).toContain('id="color-a-b-c"');
    expect(page).toContain("a&quot;b c");
  });
});

describe("addValueRef", () => {
  it("builds the annotation for the composer", () => {
    expect(addValueRef("radius", " pill ", " 999px ")).toEqual({
      target: { kind: "text", text: "pill: 999px", where: "Corner radius" },
      note: "Add this value to the design system.",
    });
  });
});

describe("fontFamilies", () => {
  it("takes the family from a font shorthand, or the whole value without a size", () => {
    expect(
      fontFamilies([
        { name: "h1", value: '600 32px/1.2 "Inter", sans-serif' },
        { name: "body", value: "1rem Georgia, serif" },
        { name: "mono", value: "ui-monospace, monospace" },
        { name: "dup", value: '400 14px "Inter", sans-serif' },
      ]),
    ).toEqual(['"Inter", sans-serif', "Georgia, serif", "ui-monospace, monospace"]);
  });
});
