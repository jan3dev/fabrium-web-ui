import type { DesignSystemRef } from "@zooid/core";
import { IDENTIFIER, record } from "./artifacts.js";

/**
 * Design systems across threads (design modes spec §5.6). A workspace or project space
 * lists `design-system` artifacts in one state event that owners and admins write; the
 * `zooid_design_system` tool lists them and reads one. Everything read here is untrusted
 * (any writer of the event, any author of the artifact): fields are type-checked,
 * clamped, and CSS values that could leave their declaration are dropped.
 */
export const DESIGN_SYSTEMS_EVENT_TYPE = "dev.fabrium.design_systems";
/** On an `m.room.message`: the sender's own choice, `{ room_id, identifier }` or `{ off: true }`. */
const DESIGN_SYSTEM_CHOICE_KEY = "dev.fabrium.design_system";

const MAX_SYSTEMS = 50;
const MAX_ITEMS = 100;
const MAX_NAME = 80;
const MAX_VALUE = 300;
const MAX_OVERVIEW = 20_000;
const MAX_MARKUP = 20_000;
/** Printable ASCII without a backtick: IDs end up in a line of the agent's prompt. */
const ROOM_ID = /^![\x21-\x5f\x61-\x7e]{1,254}$/;
const EVENT_ID = /^\$[^\s]{1,254}$/;
const MXC = /^mxc:\/\/[A-Za-z0-9.:[\]-]{1,255}\/[A-Za-z0-9_-]{1,255}$/;
const KINDS = ["slides", "design"] as const;

type Raw = Record<string, unknown>;
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.slice(0, MAX_ITEMS).map(record) : []);
/** One line of plain text, or "" when absent or not a string. */
function text(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** The systems one `dev.fabrium.design_systems` content lists, in order. */
export function parseDesignSystemList(content: unknown): DesignSystemRef[] {
  const systems = record(content).systems;
  if (!Array.isArray(systems)) return [];
  const out: DesignSystemRef[] = [];
  for (const raw of systems) {
    const s = record(raw);
    const { room_id, thread_id, identifier } = s;
    if (typeof room_id !== "string" || !ROOM_ID.test(room_id)) continue;
    if (typeof thread_id !== "string" || !EVENT_ID.test(thread_id)) continue;
    if (typeof identifier !== "string" || !IDENTIFIER.test(identifier)) continue;
    const scope = Array.isArray(s.for) ? KINDS.filter((k) => (s.for as unknown[]).includes(k)) : [];
    out.push({
      room_id,
      thread_id,
      identifier,
      name: text(s.name, MAX_NAME) || identifier,
      ...(s.default === true ? { default: true } : {}),
      ...(scope.length ? { for: scope } : {}),
    });
    if (out.length >= MAX_SYSTEMS) break;
  }
  return out;
}

/**
 * Lists in order of precedence (project spaces, then the workspace) merged: the first
 * entry of a system wins. Each entry says which kinds it is the default for: the first
 * default whose `for` is absent or names the kind.
 */
export function mergeDesignSystemLists(lists: DesignSystemRef[][]): DesignSystemRef[] {
  const seen = new Set<string>();
  const merged = lists.flat().filter((s) => {
    const key = `${s.room_id} ${s.identifier}`;
    return !seen.has(key) && seen.add(key);
  });
  return merged.map((s) => {
    const kinds = KINDS.filter((k) => merged.find((d) => d.default && (!d.for || d.for.includes(k))) === s);
    return kinds.length ? { ...s, default_for: kinds } : s;
  });
}

/**
 * Same rule as the web's `cssValue`: nothing that can end the declaration, the block or the
 * element, and balanced brackets. Control characters are already gone (`text`).
 */
function cssValue(value: string): string {
  if (/[;{}<>\\]|\/\*|\*\//.test(value)) return "";
  if ((value.split('"').length - 1) % 2 || (value.split("'").length - 1) % 2) return "";
  let depth = 0;
  for (const c of value) {
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && --depth < 0) return "";
  }
  return depth === 0 ? value : "";
}

const tokenName = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Token section → CSS variable prefix, as the web's section pages name them. */
const PREFIX = { colors: "color", spacing: "spacing", typography: "font", radius: "radius", shadows: "shadow" } as const;

interface Token {
  name: string;
  var: string;
  value: string;
  description?: string;
}

function tokens(raw: unknown, prefix: string): Token[] {
  const seen = new Set<string>();
  return list(raw).flatMap((t) => {
    const name = tokenName(text(t.name, MAX_NAME));
    const value = cssValue(text(t.value, MAX_VALUE));
    if (!name || !value || seen.has(name)) return [];
    seen.add(name);
    const description = text(t.description, MAX_VALUE);
    return [{ name, var: `--${prefix}-${name}`, value, ...(description ? { description } : {}) }];
  });
}

const declarations = (ts: Token[]) => ts.map((t) => `  ${t.var}: ${t.value};`).join("\n");

/** What `zooid_design_system` returns for one system: the parts an agent applies, or one component. */
export function readDesignSystem(json: string, component?: string): Record<string, unknown> {
  let data: unknown = null;
  try {
    data = JSON.parse(json);
  } catch {
    // not JSON: rejected below
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("invalid_content: the design system is not a JSON object.");
  }
  const d = data as Raw;
  const components = list(d.components).flatMap((c) => {
    const name = text(c.name, MAX_NAME);
    if (!name || typeof c.html !== "string") return [];
    const description = text(c.description, MAX_VALUE);
    return [{ name, ...(description ? { description } : {}), html: c.html.slice(0, MAX_MARKUP) }];
  });
  if (component !== undefined) {
    const found = components.find((c) => c.name.toLowerCase() === component.trim().toLowerCase());
    if (!found) {
      throw new Error(`not_found: no component "${component}". Components: ${components.map((c) => c.name).join(", ") || "none"}.`);
    }
    return { component: found };
  }
  const sections = Object.fromEntries(
    Object.entries(PREFIX).map(([key, prefix]) => [key, tokens(d[key], prefix)]),
  ) as Record<keyof typeof PREFIX, Token[]>;
  const themes = list(d.themes).flatMap((t) => {
    const name = tokenName(text(t.name, MAX_NAME));
    return name ? [{ name, colors: tokens(t.colors, "color") }] : [];
  });
  const css = [
    `:root {\n${declarations(Object.values(sections).flat())}\n}`,
    ...themes.map((t) => `[data-theme="${t.name}"] {\n${declarations(t.colors)}\n}`),
  ].join("\n");
  const names = (v: unknown) => list(v).flatMap((a) => (text(a.name, MAX_NAME) ? [text(a.name, MAX_NAME)] : []));
  const fonts = list(d.fonts).flatMap((f) => {
    const name = text(f.name, MAX_NAME);
    if (!name || typeof f.mxc !== "string" || !MXC.test(f.mxc)) return [];
    const weight = typeof f.weight === "number" ? String(f.weight) : text(f.weight, 10);
    const style = text(f.style, 10);
    return [
      {
        name,
        mxc: f.mxc,
        ...(/^(normal|bold|[1-9]\d{0,2}|1000)$/.test(weight) ? { weight } : {}),
        ...(/^(normal|italic|oblique)$/.test(style) ? { style } : {}),
      },
    ];
  });
  const layout = list(d.layout).flatMap((l) => {
    const name = text(l.name, MAX_NAME);
    const value = text(l.value, MAX_VALUE);
    const description = text(l.description, MAX_VALUE);
    return name && value ? [{ name, value, ...(description ? { description } : {}) }] : [];
  });
  return {
    overview: typeof d.overview === "string" ? d.overview.slice(0, MAX_OVERVIEW) : "",
    css,
    tokens: sections,
    themes: themes.map((t) => t.name),
    fonts,
    layout,
    components: components.map(({ html: _html, ...c }) => c),
    icons: names(d.icons),
    logos: names(d.logos),
    assets: names(d.assets),
  };
}

/** The per-turn line for a message that carries its sender's own design-system choice, or null. */
export function designSystemChoiceLine(content: unknown): string | null {
  const c = record(record(content)[DESIGN_SYSTEM_CHOICE_KEY]);
  if (c.off === true) return "The user turned design systems off for their work: do not apply one unless they ask.";
  const { room_id, identifier } = c;
  if (typeof room_id !== "string" || !ROOM_ID.test(room_id)) return null;
  if (typeof identifier !== "string" || !IDENTIFIER.test(identifier)) return null;
  return `The user's own design system is \`${identifier}\` (room ${room_id}): use it instead of the default; read it with zooid_design_system.`;
}
