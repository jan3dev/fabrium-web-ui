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

export interface DesignSystem {
  /** Markdown; "" when absent. */
  overview: string;
  colors: DesignToken[];
  spacing: DesignToken[];
  typography: DesignToken[];
  radius: DesignToken[];
  shadows: DesignToken[];
  components: DesignComponent[];
  assets: DesignAsset[];
}

/** Display order. Keys are the JSON keys. */
const DESIGN_SYSTEM_SECTIONS = [
  { key: "overview", label: "Overview" },
  { key: "colors", label: "Colors" },
  { key: "spacing", label: "Spacing" },
  { key: "typography", label: "Typography" },
  { key: "radius", label: "Corner radius" },
  { key: "shadows", label: "Shadows" },
  { key: "components", label: "Components" },
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

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw =>
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
function tokenName(name: string): string {
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
    spacing: tokens(data.spacing),
    typography: tokens(data.typography),
    radius: tokens(data.radius),
    shadows: tokens(data.shadows),
    components: list(data.components, (item) => {
      const name = field(item, "name", LIMITS.name, true);
      const description = field(item, "description", LIMITS.description, false);
      const html = field(item, "html", LIMITS.markup, true);
      if (name === undefined || description === undefined || html === undefined) return null;
      return description ? { name, description, html } : { name, html };
    }),
    assets: list(data.assets, (item) => {
      const name = field(item, "name", LIMITS.name, true);
      const svg = field(item, "svg", LIMITS.markup, true);
      return name === undefined || svg === undefined ? null : { name, svg };
    }),
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

/** Every token as a CSS variable, so samples and component html can use `var(--color-brand)`. */
function rootVariables(system: DesignSystem): string {
  const lines: string[] = [];
  for (const section of TOKEN_SECTIONS) {
    for (const t of system[section]) {
      const v = cssValue(t.value);
      // Names are `[a-z0-9-]` after parsing; re-normalised in case the caller built the object.
      if (v) lines.push(`--${TOKEN_PREFIX[section]}-${tokenName(t.name)}: ${v};`);
    }
  }
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
.empty{color:rgb(99,99,102)}`;

const SAMPLE = "The quick brown fox jumps over the lazy dog";

function meta(name: string, value?: string, description?: string): string {
  return (
    `<div class="name">${escapeHtml(name)}</div>` +
    (value !== undefined ? `<div class="value">${escapeHtml(value)}</div>` : "") +
    (description ? `<div class="desc">${escapeHtml(description)}</div>` : "")
  );
}

/** Style attributes only ever hold `var(--…)` of a normalised name, never an agent value. */
function tokenItem(section: TokenSection, t: DesignToken): string {
  const id = `${TOKEN_PREFIX[section]}-${tokenName(t.name)}`;
  const v = `var(--${id})`;
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

function sectionBody(system: DesignSystem, section: Exclude<DesignSystemSection, "overview">): string {
  if (sectionCount(system, section) === 0) return `<p class="empty">Nothing in this section.</p>`;
  if (isTokenSection(section)) {
    const layout = section === "spacing" || section === "typography" ? "list" : "grid";
    return `<div class="${layout} ${section}">${system[section].map((t) => tokenItem(section, t)).join("")}</div>`;
  }
  if (section === "components")
    return `<div class="list components">${markupCards("component", system.components.map((c) => ({ ...c, markup: c.html })))}</div>`;
  return `<div class="grid assets">${markupCards(
    "asset",
    system.assets.map((a) => ({ name: a.name, markup: `<style>svg{max-width:100%;max-height:100%}</style>${a.svg}` })),
  )}</div>`;
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
</style></head><body><h1>${label}</h1>${sectionBody(system, section)}</body></html>`;
}
