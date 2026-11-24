import type { ArtifactKind } from "@/model/types";
import { assetsIn, isMxc, MAX_ASSETS } from "./assets";
import { cssValue, isObject } from "./design-system";
import { editFrame } from "./edit";
import { type FrameKind, frameSize, FRAME_SIZE, MAX_NAME, TRANSITIONS } from "./frames";
import { isStyleProp, MAX_STYLE_VALUE, num, readStyles, type Styles } from "./styles";

/**
 * Canvas editing (spec §5.3, level 3). The app keeps the artifact source parsed as an inert
 * document (DOMParser runs no scripts) and stamps every element in `body` with a transient
 * `data-fab-id` before the frame is built from it. The frame reports gestures as ops; the
 * app validates each op here, applies it to the inert document, and posts the result back
 * as patches the frame mirrors. Only the inert document is ever saved, with the ids
 * stripped: nothing the frame says becomes markup.
 */

export type CanvasKind = FrameKind | "html";
export const isCanvasKind = (k: ArtifactKind): k is CanvasKind => k === "slides" || k === "design" || k === "html";
/** Structure tools (move, resize, insert, group…) for slides and design; `html` gets style and text only (D3). */
export const canStructure = (k: CanvasKind) => k !== "html";

const ID_ATTR = "data-fab-id";
export const ID = /^f\d{1,7}$/;

/** What `insert` can place: the app builds each from constants, never from the frame. */
const TEMPLATES = ["text", "rect", "rounded", "oval", "diamond", "line", "arrow", "table", "note", "image", "video"] as const;
export type Template = (typeof TEMPLATES)[number];

/** Attributes an `attr` op may set. */
const ATTRS = ["data-layer", "data-transition"] as const;
type AttrName = (typeof ATTRS)[number];

/** A run of retyped text: plain text plus bold, italic and underline, nothing else. */
export interface Run {
  t: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
}

export type Op =
  | { kind: "move"; id: string; x: number; y: number }
  | { kind: "resize"; id: string; x: number; y: number; w: number; h: number }
  | { kind: "text"; id: string; runs: Run[] }
  | { kind: "style"; id: string; values: Styles }
  | { kind: "attr"; id: string; name: AttrName; value: string | null }
  | {
      kind: "insert";
      parent: string;
      template: Template;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      rows?: number;
      cols?: number;
      /** Image and video: the uploaded file (spec §5.4), never a URL from the frame. */
      src?: string;
    }
  | { kind: "delete"; id: string }
  | { kind: "duplicate"; id: string }
  | { kind: "reorder"; id: string; before: string | null }
  | { kind: "group"; ids: string[] }
  | { kind: "ungroup"; id: string };

/** The ops a frame may send: gestures only. Everything else comes from the app's own controls. */
export const GESTURE_OPS: readonly Op["kind"][] = ["move", "resize", "text", "reorder"];

/** App → frame: what an applied op changed, by id. `html` is markup the app serialized itself. */
type Patch =
  | { t: "attrs"; id: string; attrs: Record<string, string | null> }
  | { t: "add"; parent: string; before: string | null; html: string }
  | { t: "place"; id: string; parent: string; before: string | null }
  | { t: "remove"; id: string }
  | { t: "inner"; id: string; html: string };

export const MAX_RUNS = 500;
export const MAX_TEXT = 10_000;
const MAX_IDS = 200;
const MAX_PASTE = 50;
const DUPLICATE_OFFSET = 16;

const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const clamp = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : null;
const coord = (v: unknown) => clamp(v, -FRAME_SIZE.max, FRAME_SIZE.max);
const length = (v: unknown) => clamp(v, 1, FRAME_SIZE.max);

function readRuns(raw: unknown): Run[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_RUNS) return null;
  const runs: Run[] = [];
  let total = 0;
  for (const r of raw) {
    if (!isObject(r) || typeof r.t !== "string") return null;
    total += r.t.length;
    if (total > MAX_TEXT) return null;
    runs.push({ t: r.t, b: r.b === true, i: r.i === true, u: r.u === true });
  }
  return runs;
}

/** Known properties whose values pass `cssValue`; "" removes a property. */
function readValues(raw: unknown): Styles | null {
  if (!isObject(raw)) return null;
  const out: Styles = {};
  for (const [prop, v] of Object.entries(raw)) {
    if (!isStyleProp(prop) || typeof v !== "string" || v.length > MAX_STYLE_VALUE) return null;
    if (v.trim() && !cssValue(v)) return null;
    out[prop] = v.trim() ? cssValue(v) : "";
  }
  return Object.keys(out).length ? out : null;
}

/**
 * An op from a frame message (or the app's own controls), or null. Shape only: the ids, the
 * clamped numbers, runs of text, allow-listed properties and attributes, values that pass
 * `cssValue`. `CanvasDoc.apply` then checks the ids against the document.
 */
export function readOp(raw: unknown): Op | null {
  if (!isObject(raw)) return null;
  switch (raw.kind) {
    case "move": {
      const [x, y] = [coord(raw.x), coord(raw.y)];
      return isId(raw.id) && x !== null && y !== null ? { kind: "move", id: raw.id, x, y } : null;
    }
    case "resize": {
      const [x, y, w, h] = [coord(raw.x), coord(raw.y), length(raw.w), length(raw.h)];
      return isId(raw.id) && x !== null && y !== null && w !== null && h !== null
        ? { kind: "resize", id: raw.id, x, y, w, h }
        : null;
    }
    case "text": {
      const runs = readRuns(raw.runs);
      return isId(raw.id) && runs ? { kind: "text", id: raw.id, runs } : null;
    }
    case "style": {
      const values = readValues(raw.values);
      return isId(raw.id) && values ? { kind: "style", id: raw.id, values } : null;
    }
    case "attr": {
      const name = ATTRS.find((a) => a === raw.name);
      const value = raw.value === null ? null : typeof raw.value === "string" ? raw.value : undefined;
      return isId(raw.id) && name && value !== undefined ? { kind: "attr", id: raw.id, name, value } : null;
    }
    case "insert": {
      const template = TEMPLATES.find((t) => t === raw.template);
      if (!isId(raw.parent) || !template) return null;
      const op: Op = { kind: "insert", parent: raw.parent, template };
      if (raw.x !== undefined || raw.y !== undefined) {
        const [x, y] = [coord(raw.x), coord(raw.y)];
        if (x === null || y === null) return null;
        Object.assign(op, { x, y });
      }
      if (raw.w !== undefined || raw.h !== undefined) {
        const [w, h] = [length(raw.w), length(raw.h)];
        if (w === null || h === null) return null;
        Object.assign(op, { w, h });
      }
      if (template === "table") Object.assign(op, { rows: clamp(raw.rows, 1, 20) ?? 3, cols: clamp(raw.cols, 1, 20) ?? 3 });
      if (template === "image" || template === "video") {
        if (!isMxc(raw.src)) return null;
        Object.assign(op, { src: raw.src });
      }
      return op;
    }
    case "delete":
    case "duplicate":
    case "ungroup":
      return isId(raw.id) ? { kind: raw.kind, id: raw.id } : null;
    case "reorder":
      return isId(raw.id) && (raw.before === null || isId(raw.before))
        ? { kind: "reorder", id: raw.id, before: raw.before }
        : null;
    case "group":
      return Array.isArray(raw.ids) && raw.ids.length > 0 && raw.ids.length <= MAX_IDS && raw.ids.every(isId)
        ? { kind: "group", ids: [...new Set(raw.ids)] }
        : null;
    default:
      return null;
  }
}

// ── The inert document ──────────────────────────────────────────────────────

/** Never layers: not drawn, or not the user's to edit. */
export const SKIP = new Set(["script", "style", "template", "noscript", "link", "meta", "title", "base", "br"]);
/** Formatting a text leaf may hold; retyping keeps it as runs. */
export const INLINE = new Set(["b", "strong", "i", "em", "u", "br"]);
/** Elements that hold no retypable text of their own. */
export const NOT_TEXT = new Set([
  "img", "video", "audio", "iframe", "canvas", "svg", "input", "textarea", "select", "table", "thead", "tbody",
  "tfoot", "tr", "ul", "ol", "dl", "hr", "br", "picture", "object", "embed", "section", "math",
]);

const isNotes = (el: Element) => el.localName === "aside" && el.hasAttribute("data-notes");
const isFree = (el: Element) => el.hasAttribute("data-free");

/** A text box: only text and inline formatting inside, so retyping loses nothing. */
function isTextLeaf(el: Element): boolean {
  if (NOT_TEXT.has(el.localName)) return false;
  const inline = (e: Element): boolean => INLINE.has(e.localName) && [...e.children].every(inline);
  return [...el.children].every(inline);
}

const PX = /^-?\d+(\.\d+)?px$/;
/** The inline left, top, width and height are all px, so the box can be read and moved. */
const pxBox = (el: Element) => {
  const s = (el as HTMLElement).style;
  return [s.left, s.top, s.width, s.height].every((v) => PX.test(v));
};

/** Moves a free layer by dx/dy; true when it moved. */
function shiftFree(el: Element, dx: number, dy: number): boolean {
  if (!isFree(el) || !(dx || dy)) return false;
  const s = (el as HTMLElement).style;
  s.setProperty("left", `${num(s.left) + dx}px`);
  s.setProperty("top", `${num(s.top) + dy}px`);
  return true;
}

export interface LayerInfo {
  id: string;
  name: string;
  depth: number;
  locked: boolean;
}


const MAX_LAYERS = 400;

export class CanvasDoc {
  readonly kind: CanvasKind;
  /** The source this document serializes to: the panel's text while they match. */
  text: string;
  private readonly doc: Document;
  private next = 0;

  constructor(kind: CanvasKind, text: string) {
    this.kind = kind;
    this.text = text;
    this.doc = new DOMParser().parseFromString(text, "text/html");
    this.stamp(this.doc.body, false);
  }

  /** Fresh ids on `root`'s descendants (and `root` itself when `self`); document order, so a reload stamps the same. */
  private stamp(root: Element, self = true) {
    for (const el of self ? [root, ...root.querySelectorAll("*")] : root.querySelectorAll("*"))
      el.setAttribute(ID_ATTR, `f${++this.next}`);
  }

  /** The document with its ids: what the frame is built from. */
  stamped(): string {
    return (this.doc.doctype ? "<!doctype html>\n" : "") + this.doc.documentElement.outerHTML;
  }

  private sections(): Element[] {
    return [...this.doc.body.children].filter((el) => el.localName === "section");
  }

  /** The id of frame `i`, or null (html has no frames). */
  frameId(i: number): string | null {
    return this.kind === "html" ? null : (this.sections()[i]?.getAttribute(ID_ATTR) ?? null);
  }

  private sectionOf(el: Element): Element | null {
    let s: Element | null = el;
    while (s && s.parentElement !== this.doc.body) s = s.parentElement;
    return s?.localName === "section" ? s : null;
  }

  /** The element with this id, if the user may edit it: never locked, script-owned or outside a frame. */
  private find(id: string): Element | null {
    if (!ID.test(id)) return null;
    const el = this.doc.body.querySelector(`[${ID_ATTR}="${id}"]`);
    if (!el || el.closest("[data-lock]")) return null;
    for (let p: Element | null = el; p && p !== this.doc.body; p = p.parentElement) {
      if (SKIP.has(p.localName) || isNotes(p)) return null;
      // Inside an SVG only its root is a layer.
      if (p !== el && p.localName === "svg") return null;
    }
    if (this.kind !== "html" && !this.sectionOf(el)) return null;
    return el;
  }

  private isFrame = (el: Element) => this.kind !== "html" && el.parentElement === this.doc.body;

  /** The layer's name as the layers list shows it. */
  name(id: string): string | null {
    const el = this.find(id);
    return el ? layerName(el) : null;
  }

  /** The ids of the layer and its siblings, in order: Send to back puts it before the first. */
  siblings(id: string): string[] {
    const el = this.find(id);
    return el?.parentElement
      ? [...el.parentElement.children].flatMap((c) => (c.getAttribute(ID_ATTR) ? [c.getAttribute(ID_ATTR)!] : []))
      : [];
  }

  info(id: string): { free: boolean } | null {
    const el = this.find(id);
    return el ? { free: isFree(el) } : null;
  }

  /** The layers of frame `i` (html: of the body), in document order, for the layers list. */
  layers(i: number): LayerInfo[] {
    const root = this.kind === "html" ? this.doc.body : this.sections()[i];
    const out: LayerInfo[] = [];
    const walk = (el: Element, depth: number) => {
      for (const c of el.children) {
        if (out.length >= MAX_LAYERS) return;
        if (SKIP.has(c.localName) || isNotes(c)) continue;
        const id = c.getAttribute(ID_ATTR);
        if (!id) continue;
        out.push({ id, name: layerName(c), depth, locked: c.closest("[data-lock]") !== null });
        if (c.localName !== "svg" && !isTextLeaf(c)) walk(c, depth + 1);
      }
    };
    if (root) walk(root, 0);
    return out;
  }

  /** The source of these elements without ids: what Copy puts on the clipboard. */
  markup(ids: readonly string[]): string {
    return ids
      .map((id) => this.find(id))
      .filter((el): el is Element => el !== null && !this.isFrame(el))
      .map((el) => clean(el).outerHTML)
      .join("\n");
  }

  /**
   * Applies valid ops in order and drops the rest. Returns the new source, the patches for
   * the frame, and the ids of the layers the ops made (insert, duplicate, group), to select.
   */
  apply(ops: readonly Op[]): { text: string; patches: Patch[]; made: string[] } {
    const patches: Patch[] = [];
    const made: string[] = [];
    const touched = new Set<Element>();
    for (const op of ops) {
      const res = this.applyOne(op, patches);
      for (const el of res?.touched ?? []) touched.add(el);
      if (res?.made) made.push(...res.made);
    }
    if (touched.size > 0) this.text = this.save(touched);
    return { text: this.text, patches, made };
  }

  /**
   * Pasted text, parsed inert, after `after` (or at the end of frame `frame`). Markup from
   * outside, like a pasted slide: stored as source and run only in the frame. Never reached
   * from a frame message.
   */
  paste(text: string, frame: number, after: string | null): { text: string; patches: Patch[]; made: string[] } {
    if (!canStructure(this.kind)) return { text: this.text, patches: [], made: [] };
    const anchor = after ? this.find(after) : null;
    const parent = anchor && !this.isFrame(anchor) ? anchor.parentElement : this.sections()[frame];
    const parentId = parent?.getAttribute(ID_ATTR);
    if (!parent || !parentId) return { text: this.text, patches: [], made: [] };
    const body = new DOMParser().parseFromString(`<!doctype html><body>${text}`, "text/html").body;
    const items = [...body.children]
      .filter((el) => !["section", "html", "head", "body"].includes(el.localName))
      .slice(0, MAX_PASTE);
    const patches: Patch[] = [];
    const made: string[] = [];
    let ref = anchor && anchor.parentElement === parent ? anchor.nextElementSibling : null;
    for (const item of items) {
      const el = this.doc.importNode(item, true);
      clean(el, true);
      this.stamp(el);
      parent.insertBefore(el, ref);
      patches.push({ t: "add", parent: parentId, before: ref?.getAttribute(ID_ATTR) ?? null, html: el.outerHTML });
      made.push(el.getAttribute(ID_ATTR)!);
    }
    if (made.length) this.text = this.save(new Set([parent]));
    return { text: this.text, patches, made };
  }

  private applyOne(op: Op, patches: Patch[]): { touched: Element[]; made?: string[] } | null {
    const structure = canStructure(this.kind);
    if (op.kind === "group") {
      const els = op.ids.map((id) => this.find(id));
      if (!structure || els.some((e) => !e || this.isFrame(e))) return null;
      return this.group(els as Element[], patches);
    }
    if (op.kind === "insert") {
      const parent = this.find(op.parent);
      if (!structure || !parent || !this.isFrame(parent)) return null;
      return this.insert(parent, op, patches);
    }
    const el = this.find(op.id);
    if (!el) return null;
    const id = op.id;
    const frame = this.isFrame(el);
    const setStyle = (values: Record<string, string>) => {
      const s = (el as HTMLElement).style;
      for (const [k, v] of Object.entries(values)) {
        if (v) s.setProperty(k, v);
        else s.removeProperty(k);
      }
      if (!el.getAttribute("style")?.trim()) el.removeAttribute("style");
      patches.push({ t: "attrs", id, attrs: { style: el.getAttribute("style") } });
      return { touched: [el] };
    };
    switch (op.kind) {
      case "style":
        return setStyle(op.values as Record<string, string>);
      case "text": {
        if (frame || !isTextLeaf(el)) return null;
        writeRuns(el, op.runs);
        this.stamp(el, false);
        patches.push({ t: "inner", id, html: el.innerHTML });
        return { touched: [el] };
      }
      case "attr": {
        if (op.name === "data-transition") {
          if (!frame) return null;
          const v = op.value?.trim().toLowerCase() ?? null;
          if (v !== null && !TRANSITIONS.some((t) => t === v)) return null;
          return setAttr(el, id, op.name, v, patches);
        }
        const name = op.value?.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) || null;
        return setAttr(el, id, op.name, name, patches);
      }
    }
    if (!structure || frame) return null;
    switch (op.kind) {
      case "move":
        // A flow layer keeps its place in the flow and moves by an offset; its siblings stay put.
        return isFree(el)
          ? setStyle({ left: `${op.x}px`, top: `${op.y}px` })
          : setStyle({ translate: op.x || op.y ? `${op.x}px ${op.y}px` : "" });
      case "resize":
        return setStyle(
          isFree(el)
            ? { left: `${op.x}px`, top: `${op.y}px`, width: `${op.w}px`, height: `${op.h}px` }
            : { width: `${op.w}px`, height: `${op.h}px` },
        );
      case "delete": {
        const parent = el.parentElement!;
        el.remove();
        patches.push({ t: "remove", id });
        return { touched: [parent] };
      }
      case "duplicate": {
        const copy = clean(el);
        this.stamp(copy);
        shiftFree(copy, DUPLICATE_OFFSET, DUPLICATE_OFFSET);
        el.after(copy);
        patches.push(addPatch(copy));
        return { touched: [copy], made: [copy.getAttribute(ID_ATTR)!] };
      }
      case "reorder": {
        const before = op.before === null ? null : this.find(op.before);
        if (op.before !== null && (!before || before === el || before.parentElement !== el.parentElement)) return null;
        el.parentElement!.insertBefore(el, before);
        patches.push({ t: "place", id, parent: el.parentElement!.getAttribute(ID_ATTR)!, before: op.before });
        return { touched: [el] };
      }
      case "ungroup": {
        const parent = el.parentElement!;
        const kids = [...el.children];
        if (kids.length === 0) return null;
        const [dx, dy] = isFree(el) ? [num((el as HTMLElement).style.left), num((el as HTMLElement).style.top)] : [0, 0];
        for (const node of [...el.childNodes]) parent.insertBefore(node, el);
        for (const k of kids) {
          patches.push({ t: "place", id: k.getAttribute(ID_ATTR)!, parent: parent.getAttribute(ID_ATTR)!, before: id });
          if (shiftFree(k, dx, dy))
            patches.push({ t: "attrs", id: k.getAttribute(ID_ATTR)!, attrs: { style: k.getAttribute("style") } });
        }
        el.remove();
        patches.push({ t: "remove", id });
        return { touched: [parent], made: kids.map((k) => k.getAttribute(ID_ATTR)!) };
      }
    }
    return null;
  }

  /** Wraps siblings in one group; free layers make a free group at their bounds. */
  private group(els: Element[], patches: Patch[]) {
    const parent = els[0]!.parentElement!;
    if (els.some((e) => e.parentElement !== parent)) return null;
    const order = [...parent.children].filter((c) => els.includes(c));
    const g = this.doc.createElement("div");
    g.setAttribute("data-layer", "Group");
    // A free group needs every box in px; otherwise a plain group, its layers keep their places.
    const free = order.every((e) => isFree(e) && pxBox(e));
    let [bx, by] = [0, 0];
    if (free) {
      const boxes = order.map((e) => {
        const s = (e as HTMLElement).style;
        return [num(s.left), num(s.top), num(s.left) + num(s.width), num(s.top) + num(s.height)];
      });
      bx = Math.min(...boxes.map((b) => b[0]!));
      by = Math.min(...boxes.map((b) => b[1]!));
      const [r, b] = [Math.max(...boxes.map((b) => b[2]!)), Math.max(...boxes.map((b) => b[3]!))];
      g.setAttribute("data-free", "");
      g.setAttribute("style", `position:absolute;left:${bx}px;top:${by}px;width:${r - bx}px;height:${b - by}px`);
    }
    parent.insertBefore(g, order[0]!);
    this.stamp(g);
    patches.push(addPatch(g));
    const gid = g.getAttribute(ID_ATTR)!;
    for (const e of order) {
      g.append(e);
      const id = e.getAttribute(ID_ATTR)!;
      patches.push({ t: "place", id, parent: gid, before: null });
      if (free && shiftFree(e, -bx, -by)) patches.push({ t: "attrs", id, attrs: { style: e.getAttribute("style") } });
    }
    return { touched: [g], made: [gid] };
  }

  private insert(section: Element, op: Extract<Op, { kind: "insert" }>, patches: Patch[]) {
    if (op.template === "image" || op.template === "video") {
      if (!isMxc(op.src)) return null;
      const named = assetsIn(this.doc);
      if (!named.has(op.src) && named.size >= MAX_ASSETS) return null;
    }
    const t = template(this.doc, op.template, op.rows ?? 3, op.cols ?? 3, op.src ?? "");
    if (op.w !== undefined && op.h !== undefined) Object.assign(t, { w: op.w, h: op.h });
    const size = frameSize(this.kind as FrameKind, section);
    const x = op.x ?? Math.round((size.width - t.w) / 2);
    const y = op.y ?? Math.round((size.height - t.h) / 2);
    const el = t.el;
    el.setAttribute("data-free", "");
    el.setAttribute("data-layer", t.name);
    el.setAttribute("style", `position:absolute;left:${x}px;top:${y}px;width:${t.w}px;height:${t.h}px;${t.style}`);
    section.append(el);
    this.stamp(el);
    patches.push(addPatch(el));
    return { touched: [el], made: [el.getAttribute(ID_ATTR)!] };
  }

  /** The source after `touched` changed: only their frames re-serialized (html: the whole document). */
  private save(touched: Set<Element>): string {
    const sections = this.sections();
    const indexes = new Set<number>();
    for (const el of touched) {
      const s = el.isConnected ? this.sectionOf(el) : null;
      if (!s || this.kind === "html") return serializeClean(this.doc);
      indexes.add(sections.indexOf(s));
    }
    let text = this.text;
    for (const i of indexes) text = editFrame(text, i, () => clean(sections[i]!).outerHTML);
    return text;
  }
}

function setAttr(el: Element, id: string, name: string, value: string | null, patches: Patch[]) {
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
  patches.push({ t: "attrs", id, attrs: { [name]: value } });
  return { touched: [el] };
}

const addPatch = (el: Element): Patch => ({
  t: "add",
  parent: el.parentElement!.getAttribute(ID_ATTR)!,
  before: el.nextElementSibling?.getAttribute(ID_ATTR) ?? null,
  html: el.outerHTML,
});

/** A copy of `el` without ids (in place when `inPlace`). */
function clean(el: Element, inPlace = false): Element {
  const c = inPlace ? el : (el.cloneNode(true) as Element);
  c.removeAttribute(ID_ATTR);
  for (const n of c.querySelectorAll(`[${ID_ATTR}]`)) n.removeAttribute(ID_ATTR);
  return c;
}

/**
 * ponytail: an `html` edit re-serializes the whole document, so its first save also
 * normalizes the agent's markup; cut it by top-level element like frames if the diff matters.
 */
function serializeClean(doc: Document): string {
  return (doc.doctype ? "<!doctype html>\n" : "") + clean(doc.documentElement).outerHTML;
}

/** `data-layer`, else the tag and the first words of its text. */
function layerName(el: Element): string {
  const named = el.getAttribute("data-layer")?.replace(/\s+/g, " ").trim();
  if (named) return named.slice(0, MAX_NAME);
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return text ? `${el.localName} · ${text}` : el.localName;
}

/** The element's content as text nodes and `b`/`i`/`u`/`br` elements: never parsed markup. */
function writeRuns(el: Element, runs: readonly Run[]) {
  const doc = el.ownerDocument;
  el.replaceChildren();
  // Neighbours with the same formatting become one run.
  const merged: Run[] = [];
  for (const r of runs) {
    const last = merged.at(-1);
    if (last && !!last.b === !!r.b && !!last.i === !!r.i && !!last.u === !!r.u) last.t += r.t;
    else if (r.t) merged.push({ ...r });
  }
  for (const r of merged) {
    let node: Node = doc.createDocumentFragment();
    r.t.split("\n").forEach((part, i) => {
      if (i > 0) node.appendChild(doc.createElement("br"));
      if (part) node.appendChild(doc.createTextNode(part));
    });
    for (const tag of ["u", "i", "b"] as const) {
      if (!r[tag]) continue;
      const wrap = doc.createElement(tag);
      wrap.appendChild(node);
      node = wrap;
    }
    el.appendChild(node);
  }
}

/** A new layer from the fixed templates; neutral colours, so the deck's own CSS shows through. */
function template(doc: Document, name: Template, rows: number, cols: number, src: string) {
  const el = (tag: string, text?: string) => {
    const e = doc.createElement(tag);
    if (text) e.textContent = text;
    return e;
  };
  const shape = "background-color:rgb(148, 163, 184)";
  switch (name) {
    case "text":
      return { el: el("p", "Text"), name: "Text", w: 480, h: 96, style: "margin:0;font-size:40px;line-height:1.2" };
    case "rect":
      return { el: el("div"), name: "Rectangle", w: 320, h: 200, style: shape };
    case "rounded":
      return { el: el("div"), name: "Rounded rectangle", w: 320, h: 200, style: `${shape};border-radius:24px` };
    case "oval":
      return { el: el("div"), name: "Oval", w: 240, h: 240, style: `${shape};border-radius:50%` };
    case "diamond":
      return { el: el("div"), name: "Diamond", w: 240, h: 240, style: `${shape};clip-path:polygon(50% 0, 100% 50%, 50% 100%, 0 50%)` };
    case "line":
      return { el: el("div"), name: "Line", w: 320, h: 4, style: "background-color:currentColor" };
    case "arrow": {
      const box = el("div");
      const ns = "http://www.w3.org/2000/svg";
      const svg = doc.createElementNS(ns, "svg");
      for (const [k, v] of [["viewBox", "0 0 100 10"], ["preserveAspectRatio", "none"], ["width", "100%"], ["height", "100%"]])
        svg.setAttribute(k!, v!);
      const path = doc.createElementNS(ns, "path");
      for (const [k, v] of [["d", "M0 5H98M90 1L98 5L90 9"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "3"], ["vector-effect", "non-scaling-stroke"]])
        path.setAttribute(k!, v!);
      svg.appendChild(path);
      box.appendChild(svg);
      return { el: box, name: "Arrow", w: 320, h: 24, style: "" };
    }
    case "table": {
      const table = el("table");
      const cell = "border:1px solid currentColor;padding:8px 12px";
      for (let r = 0; r < rows; r++) {
        const tr = el("tr");
        for (let c = 0; c < cols; c++) {
          const td = el(r === 0 ? "th" : "td", r === 0 ? "Heading" : "Cell");
          td.setAttribute("style", cell);
          tr.appendChild(td);
        }
        table.appendChild(tr);
      }
      return { el: table, name: "Table", w: Math.min(1200, cols * 200), h: rows * 56, style: "border-collapse:collapse" };
    }
    case "note": {
      // A note for the builder (spec §5.1): the frame draws it as a note, Present and the PDF hide it.
      const note = el("aside", "Note");
      note.setAttribute("data-note", "");
      return { el: note, name: "Note", w: 280, h: 160, style: "" };
    }
    case "image":
    case "video": {
      // An uploaded file by its mxc:// URI (spec §5.4); the frame shows the bytes the app posts.
      const media = el(name === "image" ? "img" : "video");
      media.setAttribute("src", src);
      if (name === "image") media.setAttribute("alt", "");
      else for (const a of ["controls", "muted", "playsinline"]) media.setAttribute(a, "");
      return { el: media, name: name === "image" ? "Image" : "Video", w: 640, h: 360, style: "object-fit:contain" };
    }
  }
}

// ── Frame reports ───────────────────────────────────────────────────────────

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the frame reports about its selection; untrusted, so clamped and capped. */
export interface CanvasSelection {
  ids: string[];
  /** Each layer's position (free: `left`/`top`) and size, in canvas px. */
  items: (Box & {
    id: string;
    /** Where the layer shows on the open frame (its flow place plus any offset), in canvas px. */
    view: Box;
    /** What a `move` op takes: `left`/`top` for a free layer, the `translate` offset for a flow layer. */
    pos: { x: number; y: number };
  })[];
  /** The first layer's computed styles; the frame's when nothing is selected. */
  styles: Styles;
  /** The colour behind the first layer, for the contrast check. */
  background: string;
  /** Where the selection is in the frame's viewport, for the floating toolbar. */
  rect: Box | null;
  /** A text box is being retyped. */
  editing: boolean;
  /** The open frame's top-left in the frame's viewport and its scale: viewport px → canvas px. */
  origin: { x: number; y: number; s: number } | null;
}

function readBox(raw: unknown): Box | null {
  if (!isObject(raw)) return null;
  const [x, y, w, h] = [coord(raw.x), coord(raw.y), clamp(raw.w, 0, FRAME_SIZE.max), clamp(raw.h, 0, FRAME_SIZE.max)];
  return x === null || y === null || w === null || h === null ? null : { x, y, w, h };
}

export function readSelection(raw: unknown): CanvasSelection | null {
  if (!isObject(raw) || !Array.isArray(raw.items)) return null;
  const items: CanvasSelection["items"] = [];
  for (const it of raw.items.slice(0, MAX_IDS)) {
    const box = readBox(it);
    if (!isObject(it) || !isId(it.id) || !box) continue;
    const pos = isObject(it.pos) ? { x: coord(it.pos.x), y: coord(it.pos.y) } : null;
    items.push({
      id: it.id,
      ...box,
      view: readBox(it.view) ?? box,
      pos: pos && pos.x !== null && pos.y !== null ? { x: pos.x, y: pos.y } : { x: box.x, y: box.y },
    });
  }
  return {
    ids: items.map((i) => i.id),
    items,
    styles: readStyles(raw.styles),
    background: typeof raw.background === "string" ? raw.background.slice(0, 60) : "",
    rect: readBox(raw.rect),
    editing: raw.editing === true,
    origin: readOrigin(raw.origin),
  };
}

function readOrigin(raw: unknown): CanvasSelection["origin"] {
  if (!isObject(raw)) return null;
  const [x, y] = [coord(raw.x), coord(raw.y)];
  const s = typeof raw.s === "number" && Number.isFinite(raw.s) ? Math.min(10, Math.max(0.01, raw.s)) : null;
  return x === null || y === null || s === null ? null : { x, y, s };
}

/**
 * Ops and keys from the frame save as the user's edit, but agent scripts run in the same
 * frame as the editor. So they count only while the user is active: during the browser's
 * transient activation (a frame script cannot fake it; activation in the frame reaches the
 * parent), or `grace` ms after the parent last saw it, which covers a long drag.
 */
export function gestureGate(grace = 10_000) {
  let seen = -Infinity;
  /** Call on every frame message, with `navigator.userActivation.isActive`; true when an op may count. */
  return (active: boolean, now: number): boolean => {
    if (active) seen = now;
    return now - seen <= grace;
  };
}

export function readEditKey(raw: unknown): KeyLike | null {
  if (!isObject(raw) || typeof raw.key !== "string" || raw.key.length > 20) return null;
  return {
    key: raw.key,
    shiftKey: raw.shiftKey === true,
    metaKey: raw.metaKey === true,
    ctrlKey: raw.ctrlKey === true,
    altKey: raw.altKey === true,
  };
}

// ── Keys ────────────────────────────────────────────────────────────────────

/** Canvas actions the panel runs for a key, from the panel or forwarded by the frame (spec §7). */
export type EditKey =
  | "delete"
  | "duplicate"
  | "copy"
  | "cut"
  | "paste"
  | "group"
  | "ungroup"
  | "front"
  | "back"
  | "flipH"
  | "flipV"
  | "properties"
  | "undo"
  | "redo"
  | `insert:${Template}`;

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export function editKeyOf(e: KeyLike): EditKey | null {
  if (e.altKey) return null;
  const k = e.key.toLowerCase();
  if (e.metaKey || e.ctrlKey) {
    if (k === "\\") return "properties";
    if (k === "z") return e.shiftKey ? "redo" : "undo";
    if (k === "y" && e.ctrlKey && !e.metaKey) return "redo";
    if (k === "g") return e.shiftKey ? "ungroup" : "group";
    if (e.shiftKey) return null;
    return ({ d: "duplicate", c: "copy", x: "cut", v: "paste" } as const)[k as "d"] ?? null;
  }
  if (e.key === "Delete" || e.key === "Backspace") return "delete";
  if (e.key === "]") return "front";
  if (e.key === "[") return "back";
  if (e.shiftKey) return ({ h: "flipH", v: "flipV", r: "insert:rounded", l: "insert:arrow" } as const)[k as "h"] ?? null;
  return ({ t: "insert:text", r: "insert:rect", o: "insert:oval", d: "insert:diamond", l: "insert:line" } as const)[k as "t"] ?? null;
}
