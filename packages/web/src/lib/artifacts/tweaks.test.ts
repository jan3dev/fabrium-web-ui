import { describe, expect, it } from "vitest";
import { clampTweak, MAX_TWEAKS, readTweaks, tweakMessage, writeTweaks } from "./tweaks";

const doc = (json: string, body = "<section><h1 data-tweak=\"headline\">Hello</h1></section>") =>
  `<!doctype html><html><head><style>:root { --accent: #3355ff; --gap: 16px; }</style>` +
  `<script type="application/json" data-tweaks>${json}</script></head><body>${body}</body></html>`;

const CONTROLS = JSON.stringify([
  { name: "accent", label: "Accent color", type: "color", var: "--accent", value: "#3355ff" },
  { name: "gap", label: "Spacing", type: "range", var: "--gap", min: 4, max: 48, step: 4, unit: "px", value: 16 },
  { name: "headline", label: "Headline", type: "text", value: "Hello" },
]);

describe("readTweaks", () => {
  it("reads the spec's example", () => {
    const c = readTweaks(doc(CONTROLS));
    expect(c.map((x) => x.type)).toEqual(["color", "range", "text"]);
    expect(c[1]).toMatchObject({ var: "--gap", min: 4, max: 48, step: 4, unit: "px", value: 16 });
  });

  it("is empty without a script, with bad JSON or a non-list", () => {
    expect(readTweaks("<p>hi</p>")).toEqual([]);
    expect(readTweaks(doc("{not json"))).toEqual([]);
    expect(readTweaks(doc('{"name":"x"}'))).toEqual([]);
    expect(readTweaks(doc(CONTROLS).replace("data-tweaks>", "data-tweaks-old>"))).toEqual([]);
  });

  it("takes a text's value from the document", () => {
    const c = readTweaks(doc(CONTROLS, '<section><h1 data-tweak="headline">Shown</h1></section>'));
    expect(c.find((x) => x.name === "headline")?.value).toBe("Shown");
  });

  it("clamps what it can and drops what it cannot", () => {
    const c = readTweaks(
      doc(
        JSON.stringify([
          { name: "a", type: "range", var: "--a", min: 0, max: 10, value: 99 },
          { name: "b", type: "range", var: "--b", min: 5, max: 1, value: 2 },
          { name: "c", type: "color", var: "--c", value: "red" },
          { name: "d", type: "color", var: "--d; color: red", value: "#fff" },
          { name: "e", type: "select", var: "--e", options: ["solid", "x;y", { label: "Dashed", value: "dashed" }], value: "nope" },
          { name: "f", type: "toggle", var: "--f", on: "block", off: "none}", value: "yes" },
          { name: "g", type: "script", var: "--g", value: 1 },
          { name: "1bad", type: "text", value: "x" },
          { name: "a", type: "text", value: "duplicate" },
          { name: "h", type: "text", value: "y".repeat(2000) },
        ]),
      ),
    );
    expect(c.map((x) => x.name)).toEqual(["a", "e", "f", "h"]);
    expect(c[0]!.value).toBe(10);
    expect(c[1]).toMatchObject({ options: [{ value: "solid" }, { label: "Dashed", value: "dashed" }], value: "solid" });
    expect(c[2]).toMatchObject({ on: "block", off: "0", value: false });
    expect((c[3]!.value as string).length).toBe(500);
  });

  it("keeps at most 24 controls", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `t${i}`, type: "text", value: "" }));
    expect(readTweaks(doc(JSON.stringify(many)))).toHaveLength(MAX_TWEAKS);
  });
});

describe("clampTweak and tweakMessage", () => {
  const [color, range, text] = readTweaks(doc(CONTROLS));
  it("snaps ranges to the step and bounds", () => {
    expect(clampTweak(range!, 23)).toBe(24);
    expect(clampTweak(range!, -5)).toBe(4);
    expect(clampTweak(range!, "x")).toBe(16);
    expect(clampTweak(color!, "#ABC")).toBe("#aabbcc");
    expect(clampTweak(color!, "url(x)")).toBe("#3355ff");
  });
  it("gives vars and texts for the frame", () => {
    expect(tweakMessage([color!, range!, text!], { gap: 30, headline: "Hi" })).toEqual({
      vars: { "--accent": "", "--gap": "32px" },
      texts: { headline: "Hi" },
    });
  });
});

describe("writeTweaks", () => {
  it("writes the JSON values, the :root declarations and the text", () => {
    const out = writeTweaks(doc(CONTROLS), "slides", { accent: "#ff0000", gap: 24, headline: "New title" });
    expect(out).toContain(":root { --accent: #ff0000; --gap: 24px; }");
    expect(out).toContain('<h1 data-tweak="headline">New title</h1>');
    const after = readTweaks(out);
    expect(after.map((c) => c.value)).toEqual(["#ff0000", 24, "New title"]);
    // Kept twice: nothing else moves.
    expect(writeTweaks(out, "slides", {})).toBe(out);
  });

  it("adds a :root rule for a variable no rule declares", () => {
    const json = JSON.stringify([{ name: "r", type: "range", var: "--radius", min: 0, max: 20, value: 4, unit: "px" }]);
    const out = writeTweaks(doc(json), "design", { r: 8 });
    expect(out).toContain("<style>:root { --radius: 8px; }</style></head>");
  });

  it("does not touch var() references or longer names", () => {
    const html = doc(CONTROLS).replace(
      ":root { --accent: #3355ff; --gap: 16px; }",
      ":root { --accent-2: #000; --accent: #3355ff; --gap: 16px; --line: var(--accent); }",
    );
    const out = writeTweaks(html, "slides", { accent: "#00ff00" });
    expect(out).toContain(":root { --accent-2: #000; --accent: #00ff00; --gap: 16px; --line: var(--accent); }");
  });

  it("inserts text as text and escapes </ in the JSON", () => {
    const out = writeTweaks(doc(CONTROLS, '<h1 data-tweak="headline">Hello</h1>'), "html", {
      headline: "<img src=x onerror=alert(1)></script>",
    });
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;&lt;/script&gt;</h1>");
    expect(out).not.toContain("</script>\"");
    expect(readTweaks(out).find((c) => c.name === "headline")?.value).toBe("<img src=x onerror=alert(1)></script>");
  });

  it("escapes every < in the JSON, so <!-- cannot open an escaped script", () => {
    const out = writeTweaks(doc(CONTROLS), "slides", { headline: "<!--<script>" });
    expect(out).toContain('"value":"\\u003c!--\\u003cscript>"');
    expect(readTweaks(out).find((c) => c.name === "headline")?.value).toBe("<!--<script>");
  });

  it("writes a text whose data-tweak is on the frame itself", () => {
    const out = writeTweaks(doc(CONTROLS, '<section data-tweak="headline">Hello</section>'), "slides", { headline: "New" });
    expect(out).toContain('<section data-tweak="headline">New</section>');
  });

  it("ignores data-tweak names no control declares, even Object's own", () => {
    const html = doc(CONTROLS, '<h1 data-tweak="headline">Hello</h1><p data-tweak="toString">Keep</p>');
    expect(writeTweaks(html, "html", { headline: "New" })).toContain('<p data-tweak="toString">Keep</p>');
  });
});
