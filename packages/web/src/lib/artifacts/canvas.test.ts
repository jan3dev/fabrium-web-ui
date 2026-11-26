import { describe, expect, it } from "vitest";
import { MAX_ASSETS } from "./assets";
import { CanvasDoc, editKeyOf, gestureGate, type Op, readOp, readSelection } from "./canvas";

const DECK = `<!doctype html>
<html><head><style>section{padding:64px}</style></head>
<body>
<section><h1>Launch plan</h1><p>Body <b>bold</b></p><div data-lock><p>Footer</p></div></section>
<section data-title="Two">
  <p data-free style="position:absolute;left:100px;top:50px;width:200px;height:80px">Free</p>
  <p data-free style="position:absolute;left:400px;top:150px;width:100px;height:40px">Other</p>
  <aside data-notes>Notes</aside>
</section>
<script>document.body.append(document.createElement('div'))</script>
</body></html>`;

/** The id of the innermost element whose text is `text`, from the stamped document. */
function idOf(doc: CanvasDoc, text: string): string {
  const parsed = new DOMParser().parseFromString(doc.stamped(), "text/html");
  const el = [...parsed.body.querySelectorAll("[data-fab-id]")]
    .reverse()
    .find((e) => e.textContent?.trim() === text);
  return el!.getAttribute("data-fab-id")!;
}

/** Applies raw (frame) ops through the validator, as the panel does. */
function applyRaw(doc: CanvasDoc, raw: unknown[]) {
  return doc.apply(raw.map(readOp).filter((op): op is Op => op !== null));
}

describe("canvas document", () => {
  it("stamps every element in the body and saves without the ids", () => {
    const doc = new CanvasDoc("slides", DECK);
    expect(doc.stamped()).toMatch(/<h1 data-fab-id="f\d+">Launch plan<\/h1>/);
    const { text } = doc.apply([{ kind: "style", id: idOf(doc, "Launch plan"), values: { color: "red" } }]);
    expect(text).not.toContain("data-fab-id");
    expect(text).toContain('<h1 style="color: red;">Launch plan</h1>');
    // Only the changed frame is re-serialized: the rest of the source is as written.
    expect(text).toContain('<section data-title="Two">\n  <p data-free style="position:absolute;left:100px');
    // Stamping is in document order: the same text stamps the same ids.
    expect(new CanvasDoc("slides", DECK).stamped()).toBe(new CanvasDoc("slides", DECK).stamped());
  });

  it("moves free layers by px, flow layers by a translate offset, and resizes both", () => {
    const doc = new CanvasDoc("slides", DECK);
    const free = idOf(doc, "Free");
    const res = applyRaw(doc, [{ kind: "move", id: free, x: 120.4, y: -20 }]);
    expect(res.text).toMatch(/left: 120px; top: -20px/);
    expect(res.patches).toEqual([{ t: "attrs", id: free, attrs: { style: expect.stringContaining("left: 120px") } }]);
    const h1 = idOf(doc, "Launch plan");
    expect(applyRaw(doc, [{ kind: "move", id: h1, x: 30, y: -4 }]).text).toMatch(/<h1 style="translate: 30px -4px;">/);
    expect(applyRaw(doc, [{ kind: "move", id: h1, x: 0, y: 0 }]).text).toMatch(/<h1>/);
    expect(applyRaw(doc, [{ kind: "resize", id: h1, x: 0, y: 0, w: 500, h: 1e9 }]).text).toMatch(
      /<h1 style="width: 500px; height: 10000px;">/,
    );
  });

  it("refuses locked layers, speaker notes, frames and unknown ids", () => {
    const doc = new CanvasDoc("slides", DECK);
    const before = doc.text;
    for (const text of ["Footer", "Notes"])
      expect(doc.apply([{ kind: "style", id: idOf(doc, text), values: { color: "red" } }]).text).toBe(before);
    expect(doc.apply([{ kind: "delete", id: "f99999" }]).text).toBe(before);
    expect(doc.apply([{ kind: "delete", id: doc.frameId(0)! }]).text).toBe(before);
    // A frame takes style and the transition, nothing structural.
    const frame = doc.frameId(1)!;
    expect(doc.apply([{ kind: "attr", id: frame, name: "data-transition", value: "fade" }]).text).toContain(
      '<section data-title="Two" data-transition="fade">',
    );
  });

  it("retypes a text box as text, keeping bold, italic and underline", () => {
    const doc = new CanvasDoc("slides", DECK);
    const p = idOf(doc, "Body bold");
    const res = applyRaw(doc, [{ kind: "text", id: p, runs: [{ t: "New " }, { t: "<b>x</b>\nline", b: true }] }]);
    expect(res.text).toContain("<p>New <b>&lt;b&gt;x&lt;/b&gt;<br>line</b></p>");
    expect(res.patches[0]).toMatchObject({ t: "inner", id: p });
    // A container is no text box: retyping would drop its children.
    const section = doc.frameId(0)!;
    expect(doc.apply([{ kind: "text", id: section, runs: [{ t: "x" }] }]).patches).toEqual([]);
  });

  it("inserts a free layer from a template at the centre of the frame", () => {
    const doc = new CanvasDoc("slides", DECK);
    const res = doc.apply([{ kind: "insert", parent: doc.frameId(0)!, template: "text" }]);
    expect(res.made).toHaveLength(1);
    expect(res.text).toContain(
      '<p data-free="" data-layer="Text" style="position:absolute;left:720px;top:492px;width:480px;height:96px;margin:0;font-size:40px;line-height:1.2">Text</p></section>',
    );
    expect(res.patches[0]).toMatchObject({ t: "add", parent: doc.frameId(0), before: null });
    const note = doc.apply([{ kind: "insert", parent: doc.frameId(1)!, template: "note" }]);
    expect(note.text).toMatch(/<aside data-note="" data-free="" data-layer="Note"/);
  });

  it("inserts an uploaded image or video by its mxc URI, at a point and size, within the asset cap", () => {
    const doc = new CanvasDoc("slides", DECK);
    const parent = doc.frameId(0)!;
    const img = doc.apply([{ kind: "insert", parent, template: "image", src: "mxc://example.org/abc", x: 10, y: 20, w: 300, h: 200 }]);
    expect(img.text).toContain(
      '<img src="mxc://example.org/abc" alt="" data-free="" data-layer="Image" style="position:absolute;left:10px;top:20px;width:300px;height:200px;object-fit:contain"></section>',
    );
    const vid = doc.apply([{ kind: "insert", parent, template: "video", src: "mxc://example.org/v" }]);
    expect(vid.text).toMatch(/<video src="mxc:\/\/example.org\/v" controls="" muted="" playsinline="" data-free="" data-layer="Video"/);
    // No URI, or not an mxc URI: nothing.
    for (const src of [undefined, "https://example.org/x.png", 'mxc://x/a" onerror="x'])
      expect(doc.apply([{ kind: "insert", parent, template: "image", src }]).made).toEqual([]);
    // The cap counts distinct URIs: a new one past it is refused, one already named is not.
    const full = new CanvasDoc(
      "slides",
      `<body><section>${Array.from({ length: MAX_ASSETS }, (_, i) => `<img src="mxc://example.org/m${i}">`).join("")}</section></body>`,
    );
    const at = full.frameId(0)!;
    expect(full.apply([{ kind: "insert", parent: at, template: "image", src: "mxc://example.org/new" }]).made).toEqual([]);
    expect(full.apply([{ kind: "insert", parent: at, template: "image", src: "mxc://example.org/m1" }]).made).toHaveLength(1);
  });

  it("duplicates, reorders, groups and ungroups", () => {
    const doc = new CanvasDoc("design", DECK);
    const [a, b] = [idOf(doc, "Free"), idOf(doc, "Other")];
    const dup = doc.apply([{ kind: "duplicate", id: a }]);
    expect(dup.text).toMatch(/left: 116px; top: 66px/);
    expect(doc.apply([{ kind: "reorder", id: a, before: null }]).patches).toEqual([
      { t: "place", id: a, parent: doc.frameId(1), before: null },
    ]);
    const g = doc.apply([{ kind: "group", ids: [a, b] }]);
    expect(g.text).toMatch(/<div data-layer="Group" data-free="" style="position:absolute;left:100px;top:50px;width:400px;height:140px">/);
    expect(g.text).toMatch(/left: 0px; top: 0px; width: 200px/);
    const u = doc.apply([{ kind: "ungroup", id: g.made[0]! }]);
    expect(u.text).not.toContain("Group");
    expect(u.text).toMatch(/left: 100px; top: 50px; width: 200px/);
    expect(u.made).toEqual([b, a]);
  });

  it("lists layers with names, skipping notes and scripts, and copies clean markup", () => {
    const doc = new CanvasDoc("slides", DECK);
    expect(doc.layers(0).map((l) => [l.name, l.depth, l.locked])).toEqual([
      ["h1 · Launch plan", 0, false],
      ["p · Body bold", 0, false],
      ["div · Footer", 0, true],
      ["p · Footer", 1, true],
    ]);
    expect(doc.markup([idOf(doc, "Free")])).toBe(
      '<p data-free="" style="position:absolute;left:100px;top:50px;width:200px;height:80px">Free</p>',
    );
    const pasted = doc.paste('<p>Pasted</p><section>no</section>', 0, null);
    expect(pasted.made).toHaveLength(1);
    expect(pasted.text).toContain("<p>Pasted</p></section>");
  });

  it("gives html style and text only (D3)", () => {
    const doc = new CanvasDoc("html", "<!doctype html><html><body><div><p>Hi</p></div></body></html>");
    const p = idOf(doc, "Hi");
    expect(doc.apply([{ kind: "delete", id: p }]).patches).toEqual([]);
    expect(doc.apply([{ kind: "style", id: p, values: { "font-size": "20px" } }]).text).toBe(
      '<!doctype html>\n<html><head></head><body><div><p style="font-size: 20px;">Hi</p></div></body></html>',
    );
  });
});

describe("op validator", () => {
  it("clamps numbers and drops what is not finite", () => {
    expect(readOp({ kind: "move", id: "f1", x: 1e9, y: -1e9 })).toEqual({ kind: "move", id: "f1", x: 10000, y: -10000 });
    expect(readOp({ kind: "move", id: "f1", x: Number.NaN, y: 0 })).toBeNull();
    expect(readOp({ kind: "resize", id: "f1", x: 0, y: 0, w: 0, h: "5" })).toBeNull();
    expect(readOp({ kind: "insert", parent: "f1", template: "table", rows: 99, cols: -1 })).toEqual({
      kind: "insert",
      parent: "f1",
      template: "table",
      rows: 20,
      cols: 1,
    });
  });

  it("refuses ids, properties, attributes and templates off the allow-lists", () => {
    expect(readOp({ kind: "delete", id: '"]*,[x="' })).toBeNull();
    expect(readOp({ kind: "style", id: "f1", values: { position: "fixed" } })).toBeNull();
    expect(readOp({ kind: "style", id: "f1", values: { color: "red;}</style><script>alert(1)</script>" } })).toBeNull();
    expect(readOp({ kind: "style", id: "f1", values: { color: "red", "font-size": "/* x" } })).toBeNull();
    expect(readOp({ kind: "attr", id: "f1", name: "onclick", value: "alert(1)" })).toBeNull();
    expect(readOp({ kind: "attr", id: "f1", name: "style", value: "x" })).toBeNull();
    expect(readOp({ kind: "insert", parent: "f1", template: "<img src=x onerror=alert(1)>" })).toBeNull();
    expect(readOp({ kind: "paste", parent: "f1", html: "<script>alert(1)</script>" })).toBeNull();
    expect(readOp({ kind: "text", id: "f1", runs: [{ t: 1 }] })).toBeNull();
    expect(readOp({ kind: "text", id: "f1", runs: [{ t: "x".repeat(20_000) }] })).toBeNull();
  });

  it("lets no frame message write markup into a version", () => {
    const doc = new CanvasDoc("slides", DECK);
    const [p, free, frame] = [idOf(doc, "Body bold"), idOf(doc, "Free"), doc.frameId(0)!];
    const evil = "<script>alert(1)</script><img src=x onerror=alert(1)>";
    const before = new DOMParser().parseFromString(doc.text, "text/html");
    const res = applyRaw(doc, [
      { kind: "text", id: p, runs: [{ t: evil, b: "<i>" }] },
      { kind: "attr", id: free, name: "data-layer", value: `"><script>alert(1)</script>` },
      { kind: "style", id: free, values: { "font-family": '"x" </style><script>' } },
      { kind: "style", id: free, values: { color: "expression(alert(1))" } },
      { kind: "insert", parent: frame, template: "text", html: evil },
      { kind: "paste", parent: frame, html: evil },
      { kind: "duplicate", id: free, html: evil },
      { kind: "group", ids: [free], html: evil },
      { kind: "attr", id: free, name: "srcdoc", value: evil },
      { kind: "move", id: free, x: "<b>", y: 0 },
    ]);
    const after = new DOMParser().parseFromString(res.text, "text/html");
    // No new script or image, no event handler attribute: the evil strings are text or attribute values.
    for (const sel of ["script", "img", "[onerror]", "[srcdoc]", "[onclick]"])
      expect(after.querySelectorAll(sel).length).toBe(before.querySelectorAll(sel).length);
    expect(after.body.textContent).toContain("<script>alert(1)</script>");
  });

  it("reads a frame's selection report, dropping what does not fit", () => {
    expect(
      readSelection({
        items: [{ id: "f2", x: 1, y: 2, w: 3, h: 4 }, { id: "bad", x: 0, y: 0, w: 1, h: 1 }, { id: "f3", x: "1" }],
        styles: { color: "red", position: "fixed" },
        background: "rgb(0, 0, 0)",
        rect: { x: 0, y: 0, w: 10, h: 10 },
        editing: "yes",
        origin: { x: 12, y: 34, s: 0.5 },
      }),
    ).toEqual({
      ids: ["f2"],
      items: [{ id: "f2", x: 1, y: 2, w: 3, h: 4, view: { x: 1, y: 2, w: 3, h: 4 }, pos: { x: 1, y: 2 } }],
      styles: { color: "red" },
      background: "rgb(0, 0, 0)",
      rect: { x: 0, y: 0, w: 10, h: 10 },
      editing: false,
      origin: { x: 12, y: 34, s: 0.5 },
    });
    expect(readSelection({ items: [], origin: { x: 0, y: 0, s: Infinity } })?.origin).toBeNull();
    expect(readSelection(null)).toBeNull();
  });

  it("takes an image insert only with a valid mxc URI", () => {
    expect(readOp({ kind: "insert", parent: "f1", template: "image", src: "mxc://example.org/a", w: 0, h: 5 })).toEqual({
      kind: "insert",
      parent: "f1",
      template: "image",
      src: "mxc://example.org/a",
      w: 1,
      h: 5,
    });
    expect(readOp({ kind: "insert", parent: "f1", template: "image", src: "blob:https://app/x" })).toBeNull();
    expect(readOp({ kind: "insert", parent: "f1", template: "video" })).toBeNull();
  });

  it("counts frame ops only during or just after a real user activation", () => {
    const gate = gestureGate(10_000);
    // A script posting on load, or long after the last gesture: ignored.
    expect(gate(false, 0)).toBe(false);
    expect(gate(false, 60_000)).toBe(false);
    // While the browser reports activation, and for the grace after it (a long drag).
    expect(gate(true, 100_000)).toBe(true);
    expect(gate(false, 108_000)).toBe(true);
    expect(gate(false, 110_001)).toBe(false);
  });
});

describe("canvas keys", () => {
  const key = (k: string, mods: Partial<Record<"shiftKey" | "metaKey" | "ctrlKey" | "altKey", boolean>> = {}) =>
    editKeyOf({ key: k, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods });
  it("maps the keyboard table (spec §7)", () => {
    expect(key("d", { metaKey: true })).toBe("duplicate");
    expect(key("g", { ctrlKey: true })).toBe("group");
    expect(key("G", { ctrlKey: true, shiftKey: true })).toBe("ungroup");
    expect(key("z", { metaKey: true, shiftKey: true })).toBe("redo");
    expect(key("y", { ctrlKey: true })).toBe("redo");
    expect(key("\\", { metaKey: true })).toBe("properties");
    expect(key("Backspace")).toBe("delete");
    expect(key("]")).toBe("front");
    expect(key("H", { shiftKey: true })).toBe("flipH");
    expect(key("T", { shiftKey: false })).toBe("insert:text");
    expect(key("R", { shiftKey: true })).toBe("insert:rounded");
    expect(key("L", { shiftKey: true })).toBe("insert:arrow");
    expect(key("t", { altKey: true })).toBeNull();
    expect(key("q")).toBeNull();
  });
});
