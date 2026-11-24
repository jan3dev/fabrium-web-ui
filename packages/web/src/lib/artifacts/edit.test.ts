import { describe, expect, it } from "vitest";
import { lineDiff } from "@/lib/line-diff";
import { parseDesignSystem } from "./design-system";
import {
  addFrame,
  artboardSection,
  addToken,
  changedFrames,
  deleteFrame,
  duplicateFrame,
  frameSources,
  moveFrame,
  pasteFrame,
  renameFrame,
  resizeFrame,
  setComponentDescription,
  setFrameNotes,
  setFrameSkip,
  setOverview,
  setSlideSize,
  setTokenField,
  slideLayouts,
  readLayouts,
  withFrames,
} from "./edit";
import { readFrames } from "./frames";

const DECK = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>section { font: 600 96px system-ui }</style>
</head>
<body data-transition="fade">
  <section data-title='One'><h1>Welcome</h1><br/><p>Hello &amp; hi</p></section>
  <section><h1>Two</h1><aside data-notes>Say two.</aside></section>
  <!-- <section>not a slide</section> -->
  <section><h2>Three</h2><script>const s = "<section>";</script></section>
</body>
</html>
`;

const names = (html: string) => readFrames("slides", html).map((f) => f.name);
/** Lines the edit changed: a small diff, never a rewritten document. */
const changed = (a: string, b: string) => lineDiff(a, b).filter((r) => r.type !== "ctx").length;

describe("frame edits", () => {
  it("cuts the source into its raw sections", () => {
    expect(frameSources(DECK)).toEqual([
      `<section data-title='One'><h1>Welcome</h1><br/><p>Hello &amp; hi</p></section>`,
      `<section><h1>Two</h1><aside data-notes>Say two.</aside></section>`,
      `<section><h2>Three</h2><script>const s = "<section>";</script></section>`,
    ]);
  });

  it("moves, duplicates and deletes sections without touching the rest", () => {
    const moved = moveFrame(DECK, 2, 0);
    expect(names(moved)).toEqual(["Three", "One", "Two"]);
    // C moves before A; the comment between B and C stays in its place.
    expect(changed(DECK, moved)).toBe(4);
    expect(moved.startsWith("<!DOCTYPE html>\n<html lang=\"en\">")).toBe(true);
    expect(moved).toContain("<br/>");

    const dup = duplicateFrame(DECK, 1);
    expect(names(dup)).toEqual(["One", "Two", "Two", "Three"]);
    expect(changed(DECK, dup)).toBe(1);
    expect(dup).toContain(`Say two.</aside></section>\n  <section><h1>Two</h1>`);

    const del = deleteFrame(DECK, 0);
    expect(names(del)).toEqual(["Two", "Three"]);
    expect(changed(DECK, del)).toBe(1);
    expect(deleteFrame(deleteFrame(del, 0), 0)).toBe(deleteFrame(del, 0));
  });

  it("rewrites only the start tag for skip, rename and resize", () => {
    const skipped = setFrameSkip(DECK, 0, true);
    expect(readFrames("slides", skipped)[0]!.skip).toBe(true);
    expect(skipped).toContain(`<section data-title="One" data-skip><h1>Welcome</h1><br/>`);
    expect(changed(DECK, skipped)).toBe(2);
    expect(setFrameSkip(skipped, 0, false)).toContain(`<section data-title="One"><h1>`);

    expect(names(renameFrame(DECK, "slides", 1, '  New "name" '))).toEqual(["One", 'New "name"', "Three"]);
    const design = `<body><section data-name="Home" data-width="1440"><p>x</p></section></body>`;
    expect(renameFrame(design, "design", 0, "Start")).toContain(`data-name="Start"`);
    expect(readFrames("design", resizeFrame(design, 0, 390, 99999))[0]).toMatchObject({ width: 390, height: 10000 });
  });

  it("sets the size of every slide on the body, and removes it for 16:9", () => {
    const narrow = setSlideSize(DECK, "4:3");
    expect(readFrames("slides", narrow).map((f) => [f.width, f.height])).toEqual(Array(3).fill([1440, 1080]));
    expect(changed(DECK, narrow)).toBe(2);
    expect(setSlideSize(narrow, "16:9")).toBe(DECK);
    // A `<body` in a comment is not the tag; a source without one is re-serialized.
    const odd = setSlideSize(`<!-- <body> --><body class="a"><section></section></body>`, "4:3");
    expect(odd).toBe(`<!-- <body> --><body class="a" data-size="4:3"><section></section></body>`);
    expect(readFrames("slides", setSlideSize("<section></section>", "4:3"))[0]).toMatchObject({ width: 1440 });
    expect(readFrames("slides", `<body data-size="toString"><section></section></body>`)[0]).toMatchObject({ width: 1920 });
  });

  it("adds a given section after a frame, and blank artboards of a size", () => {
    const added = addFrame(DECK, 1, "<section><h2>New</h2></section>");
    expect(frameSources(added)).toHaveLength(4);
    expect(names(added)).toEqual(["One", "Two", "New", "Three"]);
    expect(changed(DECK, added)).toBe(1);
    expect(artboardSection({ width: 834, height: 1194 })).toBe(`<section data-width="834" data-height="1194"></section>`);
    expect(artboardSection({ width: 5, height: 99999 })).toBe(`<section data-width="100" data-height="10000"></section>`);
  });

  it("pastes only a section, re-serialized", () => {
    expect(pasteFrame(DECK, 0, "just text")).toBeNull();
    const pasted = pasteFrame(DECK, 0, `<section data-title="Pasted"><p>Hi</p></section></body><script>alert(1)</script>`)!;
    expect(names(pasted)).toEqual(["One", "Pasted", "Two", "Three"]);
    expect(pasted).not.toContain("alert(1)");
  });

  it("sets notes as plain text and removes empty ones", () => {
    const notes = setFrameNotes(DECK, 0, "<b>Bold</b> & more");
    expect(readFrames("slides", notes)[0]!.notes).toBe("<b>Bold</b> & more");
    expect(notes).toContain("&lt;b&gt;Bold&lt;/b&gt; &amp; more</aside>");
    expect(readFrames("slides", setFrameNotes(DECK, 1, "Changed"))[1]!.notes).toBe("Changed");
    expect(readFrames("slides", setFrameNotes(DECK, 1, "  "))[1]!.notes).toBe("");
    expect(setFrameNotes(DECK, 0, "")).toBe(DECK);
  });

  it("falls back to the parsed document when the cut does not match it", () => {
    // A section nested in a div is no frame, but the source scan sees it.
    const html = `<body><div><section>nested</section></div><section><p>A</p></section><section><p>B</p></section></body>`;
    expect(frameSources(moveFrame(html, 1, 0))).toEqual(["<section><p>B</p></section>", "<section><p>A</p></section>"]);
    expect(moveFrame(html, 1, 0)).toContain("<div><section>nested</section></div>");
  });

  it("finds the changed frames of a new version", () => {
    expect(changedFrames(DECK, DECK)).toEqual([]);
    expect(changedFrames(DECK, setFrameSkip(DECK, 2, true))).toEqual([2]);
    expect(changedFrames(DECK, moveFrame(DECK, 2, 0))).toEqual([0]);
    expect(changedFrames(DECK, duplicateFrame(DECK, 0))).toEqual([1]);
  });
});

const LAYOUT_DECK = `<!doctype html>
<html><head>
<style>.slide{padding:80px}</style>
<template data-layout="table"><section class="slide"><h2>Agent table</h2><table><tr><td>x</td></tr></table></section></template>
<template data-layout="table"><section><p>Second table template</p></section></template>
<template data-layout="quote"><p>No section here</p></template>
<template data-layout="bogus"><section><p>Unknown name</p></section></template>
</head>
<body>
<section class="slide" style="color:navy" data-title="One"><h1>One</h1></section>
<section class="slide"><h2>Two</h2></section>
</body></html>
`;

describe("slide layouts", () => {
  it("reads the deck's layout templates: known names, first section, first template per name", () => {
    expect(readLayouts(LAYOUT_DECK)).toEqual({
      table: '<section class="slide"><h2>Agent table</h2><table><tbody><tr><td>x</td></tr></tbody></table></section>',
    });
    expect(readLayouts("<body><template data-layout=\"title\"><section></section></template></body>")).toEqual({});
  });

  it("builds the layouts the deck lacks from plain elements with the slide's class and style", () => {
    const layouts = slideLayouts(LAYOUT_DECK, 0);
    expect(layouts.map((l) => l.label)).toEqual([
      "Blank",
      "Title",
      "Section",
      "Title and body",
      "Bullets",
      "Two columns",
      "Table",
      "Quote",
      "Image and caption",
      "Closing",
    ]);
    const by = Object.fromEntries(layouts.map((l) => [l.name, l.section]));
    expect(by.table).toContain("Agent table");
    expect(by.blank).toBe('<section class="slide" style="color:navy"></section>');
    expect(by.bullets).toBe(
      '<section class="slide" style="color:navy"><h2>Slide title</h2><ul><li>First point</li><li>Second point</li><li>Third point</li></ul></section>',
    );
    expect(by["two-columns"]).toContain('style="display:grid;grid-template-columns:1fr 1fr;gap:48px"');
    expect(by["image-caption"]).toContain("<figure><div style=");
    expect(by.quote).toContain("<blockquote><p>Quote text</p></blockquote>");
    expect(slideLayouts("<body><section></section></body>", 0)[6]!.section).toMatch(/^<section><h2>Slide title<\/h2><table><thead>/);
  });

  it("keeps a deck with layout templates on the small-diff path", () => {
    expect(frameSources(LAYOUT_DECK)).toEqual([
      '<section class="slide" style="color:navy" data-title="One"><h1>One</h1></section>',
      '<section class="slide"><h2>Two</h2></section>',
    ]);
    const added = addFrame(LAYOUT_DECK, 0, slideLayouts(LAYOUT_DECK, 0)[6]!.section);
    expect(changed(LAYOUT_DECK, added)).toBe(1);
    expect(changed(LAYOUT_DECK, moveFrame(LAYOUT_DECK, 1, 0))).toBe(2);
    expect(added).toContain('<template data-layout="bogus">');
  });

  it("previews candidate sections in the deck's head and body", () => {
    const doc = withFrames(LAYOUT_DECK, ["<section><p>A</p></section>", "<section><p>B</p></section>"]);
    expect(frameSources(doc)).toEqual(["<section><p>A</p></section>", "<section><p>B</p></section>"]);
    expect(doc).toContain("<style>.slide{padding:80px}</style>");
  });
});

describe("design-system edits", () => {
  const DS = `{
    "overview": "Hi",
    "colors": [
        { "name": "Brand Blue", "value": "red", "description": "Main" },
        { "name": "ink", "value": "black" }
    ],
    "components": [{ "name": "Button", "html": "<button>Go</button>" }]
}
`;

  it("edits values and notes in place, keeping the indent", () => {
    const edited = setTokenField(DS, "colors", "brand-blue", "value", "blue");
    expect(parseDesignSystem(edited)!.colors[0]).toEqual({ name: "brand-blue", value: "blue", description: "Main" });
    expect(edited).toMatch(/^\{\n {4}"overview"/);
    expect(edited.endsWith("}\n")).toBe(true);
    expect(parseDesignSystem(setTokenField(DS, "colors", "brand-blue", "description", " "))!.colors[0]).toEqual({
      name: "brand-blue",
      value: "red",
    });
    expect(setTokenField(DS, "colors", "brand-blue", "value", "  ")).toBe(DS);
  });

  it("adds a value, or replaces one of the same name", () => {
    expect(parseDesignSystem(addToken(DS, "spacing", "sm", "8px"))!.spacing).toEqual([{ name: "sm", value: "8px" }]);
    expect(parseDesignSystem(addToken(DS, "colors", "Ink", "gray"))!.colors[1]).toEqual({ name: "ink", value: "gray" });
    expect(addToken(DS, "colors", "!!", "x")).toBe(DS);
  });

  it("edits the overview and component notes", () => {
    expect(parseDesignSystem(setOverview(DS, "# New"))!.overview).toBe("# New");
    expect(parseDesignSystem(setComponentDescription(DS, "Button", "Primary action"))!.components[0]!.description).toBe(
      "Primary action",
    );
    expect(setOverview(`{"a":1}`, "x")).toBe(`{"a":1,"overview":"x"}`);
    expect(() => setOverview("[]", "x")).toThrow();
  });
});
