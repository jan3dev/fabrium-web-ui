import { MAX_NOTE } from "./refs";

// The style inspector's pure side: the CSS properties it edits on a picked element, and the
// conversions between a CSS value and a control. The frame reports computed values; they are
// the agent's app talking, so they are untrusted.

/**
 * What the inspector reads and may set. The pick scripts carry the same list: the artifact
 * hook embeds this one, the preview bridge mirrors it (`STYLE_PROPS` in the CLI's previews/gateway.ts).
 */
export const STYLE_PROPS = [
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

export type StyleProp = (typeof STYLE_PROPS)[number];
export type Styles = Partial<Record<StyleProp, string>>;
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

/** The blur radius of the first outer (or inset) layer of a `box-shadow` value. */
export function shadowOf(boxShadow: string | undefined, inset: boolean): number {
  // Layers are comma separated; the commas inside `rgba(…)` are not separators.
  const layer = (boxShadow ?? "").split(/,(?![^(]*\))/).find((l) => /\binset\b/.test(l) === inset && /px/.test(l));
  return num(layer?.match(/-?[\d.]+px/g)?.[2]);
}

/**
 * A `box-shadow` of one drop and one inner shadow, each given by its blur radius.
 * ponytail: fixed offset and 30 % black; add offset, spread and colour controls when asked.
 */
export function shadows(drop: number, inner: number): string {
  const ink = "rgb(0 0 0 / 0.3)";
  return (
    [
      drop > 0 ? `0px ${Math.round(drop / 2)}px ${drop}px ${ink}` : "",
      inner > 0 ? `inset 0px 0px ${inner}px ${ink}` : "",
    ]
      .filter(Boolean)
      .join(", ") || "none"
  );
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
