import { cssValue, isObject } from "./design-system";
import { editFrame, frameSources } from "./edit";

/**
 * Tweaks (spec §6.7, level 4): controls the agent declares in
 * `<script type="application/json" data-tweaks>`, drawn in the app's own UI. Each sets
 * one CSS custom property on `:root`, or (`text`) the text of the elements with
 * `data-tweak="<name>"`. The JSON is agent output: the reader clamps what it can and
 * drops what it cannot. Keep writes the values into the source (`writeTweaks`).
 */

export const MAX_TWEAKS = 24;
const MAX_OPTIONS = 24;
const MAX_JSON = 32_000;
const MAX_LABEL = 80;
const MAX_VALUE = 120;
export const MAX_TWEAK_TEXT = 500;

/** A control's name and its custom property. The frame checks both again (`srcdoc.ts`). */
export const TWEAK_NAME = /^[A-Za-z][\w-]{0,63}$/;
export const TWEAK_VAR = /^--[A-Za-z0-9_-]{1,64}$/;
const UNITS = new Set(["", "px", "%", "em", "rem", "ms", "s", "deg", "vh", "vw", "fr"]);

interface Base {
  name: string;
  label: string;
}
export interface TweakOption {
  label: string;
  value: string;
}
export type TweakControl =
  | (Base & { type: "color"; var: string; value: string })
  | (Base & { type: "range"; var: string; min: number; max: number; step: number; unit: string; value: number })
  | (Base & { type: "select"; var: string; options: TweakOption[]; value: string })
  | (Base & { type: "toggle"; var: string; on: string; off: string; value: boolean })
  | (Base & { type: "text"; value: string });
export type TweakValue = string | number | boolean;
export type TweakValues = Readonly<Record<string, TweakValue>>;

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
// The attribute by its whole name: `data-tweaks-old` is another one.
// ponytail: a commented-out block before the real one is read instead; scan past comments if agents write that.
const SCRIPT = /<script\b(?=[^>]*\sdata-tweaks(?=[\s=>/]))[^>]*>([\s\S]*?)<\/script\s*>/i;

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function hex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return `#${h.toLowerCase()}`;
}

/** A CSS value from the JSON: a string that passes `cssValue`, or null. */
const css = (v: unknown) => (typeof v === "string" && v.length <= MAX_VALUE ? cssValue(v) || null : null);

function readOption(raw: unknown): TweakOption | null {
  const value = css(isObject(raw) ? raw.value : raw);
  if (!value) return null;
  if (typeof raw === "string") return { label: raw.trim().slice(0, MAX_LABEL), value };
  return isObject(raw) ? { label: text(raw.label, MAX_LABEL) ?? value.slice(0, MAX_LABEL), value } : null;
}

function readControl(raw: unknown): TweakControl | null {
  if (!isObject(raw) || typeof raw.name !== "string" || !TWEAK_NAME.test(raw.name)) return null;
  const base = { name: raw.name, label: text(raw.label, MAX_LABEL) ?? raw.name };
  if (raw.type === "text") {
    const value = typeof raw.value === "string" ? raw.value.slice(0, MAX_TWEAK_TEXT) : "";
    return { ...base, type: "text", value };
  }
  if (typeof raw.var !== "string" || !TWEAK_VAR.test(raw.var)) return null;
  const v = { ...base, var: raw.var };
  switch (raw.type) {
    case "color": {
      const value = hex(raw.value);
      return value ? { ...v, type: "color", value } : null;
    }
    case "range": {
      const [min, max] = [finite(raw.min), finite(raw.max)];
      if (min === null || max === null || !(min < max)) return null;
      const s = finite(raw.step);
      const step = s !== null && s > 0 ? s : (max - min) / 100;
      const unit = typeof raw.unit === "string" && UNITS.has(raw.unit) ? raw.unit : "";
      const control = { ...v, type: "range" as const, min, max, step, unit, value: min };
      return { ...control, value: clampTweak(control, raw.value) as number };
    }
    case "select": {
      const options = (Array.isArray(raw.options) ? raw.options.slice(0, MAX_OPTIONS) : [])
        .map(readOption)
        .filter((o): o is TweakOption => o !== null);
      if (options.length === 0) return null;
      const control = { ...v, type: "select" as const, options, value: options[0]!.value };
      return { ...control, value: clampTweak(control, raw.value) as string };
    }
    case "toggle":
      return { ...v, type: "toggle", on: css(raw.on) ?? "1", off: css(raw.off) ?? "0", value: raw.value === true };
    default:
      return null;
  }
}

/** The controls the document declares; [] when it declares none or the JSON is not a list. */
export function readTweaks(html: string): TweakControl[] {
  const json = SCRIPT.exec(html)?.[1];
  if (!json || json.length > MAX_JSON) return [];
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: TweakControl[] = [];
  const names = new Set<string>();
  for (const raw of data.slice(0, MAX_TWEAKS * 4)) {
    const c = readControl(raw);
    if (!c || names.has(c.name)) continue;
    names.add(c.name);
    out.push(c);
    if (out.length === MAX_TWEAKS) break;
  }
  // A text's value is what the document shows: Reset puts that back, whatever the JSON says.
  if (out.some((c) => c.type === "text")) {
    const body = parse(html).body;
    for (const c of out) {
      if (c.type !== "text") continue;
      const el = body.querySelector(`[data-tweak="${c.name}"]`);
      if (el) c.value = (el.textContent ?? "").slice(0, MAX_TWEAK_TEXT);
    }
  }
  return out;
}

/** `raw` as a value of `control`: clamped, or the control's own value when it does not fit. */
export function clampTweak(control: TweakControl, raw: unknown): TweakValue {
  switch (control.type) {
    case "color":
      return hex(raw) ?? control.value;
    case "range": {
      const n = finite(raw);
      if (n === null) return control.value;
      const stepped = control.min + Math.round((n - control.min) / control.step) * control.step;
      // Rounded to 6 places: 0.1 steps must not write 0.30000000000000004.
      return Math.min(control.max, Math.max(control.min, Math.round(stepped * 1e6) / 1e6));
    }
    case "select":
      return control.options.some((o) => o.value === raw) ? (raw as string) : control.value;
    case "toggle":
      return typeof raw === "boolean" ? raw : control.value;
    case "text":
      return typeof raw === "string" ? raw.slice(0, MAX_TWEAK_TEXT) : control.value;
  }
}

/** The CSS value a non-text control sets its custom property to. */
function cssOf(control: Exclude<TweakControl, { type: "text" }>, value: TweakValue): string {
  switch (control.type) {
    case "range":
      return `${value}${control.unit}`;
    case "toggle":
      return value ? control.on : control.off;
    default:
      return String(value);
  }
}

// Own keys only: control names come from the artifact, and `toString` is a valid one.
const has = (o: object, k: string) => Object.hasOwn(o, k);
/** The control's current value: the changed one, else the document's. */
export const tweakValue = (c: TweakControl, values: TweakValues) =>
  clampTweak(c, has(values, c.name) ? values[c.name] : c.value);

/**
 * What the frame applies (`PreviewMessage.tweak`), validated: each changed custom property
 * at its value and each unchanged one "" (the frame removes it, so the stylesheet rules);
 * every text at its value.
 */
export function tweakMessage(controls: readonly TweakControl[], values: TweakValues) {
  const vars: Record<string, string> = {};
  const texts: Record<string, string> = {};
  for (const c of controls) {
    const v = tweakValue(c, values);
    if (c.type === "text") texts[c.name] = v as string;
    else vars[c.var] = has(values, c.name) ? cssOf(c, v) : "";
  }
  return { vars, texts };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STYLE = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi;

/** Each `--var` declared in a `:root { … }` rule of a `<style>` set to its value; undeclared ones get a new `:root` rule. */
function setRootVars(html: string, vars: Readonly<Record<string, string>>): string {
  const missing = new Set(Object.keys(vars));
  const out = html.replace(STYLE, (_m, open: string, sheet: string, close: string) => {
    const next = sheet.replace(/(:root\s*\{)([^}]*)\}/g, (_r, head: string, body: string) => {
      for (const [name, value] of Object.entries(vars)) {
        const decl = new RegExp(`(^|[;{\\s])${escapeRegExp(name)}(\\s*:\\s*)[^;}]*`, "g");
        body = body.replace(decl, (_d, pre: string, colon: string) => {
          missing.delete(name);
          return `${pre}${name}${colon}${value}`;
        });
      }
      return `${head}${body}}`;
    });
    return open + next + close;
  });
  if (missing.size === 0) return out;
  // ponytail: a var declared only in a `:root, .x` list, a style in <body> or an inline
  // `<html style>` gets a second rule here, which loses to those; widen the matcher if agents write them.
  const rule = `<style>:root { ${[...missing].map((n) => `${n}: ${vars[n]};`).join(" ")} }</style>`;
  const head = /<\/head\s*>/i.exec(out);
  return head ? out.slice(0, head.index) + rule + out.slice(head.index) : rule + out;
}

/** Sets the text of each `[data-tweak]` in `root`, itself included as in the frame; true when one changed. */
function setTexts(root: Element, texts: Readonly<Record<string, string>>): boolean {
  let hit = false;
  const own = root.hasAttribute("data-tweak") ? [root] : [];
  for (const el of [...own, ...root.querySelectorAll("[data-tweak]")]) {
    const k = el.getAttribute("data-tweak") ?? "";
    if (!has(texts, k)) continue;
    const v = texts[k]!;
    if (el.textContent === v) continue;
    el.textContent = v;
    hit = true;
  }
  return hit;
}

/**
 * The source with `values` kept (spec §6.7 "Keep"): the JSON's `value`s, the `:root`
 * declarations of the custom properties, and the text of the `data-tweak` elements. Slides
 * and designs re-serialize only the sections whose text changed; an `html` document is
 * re-serialized whole, as the canvas editor does.
 */
export function writeTweaks(html: string, kind: "slides" | "design" | "html", values: TweakValues): string {
  const controls = readTweaks(html);
  const m = SCRIPT.exec(html);
  if (!m || controls.length === 0) return html;
  const kept = Object.fromEntries(controls.map((c) => [c.name, tweakValue(c, values)]));
  const data = JSON.parse(m[1]!) as unknown[];
  for (const raw of data) if (isObject(raw) && typeof raw.name === "string" && has(kept, raw.name)) raw.value = kept[raw.name];
  const json = JSON.stringify(data, null, m[1]!.trim().includes("\n") ? 2 : undefined).replace(/</g, "\\u003c");
  const start = m.index + m[0].indexOf(">") + 1;
  let out = html.slice(0, start) + (m[1]!.startsWith("\n") ? `\n${json}\n` : json) + html.slice(start + m[1]!.length);

  const { vars, texts } = tweakMessage(controls, kept);
  out = setRootVars(out, vars);
  if (Object.keys(texts).length === 0) return out;
  if (kind === "html") {
    const doc = parse(out);
    return setTexts(doc.body, texts) ? (doc.doctype ? "<!doctype html>\n" : "") + doc.documentElement.outerHTML : out;
  }
  frameSources(out).forEach((raw, i) => {
    if (!raw.includes("data-tweak")) return;
    out = editFrame(out, i, (r) => {
      const el = parse(`<!doctype html><body>${r}`).body.firstElementChild;
      return el && setTexts(el, texts) ? el.outerHTML : r;
    });
  });
  return out;
}
