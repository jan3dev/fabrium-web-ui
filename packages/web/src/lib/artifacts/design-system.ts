import { isMxc } from "./assets";
import type { ArtifactRefTarget } from "./refs";

/**
 * A `design-system` artifact: one JSON object an agent writes. Everything here
 * treats it as untrusted input: the reader drops what does not fit, and the
 * page builder escapes every string for where it lands.
 */

export interface DesignToken {
  name: string;
  value: string;
  description?: string;
}
export interface DesignComponent {
  name: string;
  description?: string;
  /** Agent markup: rendered only inside the sandboxed frame. */
  html: string;
}
export interface DesignAsset {
  name: string;
  /** Agent markup: rendered only inside the sandboxed frame. */
  svg: string;
}

/** Color values for one theme (light, dark): they replace the `colors` of the same name. */
export interface DesignTheme {
  name: string;
  colors: DesignToken[];
}
/** An uploaded font file (spec §5.1), loaded into the frame like any other asset (§5.4). */
export interface DesignFont {
  name: string;
  mxc: string;
  weight?: string;
  style?: string;
}
/** A layout pattern (grid, page structure): text, not a CSS value. */
export interface DesignNote {
  name: string;
  value: string;
  description?: string;
}

export interface DesignSystem {
  /** Markdown; "" when absent. */
  overview: string;
  colors: DesignToken[];
  themes: DesignTheme[];
  spacing: DesignToken[];
  typography: DesignToken[];
  fonts: DesignFont[];
  radius: DesignToken[];
  shadows: DesignToken[];
  layout: DesignNote[];
  components: DesignComponent[];
  icons: DesignAsset[];
  logos: DesignAsset[];
  assets: DesignAsset[];
}

/** Display order. Keys are the JSON keys. */
const DESIGN_SYSTEM_SECTIONS = [
  { key: "overview", label: "Overview" },
  { key: "colors", label: "Colors" },
  { key: "themes", label: "Themes" },
  { key: "spacing", label: "Spacing" },
  { key: "typography", label: "Typography" },
  { key: "fonts", label: "Fonts" },
  { key: "radius", label: "Corner radius" },
  { key: "shadows", label: "Shadows" },
  { key: "layout", label: "Layout" },
  { key: "components", label: "Components" },
  { key: "icons", label: "Icons" },
  { key: "logos", label: "Logos" },
  { key: "assets", label: "Assets" },
] as const;

export type DesignSystemSection = (typeof DESIGN_SYSTEM_SECTIONS)[number]["key"];
export type TokenSection = "colors" | "spacing" | "typography" | "radius" | "shadows";

/** Token section → CSS variable / element id prefix (`--color-brand`, `#color-brand`). */
const TOKEN_PREFIX: Record<TokenSection, string> = {
  colors: "color",
  spacing: "spacing",
  typography: "font",
  radius: "radius",
  shadows: "shadow",
};

const TOKEN_SECTIONS = Object.keys(TOKEN_PREFIX) as TokenSection[];

export function isTokenSection(section: DesignSystemSection): section is TokenSection {
  return section in TOKEN_PREFIX;
}

export function sectionLabel(section: DesignSystemSection): string {
  return DESIGN_SYSTEM_SECTIONS.find((s) => s.key === section)!.label;
}

export const LIMITS = {
  items: 100,
  name: 80,
  value: 300,
  description: 300,
  markup: 20_000,
  overview: 100_000,
} as const;

export type Raw = Record<string, unknown>;

/**
 * The font families typography tokens name, for the font picker: the part of a `font`
 * shorthand after its size (`600 32px/1.2 "Inter", sans-serif` → `"Inter", sans-serif`),
 * or the whole value when it has no size.
 */
export function fontFamilies(tokens: readonly DesignToken[]): string[] {
  const out = new Set<string>();
  for (const t of tokens) {
    const m = /(?:^|\s)[\d.]+(?:px|r?em|%|pt|vw|vh|ch|ex)(?:\/\S+)?\s+(.+)$/i.exec(t.value);
    const family = cssValue((m ? m[1]! : t.value).trim());
    if (family && !/^\d/.test(family)) out.add(family);
  }
  return [...out];
}

export const isObject = (v: unknown): v is Raw =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A string within `max`, "" for absent; undefined means the item does not fit. */
function field(item: Raw, key: string, max: number, required: boolean): string | undefined {
  const v = item[key];
  if (v === undefined || v === null) return required ? undefined : "";
  if (typeof v !== "string" || v.length > max) return undefined;
  const s = v.trim();
  return required && !s ? undefined : s;
}

/** Token names become CSS identifiers and ids: kebab-case `[a-z0-9-]`. */
export function tokenName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function list<T>(raw: unknown, read: (item: Raw) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    const v = isObject(item) ? read(item) : null;
    if (v) out.push(v);
    if (out.length >= LIMITS.items) break;
  }
  return out;
}

function tokens(raw: unknown): DesignToken[] {
  const seen = new Set<string>();
  return list(raw, (item) => {
    const rawName = field(item, "name", LIMITS.name, true);
    const value = field(item, "value", LIMITS.value, true);
    const description = field(item, "description", LIMITS.description, false);
    const name = rawName === undefined ? "" : tokenName(rawName);
    // Ids must stay unique: the first token of a name wins.
    if (!name || value === undefined || description === undefined || seen.has(name)) return null;
    seen.add(name);
    return description ? { name, value, description } : { name, value };
  });
}

/** `{ name, svg }` items: icons, logos, assets. */
function svgs(raw: unknown): DesignAsset[] {
  return list(raw, (item) => {
    const name = field(item, "name", LIMITS.name, true);
    const svg = field(item, "svg", LIMITS.markup, true);
    return name === undefined || svg === undefined ? null : { name, svg };
  });
}

function themes(raw: unknown): DesignTheme[] {
  const seen = new Set<string>();
  return list(raw, (item) => {
    const name = tokenName(field(item, "name", LIMITS.name, true) ?? "");
    if (!name || seen.has(name)) return null;
    seen.add(name);
    return { name, colors: tokens(item.colors) };
  });
}

const FONT_WEIGHT = /^(normal|bold|[1-9]\d{0,2}|1000)$/;
const FONT_STYLE = /^(normal|italic|oblique)$/;

function fonts(raw: unknown): DesignFont[] {
  return list(raw, (item) => {
    const name = field(item, "name", LIMITS.name, true);
    if (name === undefined || !isMxc(item.mxc)) return null;
    const weight = typeof item.weight === "number" ? String(item.weight) : item.weight;
    return {
      name,
      mxc: item.mxc,
      ...(typeof weight === "string" && FONT_WEIGHT.test(weight) ? { weight } : {}),
      ...(typeof item.style === "string" && FONT_STYLE.test(item.style) ? { style: item.style } : {}),
    };
  });
}

function notes(raw: unknown): DesignNote[] {
  return list(raw, (item) => {
    const name = field(item, "name", LIMITS.name, true);
    const value = field(item, "value", LIMITS.value, true);
    const description = field(item, "description", LIMITS.description, false);
    if (name === undefined || value === undefined || description === undefined) return null;
    return description ? { name, value, description } : { name, value };
  });
}

/** Untrusted JSON text → a design system, or null when it is not a JSON object. */
export function parseDesignSystem(text: string): DesignSystem | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(data)) return null;
  return {
    overview: typeof data.overview === "string" ? data.overview.slice(0, LIMITS.overview) : "",
    colors: tokens(data.colors),
    themes: themes(data.themes),
    spacing: tokens(data.spacing),
    typography: tokens(data.typography),
    fonts: fonts(data.fonts),
    radius: tokens(data.radius),
    shadows: tokens(data.shadows),
    layout: notes(data.layout),
    components: list(data.components, (item) => {
      const name = field(item, "name", LIMITS.name, true);
      const description = field(item, "description", LIMITS.description, false);
      const html = field(item, "html", LIMITS.markup, true);
      if (name === undefined || description === undefined || html === undefined) return null;
      return description ? { name, description, html } : { name, html };
    }),
    icons: svgs(data.icons),
    logos: svgs(data.logos),
    assets: svgs(data.assets),
  };
}

function sectionCount(system: DesignSystem, section: DesignSystemSection): number {
  return section === "overview" ? (system.overview.trim() ? 1 : 0) : system[section].length;
}

export interface DesignSystemSectionInfo {
  key: DesignSystemSection;
  label: string;
  count: number;
}

/** Sections with content, in display order; the first is the default selection. */
export function designSystemSections(system: DesignSystem): DesignSystemSectionInfo[] {
  return DESIGN_SYSTEM_SECTIONS.map((s) => ({ ...s, count: sectionCount(system, s.key) })).filter(
    (s) => s.count > 0,
  );
}

/** What the Add control puts in the composer: the agent then publishes a new version. */
export function addValueRef(
  section: TokenSection,
  name: string,
  value: string,
): { target: ArtifactRefTarget; note: string } {
  return {
    target: { kind: "text", text: `${name.trim()}: ${value.trim()}`, where: sectionLabel(section) },
    note: "Add this value to the design system.",
  };
}

// ── Page builder ────────────────────────────────────────────────────────────

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Safe in text and in quoted attributes. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/**
 * A token value as a CSS declaration value inside `:root{…}` in a `<style>`,
 * or "" when it could leave that slot. Rejected rather than stripped, so no
 * removal can assemble a new `/*` or `</style`: `;` `{` `}` end the
 * declaration or block, `<` `>` could close the element, `\` escapes, a comment
 * or an unbalanced quote or bracket swallows what follows.
 */
export function cssValue(value: string): string {
  if (/[;{}<>\\\u0000-\u001f\u007f]|\/\*|\*\//.test(value)) return "";
  if ((value.split('"').length - 1) % 2 || (value.split("'").length - 1) % 2) return "";
  let depth = 0;
  for (const c of value) {
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && --depth < 0) return "";
  }
  return depth === 0 ? value.trim() : "";
}

/** `--<prefix>-<name>: <value>;` per token whose value is safe CSS. */
function declarations(prefix: string, tokens: readonly { name: string; value: string }[]): string[] {
  return tokens.flatMap((t) => {
    const v = cssValue(t.value);
    // Names are `[a-z0-9-]` after parsing; re-normalised in case the caller built the object.
    return v ? [`--${prefix}-${tokenName(t.name)}: ${v};`] : [];
  });
}

/** Every token as a CSS variable, so samples and component html can use `var(--color-brand)`. */
function rootVariables(system: DesignSystem): string {
  const lines = TOKEN_SECTIONS.flatMap((section) => declarations(TOKEN_PREFIX[section], system[section]));
  return `:root{\n${lines.join("\n")}\n}`;
}

// Quiet, theme-independent page chrome. Colors as rgb(): the frame is its own white page.
const PAGE_CSS = `*{box-sizing:border-box}
html,body{margin:0;background:white;color:rgb(28,28,30)}
body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px}
h1{font-size:16px;font-weight:600;margin:0 0 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:20px}
.list{display:flex;flex-direction:column;gap:16px}
.name{font-weight:600;overflow-wrap:anywhere}
.value{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:rgb(99,99,102);overflow-wrap:anywhere}
.desc{font-size:12px;color:rgb(99,99,102);margin-top:2px}
.swatch{height:64px;border-radius:8px;border:1px solid rgb(0 0 0 / 0.1);margin-bottom:8px}
.row{display:grid;grid-template-columns:minmax(96px,160px) 1fr;gap:16px;align-items:center}
.bar{height:16px;max-width:100%;background:rgb(147,197,253);border:1px solid rgb(96,165,250);border-radius:2px}
.sample{overflow-wrap:anywhere;margin-bottom:4px}
.typo{padding-bottom:16px;border-bottom:1px solid rgb(229,229,234)}
.box{height:88px;margin-bottom:8px;background:rgb(242,242,247);border:1px solid rgb(199,199,204)}
.shadows{gap:32px}
.shadows .box{background:white;border:0}
.card{margin:0;border:1px solid rgb(229,229,234);border-radius:12px;overflow:hidden}
.stage{background:rgb(248,248,250);padding:24px;display:flex;align-items:center;justify-content:center;overflow:auto}
.assets .stage{height:140px}
figcaption{padding:10px 12px;border-top:1px solid rgb(229,229,234)}
.empty{color:rgb(99,99,102)}
h2{font-size:14px;font-weight:600;margin:0 0 12px}
.theme+.theme{margin-top:32px}`;

const SAMPLE = "The quick brown fox jumps over the lazy dog";

function meta(name: string, value?: string, description?: string): string {
  return (
    `<div class="name">${escapeHtml(name)}</div>` +
    (value !== undefined ? `<div class="value">${escapeHtml(value)}</div>` : "") +
    (description ? `<div class="desc">${escapeHtml(description)}</div>` : "")
  );
}

/** Style attributes only ever hold `var(--…)` of a normalised name, never an agent value. */
/** `scope` keeps ids unique when one page shows the same token twice (themes). */
function tokenItem(section: TokenSection, t: DesignToken, scope = ""): string {
  const name = `${TOKEN_PREFIX[section]}-${tokenName(t.name)}`;
  const id = scope + name;
  const v = `var(--${name})`;
  const info = meta(t.name, t.value, t.description);
  switch (section) {
    case "colors":
      return `<div id="${id}"><div class="swatch" style="background:${v}"></div>${info}</div>`;
    case "spacing":
      return `<div id="${id}" class="row"><div>${info}</div><div class="bar" style="width:${v}"></div></div>`;
    case "typography":
      return `<div id="${id}" class="typo"><div class="sample" style="font:${v}">${SAMPLE}</div>${info}</div>`;
    case "radius":
      return `<div id="${id}"><div class="box" style="border-radius:${v}"></div>${info}</div>`;
    case "shadows":
      return `<div id="${id}"><div class="box" style="box-shadow:${v}"></div>${info}</div>`;
  }
}

/** CSS for one section's page beyond the root variables: theme scopes, font faces. */
function sectionCss(system: DesignSystem, section: DesignSystemSection): string {
  if (section === "themes")
    return system.themes
      .map((t) => `#theme-${tokenName(t.name)}{${declarations("color", t.colors).join("")}}`)
      .join("\n");
  if (section === "fonts")
    // The family is ours, never the agent's name; `mxc` and the rest passed a strict pattern.
    return system.fonts
      .map((f, i) => {
        const face = `${f.weight ? `font-weight:${f.weight};` : ""}${f.style ? `font-style:${f.style};` : ""}`;
        return `@font-face{font-family:"ds-font-${i}";src:url(${f.mxc});${face}}\n.f${i}{font-family:"ds-font-${i}",sans-serif;${face}}`;
      })
      .join("\n");
  return "";
}

function sectionBody(system: DesignSystem, section: Exclude<DesignSystemSection, "overview">): string {
  if (sectionCount(system, section) === 0) return `<p class="empty">Nothing in this section.</p>`;
  if (isTokenSection(section)) {
    const layout = section === "spacing" || section === "typography" ? "list" : "grid";
    return `<div class="${layout} ${section}">${system[section].map((t) => tokenItem(section, t)).join("")}</div>`;
  }
  switch (section) {
    case "themes":
      return system.themes
        .map(
          (t) =>
            `<section id="theme-${tokenName(t.name)}" class="theme"><h2>${escapeHtml(t.name)}</h2><div class="grid colors">${t.colors.map((c) => tokenItem("colors", c, `theme-${tokenName(t.name)}-`)).join("")}</div></section>`,
        )
        .join("");
    case "fonts":
      return `<div class="list fonts">${system.fonts
        .map(
          (f, i) =>
            `<div id="font-${i + 1}" class="typo"><div class="sample f${i}">${SAMPLE}</div>${meta(f.name, [f.weight, f.style].filter(Boolean).join(" ") || undefined)}</div>`,
        )
        .join("")}</div>`;
    case "layout":
      return `<div class="list layout">${system.layout.map((n, i) => `<div id="layout-${i + 1}">${meta(n.name, n.value, n.description)}</div>`).join("")}</div>`;
    case "components":
      return `<div class="list components">${markupCards("component", system.components.map((c) => ({ ...c, markup: c.html })))}</div>`;
    default:
      return `<div class="grid assets">${markupCards(
        section.replace(/s$/, ""),
        system[section].map((a) => ({ name: a.name, markup: `<style>svg{max-width:100%;max-height:100%}</style>${a.svg}` })),
      )}</div>`;
  }
}

/**
 * Component html and asset svg are agent markup, unescaped. That is safe only because
 * the page runs in the sandboxed frame (no same-origin, CSP with no network); it must
 * never be inserted into the app's own DOM. Each item gets its own shadow root, filled
 * as a fragment (`innerHTML`), so unbalanced or unclosed markup and its `<style>` stay
 * inside its card. Script elements set through innerHTML do not run, but inline handlers (`onerror`) do; the frame sandbox and CSP contain them.
 */
function markupCards(prefix: string, items: { name: string; description?: string; markup: string }[]): string {
  const cards = items
    .map(
      (item, i) =>
        `<figure id="${prefix}-${i + 1}" class="card"><div class="stage" data-markup="${i}"></div><figcaption>${meta(item.name, undefined, item.description)}</figcaption></figure>`,
    )
    .join("");
  // Every `<` escaped, so nothing in the data can end the script or open a comment.
  const data = JSON.stringify(items.map((item) => item.markup)).replace(/</g, "\\u003c");
  return `${cards}<script>(function(){var M=${data};document.querySelectorAll("[data-markup]").forEach(function(el){el.attachShadow({mode:"open"}).innerHTML=M[+el.getAttribute("data-markup")];});})();</script>`;
}

/**
 * A complete HTML page for one non-overview section, for
 * `buildArtifactSrcdoc("html", page, channel)`. Every item has a stable id
 * (`color-brand`, `component-1`) so an annotation's selector names it.
 */
export function designSystemSectionPage(
  system: DesignSystem,
  section: Exclude<DesignSystemSection, "overview">,
): string {
  const label = escapeHtml(sectionLabel(section));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${label}</title><style>
${rootVariables(system)}
${PAGE_CSS}
${sectionCss(system, section)}
</style></head><body><h1>${label}</h1>${sectionBody(system, section)}</body></html>`;
}
