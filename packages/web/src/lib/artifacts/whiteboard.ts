import { type AssetKind, isMxc, MAX_ASSETS } from "./assets";
import { isObject } from "./design-system";
import { jsonLike } from "./edit";
import { MAX_REF_SNIPPET, type ArtifactRefTarget } from "./refs";

/**
 * A `whiteboard` artifact (spec §6.10): one JSON document `{ nodes, edges }` an agent or a
 * user writes. Nothing in it is markup: the app renders every string as text. The reader
 * takes untrusted JSON and returns a clamped model; what does not fit is dropped, it never
 * throws. The edit operations are pure, model in, model out.
 */

export const NODE_TYPES = ["note", "text", "shape", "section", "image", "video"] as const;
export type NodeType = (typeof NODE_TYPES)[number];
export const SHAPES = ["rectangle", "oval", "diamond"] as const;
export type ShapeKind = (typeof SHAPES)[number];
export const BOARD_COLORS = ["yellow", "orange", "red", "pink", "purple", "blue", "green", "gray"] as const;
export type BoardColor = (typeof BOARD_COLORS)[number];
export const ARROWS = ["none", "end", "both"] as const;
export type Arrow = (typeof ARROWS)[number];
export const LINE_STYLES = ["solid", "dashed", "dotted"] as const;
export type LineStyle = (typeof LINE_STYLES)[number];

export const BOARD_LIMITS = {
  nodes: 500,
  edges: 1000,
  coord: 100_000,
  minSize: 8,
  maxSize: 10_000,
  text: 2000,
  label: 200,
} as const;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface BoardNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** A section's name; a note's, text's or shape's text; an image's or video's description. */
  text?: string;
  color?: BoardColor;
  /** Type `shape` only; absent is `rectangle`. */
  shape?: ShapeKind;
  /** Type `image` and `video` only. */
  mxc?: string;
}

export interface BoardEdge {
  from: string;
  to: string;
  label?: string;
  /** Absent is `end`. */
  arrow?: Arrow;
  /** Absent is `solid`. */
  style?: LineStyle;
  /** Absent is the neutral stroke. */
  color?: BoardColor;
}

export interface Board {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined => list.find((x) => x === v);
const coord = (n: number) => clamp(n, -BOARD_LIMITS.coord, BOARD_LIMITS.coord);
const size = (n: number) => clamp(n, BOARD_LIMITS.minSize, BOARD_LIMITS.maxSize);

function readNode(raw: unknown): BoardNode | null {
  if (!isObject(raw)) return null;
  const type = oneOf(NODE_TYPES, raw.type);
  const [x, y, w, h] = [raw.x, raw.y, raw.w, raw.h].map(num);
  if (typeof raw.id !== "string" || !ID.test(raw.id) || !type || x == null || y == null || w == null || h == null)
    return null;
  // Built in this key order, so a saved board reads the same way every time.
  const node: BoardNode = { id: raw.id, type, x: coord(x), y: coord(y), w: size(w), h: size(h) };
  if (typeof raw.text === "string" && raw.text) node.text = raw.text.slice(0, BOARD_LIMITS.text);
  const color = oneOf(BOARD_COLORS, raw.color);
  if (color) node.color = color;
  const shape = type === "shape" ? oneOf(SHAPES, raw.shape) : undefined;
  if (shape) node.shape = shape;
  if ((type === "image" || type === "video") && isMxc(raw.mxc)) node.mxc = raw.mxc;
  return node;
}

function readEdge(raw: unknown, ids: ReadonlySet<string>): BoardEdge | null {
  if (!isObject(raw) || typeof raw.from !== "string" || typeof raw.to !== "string") return null;
  if (!ids.has(raw.from) || !ids.has(raw.to) || raw.from === raw.to) return null;
  const edge: BoardEdge = { from: raw.from, to: raw.to };
  if (typeof raw.label === "string" && raw.label) edge.label = raw.label.slice(0, BOARD_LIMITS.label);
  const arrow = oneOf(ARROWS, raw.arrow);
  if (arrow) edge.arrow = arrow;
  const style = oneOf(LINE_STYLES, raw.style);
  if (style) edge.style = style;
  const color = oneOf(BOARD_COLORS, raw.color);
  if (color) edge.color = color;
  return edge;
}

type Raw = Record<string, unknown>;

/** The board in `text` and the JSON item each node and edge was read from, or null when it is not a JSON object. */
function parse(text: string): { data: Raw; board: Board; source: Map<object, Raw> } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(data)) return null;
  const source = new Map<object, Raw>();
  const nodes: BoardNode[] = [];
  const ids = new Set<string>();
  for (const raw of Array.isArray(data.nodes) ? (data.nodes as unknown[]) : []) {
    if (nodes.length >= BOARD_LIMITS.nodes) break;
    const n = readNode(raw);
    // A later duplicate is dropped.
    if (n && !ids.has(n.id)) {
      ids.add(n.id);
      nodes.push(n);
      source.set(n, raw as Raw);
    }
  }
  const edges: BoardEdge[] = [];
  for (const raw of Array.isArray(data.edges) ? (data.edges as unknown[]) : []) {
    if (edges.length >= BOARD_LIMITS.edges) break;
    const edge = readEdge(raw, ids);
    if (edge) {
      edges.push(edge);
      source.set(edge, raw as Raw);
    }
  }
  return { data, board: { nodes, edges }, source };
}

/** The board in `text`, or null when it is not a JSON object. */
export function readBoard(text: string): Board | null {
  return parse(text)?.board ?? null;
}

/** `raw` with the fields that differ between `was` and `now` written over it. */
function patched(raw: Raw, was: object, now: object): Raw {
  const [a, b, out] = [was as Raw, now as Raw, { ...raw }];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] === b[k]) continue;
    if (k in b) out[k] = b[k];
    else delete out[k];
  }
  return out;
}

const sameNode = (a: BoardNode, b: BoardNode) => a.id === b.id;
// A reversed connection is the same one.
const sameEdge = (a: BoardEdge, b: BoardEdge) => (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);

/**
 * One edit to the board in `text`, re-serialized in the source's indent. Throws a message for
 * the user when the text is no board; an edit that changes nothing leaves the text as it is.
 * The edit goes onto the source JSON, field by field: what the reader dropped or clamped
 * (unknown fields, items it did not read, text past the limit) stays as it was written.
 */
export function editBoard(text: string, change: (board: Board) => Board): string {
  const src = parse(text);
  if (!src) throw new Error("The whiteboard is not a JSON object.");
  const { data, board, source } = src;
  const next = change(board);
  if (next === board) return text;
  const read = new Set<unknown>(source.values());
  const write = <T extends object>(key: "nodes" | "edges", was: readonly T[], now: readonly T[], same: (a: T, b: T) => boolean) => {
    // Every operation keeps the items it leaves alone, so one that is not in `now` was changed or deleted.
    const kept = new Set<object>(now);
    const open = was.filter((item) => !kept.has(item));
    const items = now.map((item) => {
      if (source.has(item)) return source.get(item)!;
      const i = open.findIndex((old) => same(old, item));
      if (i < 0) return item;
      const [old] = open.splice(i, 1);
      return patched(source.get(old!)!, old!, item);
    });
    const unread = Array.isArray(data[key]) ? (data[key] as unknown[]).filter((raw) => !read.has(raw)) : [];
    return [...items, ...unread];
  };
  return jsonLike(text, {
    ...data,
    nodes: write("nodes", board.nodes, next.nodes, sameNode),
    edges: write("edges", board.edges, next.edges, sameEdge),
  });
}

/** The images and videos the board names, by URI (spec §5.4). */
export function findBoardAssets(text: string): Map<string, AssetKind> {
  const out = new Map<string, AssetKind>();
  for (const n of readBoard(text)?.nodes ?? [])
    if (n.mxc && !out.has(n.mxc) && out.size < MAX_ASSETS) out.set(n.mxc, n.type === "video" ? "video" : "image");
  return out;
}

// ── Geometry ────────────────────────────────────────────────────────────────

const centerOf = (n: Box) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
const inside = (box: Box, p: { x: number; y: number }) =>
  p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;

/** The nodes whose center lies in `box`: a section's members, or an area the user drew. */
export function nodesIn(board: Board, box: Box, except?: string): string[] {
  return board.nodes.filter((n) => n.id !== except && inside(box, centerOf(n))).map((n) => n.id);
}

/** `ids` and the members of every section among them: what moves together. */
export function withMembers(board: Board, ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  for (const n of board.nodes) if (n.type === "section" && out.has(n.id)) for (const m of nodesIn(board, n, n.id)) out.add(m);
  return out;
}

/** The topmost node at `p` (board units): any other node over a section, a later one over an earlier. */
export function nodeAt(board: Board, p: { x: number; y: number }, except?: string): string | null {
  const hit = board.nodes.filter((n) => n.id !== except && inside(n, p)).reverse();
  return (hit.find((n) => n.type !== "section") ?? hit[0])?.id ?? null;
}

/** The box around every node, or null for an empty board. */
export function boardBounds(nodes: readonly Box[]): Box | null {
  if (nodes.length === 0) return null;
  const x = Math.min(...nodes.map((n) => n.x));
  const y = Math.min(...nodes.map((n) => n.y));
  return {
    x,
    y,
    w: Math.max(...nodes.map((n) => n.x + n.w)) - x,
    h: Math.max(...nodes.map((n) => n.y + n.h)) - y,
  };
}

/** The point on `box`'s edge on the line from its center toward `to`. */
export function edgePoint(box: Box, to: { x: number; y: number }): { x: number; y: number } {
  const c = centerOf(box);
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  if (!dx && !dy) return c;
  const k = Math.min(dx ? box.w / 2 / Math.abs(dx) : Infinity, dy ? box.h / 2 / Math.abs(dy) : Infinity);
  return { x: c.x + dx * k, y: c.y + dy * k };
}

// ── Edits ───────────────────────────────────────────────────────────────────

const DEFAULT_SIZE: Record<NodeType, [number, number]> = {
  note: [200, 160],
  text: [240, 48],
  shape: [180, 120],
  section: [480, 320],
  image: [320, 240],
  video: [320, 180],
};

/** The first `nN` id the board does not use. */
export function nextId(board: Board): string {
  const taken = new Set(board.nodes.map((n) => n.id));
  let k = board.nodes.length + 1;
  while (taken.has(`n${k}`)) k++;
  return `n${k}`;
}

/** A node of `type` centered on `at`, with the board's next id and its type's default size. */
export function newNode(
  board: Board,
  type: NodeType,
  at: { x: number; y: number },
  extra: Partial<Pick<BoardNode, "text" | "shape" | "mxc" | "w" | "h">> = {},
): BoardNode {
  const [w, h] = [extra.w ?? DEFAULT_SIZE[type][0], extra.h ?? DEFAULT_SIZE[type][1]];
  const node = readNode({ ...extra, id: nextId(board), type, x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h });
  if (!node) throw new Error("That node could not be added.");
  return node;
}

const count = (board: Board) => {
  if (board.nodes.length >= BOARD_LIMITS.nodes) throw new Error(`A whiteboard holds at most ${BOARD_LIMITS.nodes} nodes.`);
};

/** Sections go first: they are drawn under the other nodes. A taken id gets the next free one. */
export function addNode(board: Board, node: BoardNode): Board {
  count(board);
  const clean = readNode(board.nodes.some((n) => n.id === node.id) ? { ...node, id: nextId(board) } : node);
  if (!clean) return board;
  return { ...board, nodes: clean.type === "section" ? [clean, ...board.nodes] : [...board.nodes, clean] };
}

function mapNodes(board: Board, ids: ReadonlySet<string>, f: (n: BoardNode) => BoardNode): Board {
  let changed = false;
  const nodes = board.nodes.map((n) => {
    if (!ids.has(n.id)) return n;
    const next = f(n);
    if (next !== n) changed = true;
    return next;
  });
  return changed ? { ...board, nodes } : board;
}

/** Moves `ids` and the members of the sections among them by whole units. */
export function moveNodes(board: Board, ids: Iterable<string>, dx: number, dy: number): Board {
  const [mx, my] = [Math.round(dx), Math.round(dy)];
  if ((!mx && !my) || !Number.isFinite(mx) || !Number.isFinite(my)) return board;
  return mapNodes(board, withMembers(board, ids), (n) => {
    const [x, y] = [coord(n.x + mx), coord(n.y + my)];
    return x === n.x && y === n.y ? n : { ...n, x, y };
  });
}

export function resizeNode(board: Board, id: string, w: number, h: number): Board {
  if (!Number.isFinite(w) || !Number.isFinite(h)) return board;
  const [nw, nh] = [size(Math.round(w)), size(Math.round(h))];
  return mapNodes(board, new Set([id]), (n) => (n.w === nw && n.h === nh ? n : { ...n, w: nw, h: nh }));
}

/** The node's text, as text; empty removes it. */
export function setNodeText(board: Board, id: string, text: string): Board {
  const t = text.slice(0, BOARD_LIMITS.text);
  return mapNodes(board, new Set([id]), (n) => {
    if ((n.text ?? "") === t) return n;
    const { text: _old, ...rest } = n;
    return t ? { ...rest, text: t } : rest;
  });
}

/** The color of `ids`; null removes it (the type's default shows). */
export function setNodeColor(board: Board, ids: Iterable<string>, color: BoardColor | null): Board {
  return mapNodes(board, new Set(ids), (n) => {
    if ((n.color ?? null) === color) return n;
    const { color: _old, ...rest } = n;
    return color ? { ...rest, color } : rest;
  });
}

/** An edge from `from` to `to` with an arrow at its end, unless the two are connected already. */
export function connect(board: Board, from: string, to: string): Board {
  const ids = new Set(board.nodes.map((n) => n.id));
  if (from === to || !ids.has(from) || !ids.has(to)) return board;
  if (board.edges.some((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from))) return board;
  if (board.edges.length >= BOARD_LIMITS.edges)
    throw new Error(`A whiteboard holds at most ${BOARD_LIMITS.edges} connections.`);
  return { ...board, edges: [...board.edges, { from, to }] };
}

/** A change to one connection; `color: null` removes the color. */
export type EdgePatch = { arrow?: Arrow; style?: LineStyle; color?: BoardColor | null; label?: string };
const EDGE_DEFAULTS = { arrow: "end", style: "solid", color: null, label: "" } as const;

/** Changes the connection at `index`. A default (end arrow, solid, no color, no label) is left out of the JSON. */
export function setEdge(board: Board, index: number, patch: EdgePatch): Board {
  const old = board.edges[index];
  if (!old) return board;
  const merged: Record<string, unknown> = { ...old, ...patch };
  // A label is one line of plain text.
  if (patch.label !== undefined) merged.label = patch.label.replace(/\s+/g, " ").trim();
  for (const [k, d] of Object.entries(EDGE_DEFAULTS)) if (merged[k] === d) delete merged[k];
  const next = readEdge(merged, new Set(board.nodes.map((n) => n.id)));
  if (!next || JSON.stringify(next) === JSON.stringify(old)) return board;
  return { ...board, edges: board.edges.map((e, i) => (i === index ? next : e)) };
}

/** Swaps the connection's ends: how its direction is set. */
export function reverseEdge(board: Board, index: number): Board {
  if (!board.edges[index]) return board;
  return { ...board, edges: board.edges.map((e, i) => (i === index ? { ...e, from: e.to, to: e.from } : e)) };
}

export function deleteEdge(board: Board, index: number): Board {
  return index >= 0 && index < board.edges.length ? { ...board, edges: board.edges.filter((_, i) => i !== index) } : board;
}

/** Removes `ids` and their edges. A deleted section's members stay. */
export function deleteNodes(board: Board, ids: Iterable<string>): Board {
  const gone = new Set(ids);
  if (!board.nodes.some((n) => gone.has(n.id))) return board;
  return {
    nodes: board.nodes.filter((n) => !gone.has(n.id)),
    edges: board.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
  };
}

const SECTION_PAD = 40;

/** A new section `id` around `ids`, with room for its name above them. */
export function groupIntoSection(board: Board, ids: Iterable<string>, id: string, name = "Section"): Board {
  const set = new Set(ids);
  const box = boardBounds(board.nodes.filter((n) => set.has(n.id)));
  if (!box) return board;
  return addNode(board, {
    id,
    type: "section",
    x: box.x - SECTION_PAD,
    y: box.y - SECTION_PAD * 1.5,
    w: box.w + SECTION_PAD * 2,
    h: box.h + SECTION_PAD * 2.5,
    text: name,
  });
}

// ── Requests to the agent (spec §6.10) ─────────────────────────────────────

export type BoardRequest = "reorganize" | "gaps" | "deck" | "document";

/** A thread message, phrased as the user would; it names the artifact. */
export function composeBoardRequest(request: BoardRequest, identifier: string): string {
  const board = `the whiteboard \`${identifier}\``;
  switch (request) {
    case "reorganize":
      return `Please reorganize ${board}. Group related nodes into sections by theme, or lay them out as a timeline if that fits better. Keep the text of every node.`;
    case "gaps":
      return `Please find the gaps in ${board}. What is missing, unclear or not connected? Add each gap to the board as a note.`;
    case "deck":
      return `Please turn ${board} into a slides artifact. Make one slide per section and use the notes as the content.`;
    case "document":
      return `Please turn ${board} into a document (a markdown artifact) that covers every section and note.`;
  }
}

/** "Ask about this area": the nodes in it as a reference that rides in the reply. */
export function areaTarget(board: Board, ids: readonly string[]): ArtifactRefTarget {
  const by = new Map(board.nodes.map((n) => [n.id, n]));
  const lines = ids.flatMap((id) => {
    const n = by.get(id);
    if (!n) return [];
    const text = n.text?.replace(/\s+/g, " ").trim();
    return [`- ${id} (${n.type})${text ? `: ${text}` : ""}`];
  });
  return {
    kind: "text",
    where: `whiteboard area, ${lines.length} ${lines.length === 1 ? "node" : "nodes"}`,
    text: lines.join("\n").slice(0, MAX_REF_SNIPPET),
  };
}

// ── Comments on nodes and connections (spec §6.6) ──────────────────────────

/** What a board comment points at: a node by id, or a connection by its ends. */
export type BoardTarget = { node: string } | { from: string; to: string };

const NODE_WHERE = /^whiteboard node ([A-Za-z0-9_-]{1,64})$/;
const EDGE_WHERE = /^whiteboard connection ([A-Za-z0-9_-]{1,64}) -> ([A-Za-z0-9_-]{1,64})$/;

/** The connection between `from` and `to` in either direction, or -1: a reversed connection is the same one. */
export function findEdge(board: Board, t: { from: string; to: string }): number {
  return board.edges.findIndex((e) => (e.from === t.from && e.to === t.to) || (e.from === t.to && e.to === t.from));
}

/** `note "Ship it" (id n3)`: how the agent reads a node. */
function nodeRef(n: BoardNode): string {
  const text = n.text?.replace(/\s+/g, " ").trim();
  return `${n.type}${text ? ` "${text}"` : ""} (id ${n.id})`;
}

/**
 * A comment's reference to a node or a connection: a text target, so the agent reads it in the
 * message body as any annotation (`Text (whiteboard node n3):` and the node). `where` carries the
 * ids, so `boardTargetOf` finds the target again. Null when the board has no such target.
 */
export function boardCommentTarget(board: Board, t: BoardTarget): ArtifactRefTarget | null {
  const by = new Map(board.nodes.map((n) => [n.id, n]));
  if ("node" in t) {
    const n = by.get(t.node);
    if (!n) return null;
    const ref = nodeRef(n);
    return { kind: "text", where: `whiteboard node ${n.id}`, text: (ref[0]!.toUpperCase() + ref.slice(1)).slice(0, MAX_REF_SNIPPET) };
  }
  const e = board.edges[findEdge(board, t)];
  const [a, b] = [by.get(e?.from ?? ""), by.get(e?.to ?? "")];
  if (!e || !a || !b) return null;
  return {
    kind: "text",
    where: `whiteboard connection ${e.from} -> ${e.to}`,
    text: `Connection from ${nodeRef(a)} to ${nodeRef(b)}${e.label ? `, label "${e.label}"` : ""}`.slice(0, MAX_REF_SNIPPET),
  };
}

/** The node or connection a reference points at, or null when it is no board comment. */
export function boardTargetOf(t: ArtifactRefTarget): BoardTarget | null {
  if (t.kind !== "text" || !t.where) return null;
  const node = NODE_WHERE.exec(t.where);
  if (node) return { node: node[1]! };
  const edge = EDGE_WHERE.exec(t.where);
  return edge ? { from: edge[1]!, to: edge[2]! } : null;
}

/** False when the board no longer has the target: its comment is resolved. */
export function boardHas(board: Board, t: BoardTarget): boolean {
  return "node" in t ? board.nodes.some((n) => n.id === t.node) : findEdge(board, t) >= 0;
}
