import { MAX_NOTE } from "./refs";

// The style inspector's pure side: the CSS properties it edits on a picked element, and the
// conversions between a CSS value and a control. The frame reports computed values; they are
// the agent's app talking, so they are untrusted.

/**
 * What the preview bridge reads and may set on a picked element (`STYLE_PROPS` in the CLI's
 * previews/gateway.ts mirrors this list). The preview panel's inspector shows only these.
 */
export const PREVIEW_STYLE_PROPS = [
  "background-color",
  "color",
  "opacity",
  "border-radius",
  "border-style",
  "border-color",
  "border-width",
  "box-shadow",
  "filter",
  "backdrop-filter",
  "rotate",
  "mix-blend-mode",
] as const;

/**
 * What the artifact inspector reads and may set, and the allow-list of the canvas `style`
 * op (spec §5.3). The artifact hook embeds this list. Position and size are not here: the
 * `move` and `resize` ops write those.
 */
export const STYLE_PROPS = [
  ...PREVIEW_STYLE_PROPS,
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "scale",
  "transform",
  "display",
  "flex-direction",
  "gap",
  "padding",
  "align-items",
  "justify-content",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
] as const;

export type StyleProp = (typeof STYLE_PROPS)[number];
export type Styles = Partial<Record<StyleProp, string>>;
export const isStyleProp = (p: unknown): p is StyleProp => STYLE_PROPS.includes(p as StyleProp);
/** A style edit on the picked element: set one property, drop the edits, or leave them in the frame. */
export type StyleEdit = { prop: StyleProp; value: string } | { reset: true } | { keep: true };

/** A value lands in the user's message unfenced: one line, and short. */
export const MAX_STYLE_VALUE = 120;

/** The known properties of a frame's report; everything else is dropped. */
export function readStyles(raw: unknown): Styles {
  const out: Styles = {};
  if (!raw || typeof raw !== "object") return out;
  for (const prop of STYLE_PROPS) {
    const v = (raw as Record<string, unknown>)[prop];
    if (typeof v === "string") out[prop] = v.replace(/\s+/g, " ").trim().slice(0, MAX_STYLE_VALUE);
  }
  return out;
}

/** The first number of a CSS value (`12px` → 12, `0.5` → 0.5), else 0. */
export function num(value: string | undefined): number {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) ? n : 0;
}

/**
 * A computed colour (`rgb(…)` / `rgba(…)`) for `<input type="color">`, which takes only
 * `#rrggbb`. `none` is true for a fully transparent colour. Anything else reads as black.
 */
export function readColor(value: string | undefined): { hex: string; none: boolean } {
  // The colour input's own value, after an edit.
  if (/^#[\da-f]{6}$/i.test(value ?? "")) return { hex: value!, none: false };
  const parts = /^rgba?\(([^)]*)\)$/.exec(value?.trim() ?? "")?.[1]?.split(/[\s,/]+/).filter(Boolean) ?? [];
  const channel = (i: number) => Math.max(0, Math.min(255, Math.round(num(parts[i]))));
  const hex = `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
  return { hex, none: parts.length < 3 || (parts.length > 3 && num(parts[3]) === 0) };
}

/** The blur radius in a `filter` or `backdrop-filter` value. */
export function blurOf(filter: string | undefined): number {
  return num(/blur\(([^)]*)\)/.exec(filter ?? "")?.[1]);
}

/** The same filter list with its blur set to `px` (0 removes it). */
export function withBlur(filter: string | undefined, px: number): string {
  const list = (filter ?? "").trim() === "none" ? "" : (filter ?? "");
  const blur = px > 0 ? `blur(${px}px)` : "";
  // The blur keeps its place in the list: filter order changes the result.
  const marked = list.replace(/blur\([^)]*\)/, "\0").replace(/blur\([^)]*\)/g, "");
  const next = marked.includes("\0") ? marked.replace("\0", blur) : `${marked} ${blur}`;
  return next.replace(/\s+/g, " ").trim() || "none";
}

export interface Shadow {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

export const NO_SHADOW: Shadow = { x: 0, y: 0, blur: 0, spread: 0, color: "rgba(0, 0, 0, 0.3)" };

/** The first outer (or inset) layer of a `box-shadow` value; zeros when there is none. */
export function shadowOf(boxShadow: string | undefined, inset: boolean): Shadow {
  // Layers are comma separated; the commas inside `rgba(…)` are not separators.
  const layer = (boxShadow ?? "").split(/,(?![^(]*\))/).find((l) => /\binset\b/.test(l) === inset && /px/.test(l));
  if (!layer) return NO_SHADOW;
  const n = layer.match(/-?[\d.]+px/g) ?? [];
  const color = layer.replace(/-?[\d.]+px|\binset\b/g, "").replace(/\s+/g, " ").trim();
  return { x: num(n[0]), y: num(n[1]), blur: num(n[2]), spread: num(n[3]), color: color || NO_SHADOW.color };
}

const shadowLayer = (s: Shadow, inset: boolean) =>
  s.x || s.y || s.blur || s.spread ? `${inset ? "inset " : ""}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${s.color}` : "";

/** A `box-shadow` of one drop and one inner shadow; a shadow of zeros is left out. */
export function shadows(drop: Shadow, inner: Shadow): string {
  return [shadowLayer(drop, false), shadowLayer(inner, true)].filter(Boolean).join(", ") || "none";
}

/** Skew in degrees from a `transform` value, computed (`matrix(…)`) or written (`skew(…)`). */
export function skewOf(transform: string | undefined): [number, number] {
  const t = transform ?? "";
  const skew = /skew\(([^)]*)\)/.exec(t)?.[1]?.split(",");
  if (skew) return [num(skew[0]), num(skew[1])];
  const m = /^matrix\(([^)]*)\)$/.exec(t.trim())?.[1]?.split(",").map(num);
  const deg = (v: number) => Math.round((Math.atan(v) * 180) / Math.PI);
  return m && m.length === 6 ? [deg(m[2]!), deg(m[1]!)] : [0, 0];
}

/**
 * `transform` for a skew. ponytail: replaces any other transform on the element (rotate and
 * scale are their own properties); compose with the authored transform if one is ever lost.
 */
export function withSkew(x: number, y: number): string {
  return x || y ? `skew(${x}deg, ${y}deg)` : "none";
}

/** `scale` as [x, y]; a single value scales both, `none` is 1. */
export function scaleOf(value: string | undefined): [number, number] {
  const parts = (value ?? "").trim().split(/\s+/);
  if (!value || value.trim() === "none") return [1, 1];
  const x = parts[0]!.endsWith("%") ? num(parts[0]) / 100 : num(parts[0]);
  const y = parts[1] === undefined ? x : parts[1].endsWith("%") ? num(parts[1]) / 100 : num(parts[1]);
  return [x, y];
}

export const writeScale = ([x, y]: [number, number]) => (x === 1 && y === 1 ? "none" : `${x} ${y}`);

/** Flipped horizontally (`h`) or vertically: the sign of that axis of `scale`. */
export function flipScale(value: string | undefined, axis: "h" | "v"): string {
  const [x, y] = scaleOf(value);
  return writeScale(axis === "h" ? [-x, y] : [x, -y]);
}

export type LayoutDirection = "none" | "row" | "column" | "grid";

export function layoutOf(styles: Styles): LayoutDirection {
  const d = styles.display ?? "";
  if (/grid/.test(d)) return "grid";
  if (/flex/.test(d)) return /column/.test(styles["flex-direction"] ?? "") ? "column" : "row";
  return "none";
}

export function writeLayout(dir: LayoutDirection): Styles {
  if (dir === "grid") return { display: "grid" };
  if (dir === "none") return { display: "block" };
  return { display: "flex", "flex-direction": dir };
}

const luminance = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * WCAG AA for text in `color` on `background`: "good", "poor", or null when either colour
 * cannot be read (transparent, or not rgb or hex). Large text (24 px, or 18.66 px bold) needs 3:1.
 */
export function contrast(styles: Styles, background: string | undefined): "good" | "poor" | null {
  const fg = readColor(styles.color);
  const bg = readColor(background);
  if (fg.none || bg.none) return null;
  const [a, b] = [luminance(fg.hex), luminance(bg.hex)].sort((p, q) => q - p) as [number, number];
  const ratio = (a + 0.05) / (b + 0.05);
  const size = num(styles["font-size"]);
  const large = size >= 24 || (size >= 18.66 && num(styles["font-weight"]) >= 700);
  return ratio >= (large ? 3 : 4.5) ? "good" : "poor";
}

/** The edits as the annotation note the agent reads. Empty when nothing changed. */
export function styleNote(changes: Styles): string {
  const lines = STYLE_PROPS.flatMap((p) => (changes[p]?.trim() ? [`${p}: ${changes[p].trim().slice(0, MAX_STYLE_VALUE)};`] : []));
  return lines.length ? `Apply these style changes to the element:\n${lines.join("\n")}` : "";
}

/** The note of an annotation: the style edits first, then what the user wrote. */
export function annotationNote(changes: Styles, note: string): string {
  return [styleNote(changes), note.trim()].filter(Boolean).join("\n\n").slice(0, MAX_NOTE);
}
