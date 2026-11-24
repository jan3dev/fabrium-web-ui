import { lineDiff } from "@/lib/line-diff";
import { isObject, LIMITS, type Raw, type TokenSection, tokenName } from "./design-system";
import { DEFAULT_SLIDE_SIZE, FRAME_SIZE, type FrameKind, MAX_NAME, MAX_NOTES, type SlideSize } from "./frames";
import { clampDuration } from "./motion";

/**
 * User edits (spec §5.3, level 2): pure operations on the artifact source, string in,
 * string out. The source is parsed inert (DOMParser runs no scripts); nothing here
 * reads from the preview frame.
 *
 * To keep a version's diff small, the source is cut into the raw text of each
 * `body > section` and the text between them. Operations move, copy or drop those
 * pieces as they are and re-serialize only the section they change. When the cut does
 * not match the parsed document (odd markup, sections nested in other elements), the
 * document is re-serialized from the DOM once and cut from that.
 */

interface Cut {
  /** `gaps.length === secs.length + 1`: gap, section, gap, …, section, gap. */
  gaps: string[];
  secs: string[];
}

const join = ({ gaps, secs }: Cut) => gaps[0] + secs.map((s, i) => s + gaps[i + 1]).join("");

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const sectionsOf = (body: HTMLElement) => [...body.children].filter((el) => el.localName === "section");

/** The first `body > section` of `raw`, parsed in body context. */
function parseSection(raw: string): Element | null {
  return sectionsOf(parse(`<!doctype html><body>${raw}`).body)[0] ?? null;
}

const OPEN = /^<section\b(?:[^>"']|"[^"]*"|'[^']*')*>/i;
// Comments, raw-text elements and templates (the deck's layouts) are skipped whole: a
// `<section` inside them is no frame.
const SKIP = String.raw`<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noembed|noframes|template)\b[\s\S]*?(?:<\/\1\s*>|$)`;
const ATTRS = String.raw`(?:[^>"']|"[^"]*"|'[^']*')*`;
const TOKEN = new RegExp(String.raw`${SKIP}|<(\/?)section\b${ATTRS}>`, "gi");

function cutSource(html: string): Cut | null {
  const spans: [number, number][] = [];
  let depth = 0;
  let start = 0;
  for (const m of html.matchAll(TOKEN)) {
    if (m[1] !== undefined || m[2] === undefined) continue;
    if (m[2] === "") {
      if (depth++ === 0) start = m.index;
    } else if (depth > 0 && --depth === 0) spans.push([start, m.index + m[0].length]);
  }
  const parsed = sectionsOf(parse(html).body);
  if (spans.length !== parsed.length) return null;
  const secs = spans.map(([a, b]) => html.slice(a, b));
  if (secs.some((raw, i) => parseSection(raw)?.outerHTML !== parsed[i]!.outerHTML)) return null;
  const gaps = [0, ...spans.map(([, b]) => b)].map((from, i) => html.slice(from, spans[i]?.[0] ?? html.length));
  return { gaps, secs };
}

/** The document from the DOM: every section's outerHTML, the rest serialized around them. */
function cutDom(html: string): Cut {
  const doc = parse(html);
  const gaps = [""];
  const secs: string[] = [];
  for (const node of [...doc.body.childNodes]) {
    if (node instanceof Element && node.localName === "section") {
      secs.push(node.outerHTML);
      gaps.push("");
    } else {
      const box = doc.createElement("div");
      box.append(node.cloneNode(true));
      gaps[gaps.length - 1] += box.innerHTML;
    }
  }
  const marker = "<!--fabrium-body-->";
  doc.body.replaceChildren(doc.createComment("fabrium-body"));
  const [head, tail] = `<!doctype html>\n${doc.documentElement.outerHTML}`.split(marker) as [string, string];
  gaps[0] = head + gaps[0];
  gaps[gaps.length - 1] += tail;
  return { gaps, secs };
}

const cut = (html: string): Cut => cutSource(html) ?? cutDom(html);

/** The raw markup of each frame, in order: what Copy puts on the clipboard. */
export function frameSources(html: string): string[] {
  return cut(html).secs;
}

const isBlank = (s: string) => /^\s*$/.test(s);

/** Puts `section` after frame `after`, with the line break and indent the source uses. */
function insert(c: Cut, after: number, section: string): string {
  const sep = /\n[ \t]*$/.exec(c.gaps[after + 1] ?? "")?.[0] ?? /\n[ \t]*$/.exec(c.gaps[after] ?? "")?.[0] ?? "";
  c.secs.splice(after + 1, 0, section);
  c.gaps.splice(after + 1, 0, sep);
  return join(c);
}

const escAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const attrsOf = (el: Element) =>
  [...el.attributes].map((a) => (a.value === "" ? ` ${a.name}` : ` ${a.name}="${escAttr(a.value)}"`)).join("");

/** The section with only its start tag rewritten after `edit` changes its attributes. */
function withAttrs(raw: string, edit: (el: Element) => void): string {
  const el = parseSection(raw);
  if (!el) return raw;
  edit(el);
  const open = OPEN.exec(raw);
  return open ? `<section${attrsOf(el)}>${raw.slice(open[0].length)}` : el.outerHTML;
}

/** Frame `i`'s raw markup replaced by `edit`'s; the rest of the source stays as it is. */
export function editFrame(html: string, i: number, edit: (raw: string) => string): string {
  const c = cut(html);
  const raw = c.secs[i];
  if (raw === undefined) return html;
  c.secs[i] = edit(raw);
  return join(c);
}

/**
 * `section` after frame `after`: markup the app built or parsed itself (a layout from
 * `slideLayouts`, an artboard from `artboardSection`, a pasted section).
 */
export function addFrame(html: string, after: number, section: string): string {
  const c = cut(html);
  return insert(c, Math.min(after, c.secs.length - 1), section);
}

/** A blank artboard of `size`, within the frame bounds. */
export function artboardSection(size: { width: number; height: number }): string {
  return `<section data-width="${clampSize(size.width)}" data-height="${clampSize(size.height)}"></section>`;
}

export function duplicateFrame(html: string, i: number): string {
  const c = cut(html);
  return c.secs[i] === undefined ? html : insert(c, i, c.secs[i]);
}

/** Frame `from` moved to position `to`; the text between frames stays where it is. */
export function moveFrame(html: string, from: number, to: number): string {
  const c = cut(html);
  if (from === to || !c.secs[from] || to < 0 || to >= c.secs.length) return html;
  const [s] = c.secs.splice(from, 1);
  c.secs.splice(to, 0, s!);
  return join(c);
}

/** Frame `i` removed; a document keeps at least one frame. */
export function deleteFrame(html: string, i: number): string {
  const c = cut(html);
  if (c.secs.length <= 1 || c.secs[i] === undefined) return html;
  c.secs.splice(i, 1);
  const [a, b] = [c.gaps[i]!, c.gaps[i + 1]!];
  c.gaps.splice(i, 2, isBlank(b) ? a : isBlank(a) ? b : a + b);
  return join(c);
}

export function setFrameSkip(html: string, i: number, skip: boolean): string {
  return editFrame(html, i, (raw) =>
    withAttrs(raw, (el) => (skip ? el.setAttribute("data-skip", "") : el.removeAttribute("data-skip"))),
  );
}

/** `data-title` (slides) or `data-name` (design); an empty name removes it. */
export function renameFrame(html: string, kind: FrameKind, i: number, name: string): string {
  const attr = kind === "slides" ? "data-title" : "data-name";
  const value = name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return editFrame(html, i, (raw) =>
    withAttrs(raw, (el) => (value ? el.setAttribute(attr, value) : el.removeAttribute(attr))),
  );
}

const clampSize = (n: number) =>
  Number.isFinite(n) ? Math.round(Math.min(FRAME_SIZE.max, Math.max(FRAME_SIZE.min, n))) : FRAME_SIZE.min;

// As TOKEN: a `<body` in a comment or a raw-text element is no start tag.
const BODY = new RegExp(String.raw`${SKIP}|(<body\b${ATTRS}>)`, "gi");

/**
 * The size of every slide: `data-size` on `body`, absent for the default. Only the body's
 * start tag is rewritten; a source without one is re-serialized whole.
 */
export function setSlideSize(html: string, size: SlideSize): string {
  const doc = parse(html);
  if (size === DEFAULT_SLIDE_SIZE) doc.body.removeAttribute("data-size");
  else doc.body.setAttribute("data-size", size);
  for (const m of html.matchAll(BODY)) {
    if (m[2]) return `${html.slice(0, m.index)}<body${attrsOf(doc.body)}>${html.slice(m.index + m[0].length)}`;
  }
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

export function resizeFrame(html: string, i: number, width: number, height: number): string {
  return editFrame(html, i, (raw) =>
    withAttrs(raw, (el) => {
      el.setAttribute("data-width", String(clampSize(width)));
      el.setAttribute("data-height", String(clampSize(height)));
    }),
  );
}

/** A motion scene's `data-duration` in ms, clamped as the reader clamps it (spec §6.11). Order is `moveFrame`. */
export function setSceneDuration(html: string, i: number, ms: number): string {
  return editFrame(html, i, (raw) => withAttrs(raw, (el) => el.setAttribute("data-duration", String(clampDuration(ms)))));
}

/**
 * Pasted text after frame `after`, or null when it holds no `<section>`. The text comes
 * from outside: it is parsed inert and only its first section, re-serialized, is kept.
 * It is source like any other and runs only in the sandboxed frame.
 */
export function pasteFrame(html: string, after: number, text: string): string | null {
  const el = parseSection(text.trim());
  return el ? addFrame(html, after, el.outerHTML) : null;
}

/** Speaker notes as plain text in one `<aside data-notes>`; empty notes remove it. */
export function setFrameNotes(html: string, i: number, notes: string): string {
  const text = notes.trim().slice(0, MAX_NOTES);
  return editFrame(html, i, (raw) => {
    const el = parseSection(raw);
    if (!el) return raw;
    const asides = [...el.children].filter((c) => c.localName === "aside" && c.hasAttribute("data-notes"));
    if (!text && asides.length === 0) return raw;
    const keep = text ? (asides[0] ?? el.appendChild(el.ownerDocument.createElement("aside"))) : null;
    for (const a of asides) if (a !== keep) a.remove();
    if (keep) {
      keep.setAttribute("data-notes", "");
      keep.textContent = text;
    }
    return el.outerHTML;
  });
}

/** Indexes of the frames in `next` that are new or changed against `prev`; a moved frame counts. */
export function changedFrames(prev: string, next: string): number[] {
  const line = (s: string) => s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n");
  const rows = lineDiff(cut(prev).secs.map(line).join("\n"), cut(next).secs.map(line).join("\n"));
  const out: number[] = [];
  let i = 0;
  for (const r of rows) {
    if (r.type === "del") continue;
    if (r.type === "add") out.push(i);
    i++;
  }
  return out;
}

// ── Slide layouts ───────────────────────────────────────────────────────────

/** The layouts Add slide offers, in the picker's order. */
export const SLIDE_LAYOUTS = [
  { name: "blank", label: "Blank" },
  { name: "title", label: "Title" },
  { name: "section", label: "Section" },
  { name: "title-body", label: "Title and body" },
  { name: "bullets", label: "Bullets" },
  { name: "two-columns", label: "Two columns" },
  { name: "table", label: "Table" },
  { name: "quote", label: "Quote" },
  { name: "image-caption", label: "Image and caption" },
  { name: "closing", label: "Closing" },
] as const;
export type SlideLayout = (typeof SLIDE_LAYOUTS)[number]["name"];

const row = (cell: string, tag: "th" | "td") => `<tr><${tag}>${cell}</${tag}><${tag}>${cell}</${tag}><${tag}>${cell}</${tag}></tr>`;

/**
 * A layout the deck does not provide, from plain elements so the deck's own CSS styles
 * them. Placeholder text (text is not editable by hand before level 3); inline styles
 * only where the layout itself needs them.
 */
const FALLBACK: Record<SlideLayout, string> = {
  blank: "",
  title: "<h1>Presentation title</h1><p>Subtitle</p>",
  section: "<h2>Section title</h2>",
  "title-body": "<h2>Slide title</h2><p>Body text</p>",
  bullets: "<h2>Slide title</h2><ul><li>First point</li><li>Second point</li><li>Third point</li></ul>",
  "two-columns":
    '<h2>Slide title</h2><div style="display:grid;grid-template-columns:1fr 1fr;gap:48px"><div><p>Left column</p></div><div><p>Right column</p></div></div>',
  table: `<h2>Slide title</h2><table><thead>${row("Heading", "th")}</thead><tbody>${row("Cell", "td")}${row("Cell", "td")}</tbody></table>`,
  quote: "<blockquote><p>Quote text</p></blockquote><p>Name, role</p>",
  "image-caption":
    '<figure><div style="width:100%;aspect-ratio:16/9;border:2px dashed currentColor;opacity:0.4"></div><figcaption>Caption</figcaption></figure>',
  closing: "<h1>Thank you</h1><p>Contact and next steps</p>",
};

const LAYOUT_NAMES = new Set<string>(SLIDE_LAYOUTS.map((l) => l.name));

/**
 * The deck's own layouts: `<template data-layout="NAME">` in `head`, each holding one
 * `<section>` in the deck's design. Agent markup, so untrusted: known names only, the
 * first `<section>` of a template's content, the first template of a name wins. It stays
 * source and renders only in the sandboxed frame.
 */
export function readLayouts(html: string): Partial<Record<SlideLayout, string>> {
  return layoutsOf(parse(html));
}

function layoutsOf(doc: Document): Partial<Record<SlideLayout, string>> {
  const out: Partial<Record<SlideLayout, string>> = {};
  for (const t of doc.head.querySelectorAll("template[data-layout]")) {
    const name = t.getAttribute("data-layout")?.trim() ?? "";
    const section = (t as HTMLTemplateElement).content?.querySelector("section");
    if (LAYOUT_NAMES.has(name) && !(name in out) && section) out[name as SlideLayout] = section.outerHTML;
  }
  return out;
}

/**
 * Every layout for a new slide after slide `at`: the deck's own where it has one, else
 * the fallback carrying the `class` and `style` of slide `at`, so the deck's CSS applies.
 */
export function slideLayouts(html: string, at: number): { name: SlideLayout; label: string; section: string }[] {
  const doc = parse(html);
  const own = layoutsOf(doc);
  const ref = sectionsOf(doc.body)[at] ?? sectionsOf(doc.body)[0];
  return SLIDE_LAYOUTS.map(({ name, label }) => {
    let section = own[name];
    if (!section) {
      const el = doc.createElement("section");
      for (const a of ["class", "style"]) {
        const v = ref?.getAttribute(a);
        if (v) el.setAttribute(a, v);
      }
      // The app's own constant markup, in the inert document.
      el.innerHTML = FALLBACK[name];
      section = el.outerHTML;
    }
    return { name, label, section };
  });
}

/** The deck with `sections` as its only frames: the picker previews each in the deck's design. */
export function withFrames(html: string, sections: readonly string[]): string {
  const { gaps } = cut(html);
  return `${gaps[0]}${sections.join("\n")}${gaps[gaps.length - 1]}`;
}

// ── Design system (JSON) ────────────────────────────────────────────────────

/** `data` as JSON in the indent of `text` (a design system, a whiteboard), so a diff shows only the edit. */
export function jsonLike(text: string, data: unknown): string {
  const indent = /^\{\s*?\n([ \t]+)/.exec(text)?.[1] ?? (text.trim().includes("\n") ? 2 : undefined);
  return JSON.stringify(data, null, indent) + (text.endsWith("\n") ? "\n" : "");
}

/** Parses, edits and re-serializes with the source's indent. */
function editJson(text: string, edit: (data: Raw) => void): string {
  const data: unknown = JSON.parse(text);
  if (!isObject(data)) throw new Error("The design system is not a JSON object.");
  edit(data);
  return jsonLike(text, data);
}

const findToken = (data: Raw, section: TokenSection, name: string) =>
  (Array.isArray(data[section]) ? (data[section] as unknown[]) : []).find(
    (t): t is Raw => isObject(t) && typeof t.name === "string" && tokenName(t.name) === name,
  );

const setText = (item: Raw, key: string, value: string, max: number) => {
  const v = value.trim().slice(0, max);
  if (v) item[key] = v;
  else delete item[key];
};

/** A token's value or description, by its name as the page shows it. */
export function setTokenField(
  text: string,
  section: TokenSection,
  name: string,
  field: "value" | "description",
  value: string,
): string {
  if (field === "value" && !value.trim()) return text;
  return editJson(text, (data) => {
    const item = findToken(data, section, name);
    if (item) setText(item, field, value, field === "value" ? LIMITS.value : LIMITS.description);
  });
}

/** A new token at the end of its section; a token of the same name gets the new value. */
export function addToken(text: string, section: TokenSection, name: string, value: string): string {
  const n = name.trim().slice(0, LIMITS.name);
  const v = value.trim().slice(0, LIMITS.value);
  if (!tokenName(n) || !v) return text;
  return editJson(text, (data) => {
    const hit = findToken(data, section, tokenName(n));
    if (hit) hit.value = v;
    else data[section] = [...(Array.isArray(data[section]) ? (data[section] as unknown[]) : []), { name: n, value: v }];
  });
}

export function setOverview(text: string, overview: string): string {
  return editJson(text, (data) => setText(data, "overview", overview, LIMITS.overview));
}

/** The note of the first component with this name. */
export function setComponentDescription(text: string, name: string, description: string): string {
  return editJson(text, (data) => {
    const list = Array.isArray(data.components) ? (data.components as unknown[]) : [];
    const item = list.find((c): c is Raw => isObject(c) && typeof c.name === "string" && c.name.trim() === name);
    if (item) setText(item, "description", description, LIMITS.description);
  });
}
