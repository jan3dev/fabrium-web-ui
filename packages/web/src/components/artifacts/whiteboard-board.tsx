import { memo, type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clampZoom, stepZoom, ZOOM_KEYS } from "@/lib/artifacts/frames";
import {
  addNode,
  BOARD_COLORS,
  BOARD_LIMITS,
  type Board,
  type BoardColor,
  type BoardNode,
  type BoardRequest,
  type BoardTarget,
  boardBounds,
  type Box,
  connect,
  deleteEdge,
  deleteNodes,
  edgePoint,
  findEdge,
  groupIntoSection,
  type LineStyle,
  moveNodes,
  newNode,
  nextId,
  nodeAt,
  nodesIn,
  type NodeType,
  resizeNode,
  reverseEdge,
  setEdge,
  setNodeColor,
  setNodeText,
  withMembers,
} from "@/lib/artifacts/whiteboard";
import { isEditableKeyboardTarget } from "@/lib/keyboard-shortcuts";
import { cn } from "@/lib/utils";
import { FramePins } from "./artifact-comments";
import { type BoardTool, WhiteboardToolbar } from "./whiteboard-toolbar";

/** `edit`: every tool. `retype`: a phone, view and retype only (spec §6.1). `view`: no edits. */
export type BoardMode = "edit" | "retype" | "view";

type Point = { x: number; y: number };
/** A connection, by the nodes it joins. */
type Ends = { from: string; to: string };

const TYPE_LABEL: Record<NodeType, string> = {
  note: "Note",
  text: "Text",
  shape: "Shape",
  section: "Section",
  image: "Image",
  video: "Video",
};
const DEFAULT_COLOR: Partial<Record<NodeType, BoardColor>> = { note: "yellow", shape: "blue", section: "gray" };
/** Screen px around the board when it is fitted to the view. */
const FIT_PAD = 48;
/** Screen px a pointer moves before a press becomes a drag. */
const DRAG_SLOP = 3;
const MAX_MEDIA = 480;

const DASH: Record<LineStyle, string | undefined> = { solid: undefined, dashed: "8 6", dotted: "0.5 6" };

const typeLabel = (n: BoardNode) => (n.type === "shape" ? (n.shape ?? "rectangle").replace(/^./, (c) => c.toUpperCase()) : TYPE_LABEL[n.type]);
const short = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);

type Gesture =
  | { kind: "pan"; start: Point; origin: Point }
  | { kind: "move"; start: Point; ids: Set<string>; moved: boolean }
  | { kind: "resize"; start: Point; id: string; w: number; h: number }
  | { kind: "rect"; start: Point; area: boolean; add: boolean }
  | { kind: "connect"; start: Point; from: string };

type Preview =
  | { kind: "move"; ids: Set<string>; dx: number; dy: number }
  | { kind: "resize"; id: string; w: number; h: number }
  | { kind: "rect"; box: Box }
  | { kind: "connect"; from: string; to: Point };

/** Where a connection is drawn: between the borders of its two nodes. */
function edgeLine(a: Box, b: Box): { p1: Point; p2: Point } {
  return { p1: edgePoint(a, { x: b.x + b.w / 2, y: b.y + b.h / 2 }), p2: edgePoint(b, { x: a.x + a.w / 2, y: a.y + a.h / 2 }) };
}

/** Comment mode (spec §6.6): a click or Enter on a node or a connection picks it, and open comments show markers. */
export interface BoardComments {
  markers: readonly { id: string; target: BoardTarget; author: string; onSelect: () => void }[];
  /** The note box, beside the target it is for. */
  draft: { target: BoardTarget; form: ReactNode; onClose: () => void } | null;
  onPick: (target: BoardTarget) => void;
}

/**
 * A whiteboard (spec §6.10), drawn in the app: a board holds no markup, so every string is a
 * React text node. Pan with scroll, Space-drag or a touch drag; zoom with the zoom menu,
 * Cmd/Ctrl + `=` `-` `0` or Cmd/Ctrl+wheel. Tab walks the nodes; arrows move them (Shift: 10),
 * Alt+arrows resize, Enter or a double-click retypes, Delete removes. Connections follow the nodes
 * in the Tab order: select one to set its arrowheads, direction, style, color and label. The handle
 * on a selected node drags out a new connection. Every change goes out as one `onEdit`, so it
 * saves, undoes and redoes as the other artifact edits do (spec §5.2).
 */
export function WhiteboardBoard({
  board,
  assets,
  mode,
  onEdit: commit,
  onUpload,
  onRequest,
  onAskArea,
  comments,
}: {
  board: Board;
  /** Downloaded images and videos, by `mxc://` URI; the board makes its own blob URLs. */
  assets: readonly { mxc: string; blob: Blob }[];
  mode: BoardMode;
  /** `coalesce`: a repeat of the last edit (a held arrow key) joins it as one undo step. */
  onEdit: (change: (board: Board) => Board, summary: string, coalesce?: boolean) => void;
  /** Uploads an image or video; null when it was refused (the uploader tells the user). */
  onUpload?: (file: File) => Promise<{ mxc: string; kind: "image" | "video"; size: { w: number; h: number } | null } | null>;
  onRequest?: (request: BoardRequest) => void;
  /** "Ask about this area": the ids of the nodes in the rectangle the user drew. */
  onAskArea?: (ids: string[]) => void;
  /** Set while comment mode is on: clicks then pick, never select, move or edit. */
  comments?: BoardComments;
}) {
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const edit = mode === "edit";
  const commenting = comments !== undefined;
  // Connections take focus where something can be done with them.
  const edgesLive = edit || commenting;
  const viewport = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [pan, setPan] = useState<Point | null>(null);
  const [selected, setSelectedState] = useState<string[]>([]);
  const selectedRef = useRef<string[]>([]);
  // A connection is kept by its ends, not its index: an undo or a new version reorders the edges under it.
  const [edgeEnds, setEdgeEnds] = useState<Ends | null>(null);
  const selectEdge = (e: Ends | null) => setEdgeEnds(e && { from: e.from, to: e.to });
  const edgeAt = edgeEnds ? findEdge(board, edgeEnds) : -1;
  /** The selected connection's index in this board, or null. */
  const edge = edgeAt < 0 ? null : edgeAt;
  /** The text being typed: a node's (its id) or a connection's label (its ends). */
  const [editing, setEditing] = useState<{ id: string | Ends; text: string } | null>(null);
  const editingEdge = editing && typeof editing.id !== "string" ? findEdge(board, editing.id) : -1;
  const [area, setArea] = useState(false);
  const [space, setSpace] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const gesture = useRef<Gesture | null>(null);
  /** The selector of what gets focus once it is drawn. */
  const focusNext = useRef<string | null>(null);

  const select = (ids: string[]) => {
    selectedRef.current = ids;
    setSelectedState(ids);
    selectEdge(null);
  };

  // Blob URLs from the downloaded bytes (spec §5.4: authenticated media, never the URL itself).
  // One URL per Blob, kept while the board names it: another asset arriving does not reload the rest.
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const made = useRef(new Map<Blob, string>());
  // Layout effects: the URLs are there for the first paint, and made again after the cleanup below.
  useLayoutEffect(() => {
    const cache = made.current;
    const named = new Set(assets.map((a) => a.blob));
    for (const [blob, url] of cache) {
      if (named.has(blob)) continue;
      URL.revokeObjectURL(url);
      cache.delete(blob);
    }
    for (const a of assets) if (!cache.has(a.blob)) cache.set(a.blob, URL.createObjectURL(a.blob));
    setUrls(new Map(assets.map((a) => [a.mxc, cache.get(a.blob)!])));
  }, [assets]);
  useLayoutEffect(() => {
    const cache = made.current;
    return () => {
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, []);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setVp({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Comment mode starts with nothing selected: a click there picks, it does not select.
  useEffect(() => {
    if (commenting) select([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on entering comment mode only
  }, [commenting]);

  // Nodes as drawn: with a drag or a resize in progress applied.
  const nodes = useMemo(() => {
    if (!preview || preview.kind === "rect" || preview.kind === "connect") return board.nodes;
    return board.nodes.map((n) =>
      preview.kind === "move" && preview.ids.has(n.id)
        ? { ...n, x: n.x + preview.dx, y: n.y + preview.dy }
        : preview.kind === "resize" && preview.id === n.id
          ? { ...n, w: preview.w, h: preview.h }
          : n,
    );
  }, [board.nodes, preview]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  // Sections first: they are drawn under the rest.
  const ordered = useMemo(() => [...nodes.filter((n) => n.type === "section"), ...nodes.filter((n) => n.type !== "section")], [nodes]);

  const bounds = useMemo(() => boardBounds(board.nodes) ?? { x: 0, y: 0, w: 800, h: 600 }, [board.nodes]);
  const fit = vp.w && vp.h ? clampZoom(Math.min(1, (vp.w - 2 * FIT_PAD) / bounds.w, (vp.h - 2 * FIT_PAD) / bounds.h)) : 1;
  const scale = zoom ?? fit;
  const origin = pan ?? {
    x: (vp.w - bounds.w * scale) / 2 - bounds.x * scale,
    y: (vp.h - bounds.h * scale) / 2 - bounds.y * scale,
  };
  // The wheel listener is native (it must prevent the page's zoom): it reads the view from here.
  const live = useRef({ scale, origin, zoom });
  live.current = { scale, origin, zoom };

  const toBoard = (p: Point): Point => ({ x: (p.x - origin.x) / scale, y: (p.y - origin.y) / scale });
  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = viewport.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** A new zoom, keeping `at` (viewport px, default its center) where it is; null fits. */
  function zoomTo(next: number | null, at: Point = { x: vp.w / 2, y: vp.h / 2 }) {
    if (next === null) {
      setZoom(null);
      setPan(null);
      return;
    }
    const { scale: s, origin: o } = live.current;
    const k = next / s;
    const p = { x: at.x - (at.x - o.x) * k, y: at.y - (at.y - o.y) * k };
    live.current = { ...live.current, scale: next, origin: p, zoom: next };
    setPan(p);
    setZoom(next);
  }

  function panTo(p: Point) {
    // A fitted board keeps its scale once the user moves it.
    if (live.current.zoom === null) setZoom(live.current.scale);
    live.current = { ...live.current, origin: p, zoom: live.current.scale };
    setPan(p);
  }

  /** An edit keeps the view where it is: a fitted board would re-fit around what the edit moved. */
  const onEdit: typeof commit = (...edit) => {
    panTo(live.current.origin);
    commit(...edit);
  };

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { scale: s, origin: o } = live.current;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomTo(clampZoom(s * Math.exp(-e.deltaY * 0.01)), { x: e.clientX - r.left, y: e.clientY - r.top });
      } else panTo({ x: o.x - e.deltaX, y: o.y - e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the view from `live`
  }, []);

  // A node added, grouped or done with by Esc, or a labeled connection, gets focus once it is drawn (and not edited over).
  useEffect(() => {
    const sel = focusNext.current;
    const el = sel && !editing ? viewport.current?.querySelector<HTMLElement | SVGElement>(sel) : null;
    if (!el) return;
    focusNext.current = null;
    el.focus();
  }, [byId, board.edges, editing]);
  const focusNode = (id: string) => (focusNext.current = `[data-node-id="${id}"]`);

  const label = (ids: readonly string[]) => {
    const n = ids.length === 1 ? board.nodes.find((x) => x.id === ids[0]) : undefined;
    if (!n) return `${ids.length} nodes`;
    return n.text ? `${typeLabel(n).toLowerCase()} "${short(n.text.replace(/\s+/g, " "))}"` : `${typeLabel(n).toLowerCase()} ${n.id}`;
  };

  function add(tool: BoardTool | { type: "image" | "video"; mxc: string; size: { w: number; h: number } | null }) {
    const at = toBoard({ x: vp.w / 2, y: vp.h / 2 });
    let extra = {};
    if (tool.type === "shape") extra = { shape: tool.shape };
    else if (tool.type === "section") extra = { text: "Section" };
    else if (tool.type === "image" || tool.type === "video") {
      const k = tool.size ? Math.min(1, MAX_MEDIA / tool.size.w, MAX_MEDIA / tool.size.h) : 1;
      extra = { mxc: tool.mxc, ...(tool.size ? { w: Math.round(tool.size.w * k), h: Math.round(tool.size.h * k) } : {}) };
    }
    const node = newNode(board, tool.type, at, extra);
    onEdit((b) => addNode(b, node), `Added a ${typeLabel(node).toLowerCase()}`);
    select([node.id]);
    // Notes, text and shapes are typed into at once; the rest get focus.
    if (tool.type === "note" || tool.type === "text" || tool.type === "shape") setEditing({ id: node.id, text: "" });
    else focusNode(node.id);
  }
  // An upload ends renders later: it adds to the board and the view as they are then.
  const addLatest = useRef(add);
  addLatest.current = add;

  function remove() {
    const ids = selectedRef.current;
    if (ids.length > 0) {
      onEdit((b) => deleteNodes(b, ids), `Deleted ${label(ids)}`);
      select([]);
      viewport.current?.focus();
    } else if (edgeEnds) {
      onEdit((b) => deleteEdge(b, findEdge(b, edgeEnds)), "Deleted a connection");
      selectEdge(null);
      viewport.current?.focus();
    }
  }

  function group() {
    const ids = selectedRef.current;
    const id = nextId(board);
    onEdit((b) => groupIntoSection(b, ids, id), `Grouped ${label(ids)} into a section`);
    select([id]);
    focusNode(id);
  }

  /** A change to the selected connection. */
  function changeEdge(change: (b: Board, i: number) => Board, summary: string) {
    const ends = edgeEnds;
    if (ends) onEdit((b) => change(b, findEdge(b, ends)), summary);
  }

  function commitText() {
    if (!editing) return;
    const { id, text } = editing;
    setEditing(null);
    if (typeof id !== "string") {
      if ((board.edges[editingEdge]?.label ?? "") !== text.trim())
        onEdit((b) => setEdge(b, findEdge(b, id), { label: text }), "Edited a connection's label");
      return;
    }
    const n = board.nodes.find((x) => x.id === id);
    if (n && (n.text ?? "") !== text) onEdit((b) => setNodeText(b, id, text), `Edited the text of ${label([id])}`);
  }

  function startEditing(id: string) {
    if (mode === "view" || commenting) return;
    const n = board.nodes.find((x) => x.id === id);
    if (n) setEditing({ id, text: n.text ?? "" });
  }

  /** A connection's label is typed in place, as a node's text is. */
  function startLabel(i: number) {
    const e = board.edges[i];
    if (!edit || commenting || !e) return;
    selectEdge(e);
    setEditing({ id: { from: e.from, to: e.to }, text: e.label ?? "" });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (editing || (e.button !== 0 && e.button !== 1)) return;
    const target = e.target as Element;
    if (target.closest("[data-board-ignore]")) return;
    const p = local(e);
    const nodeEl = target.closest<HTMLElement>("[data-node-id]");
    const id = nodeEl?.dataset.nodeId;
    const touch = e.pointerType === "touch";
    if (space || e.button === 1) {
      gesture.current = { kind: "pan", start: p, origin };
      return;
    }
    if (comments) {
      if (id) comments.onPick({ node: id });
      gesture.current = area && !id ? { kind: "rect", start: p, area, add: false } : { kind: "pan", start: p, origin };
      return;
    }
    if (target.closest("[data-connect]") && edit && selectedRef.current.length === 1) {
      gesture.current = { kind: "connect", start: p, from: selectedRef.current[0]! };
      return;
    }
    if (target.closest("[data-resize]") && edit && selectedRef.current.length === 1) {
      const n = byId.get(selectedRef.current[0]!);
      if (n) gesture.current = { kind: "resize", start: p, id: n.id, w: n.w, h: n.h };
      return;
    }
    if (id) {
      // A selected video keeps the pointer for its controls (seek, volume); deselect it to drag it.
      if (target instanceof HTMLVideoElement && !e.shiftKey && selectedRef.current.includes(id)) return;
      let next = selectedRef.current;
      if (e.shiftKey) next = next.includes(id) ? next.filter((x) => x !== id) : [...next, id];
      else if (!next.includes(id)) next = [id];
      // A phone retypes with a tap on the selected node.
      else if (mode === "retype") startEditing(id);
      select(next);
      gesture.current =
        edit && !touch && next.includes(id)
          ? { kind: "move", start: p, ids: withMembers(board, next), moved: false }
          : { kind: "pan", start: p, origin };
      return;
    }
    if (area || (edit && !touch)) {
      if (!e.shiftKey) select([]);
      gesture.current = { kind: "rect", start: p, area, add: e.shiftKey };
      return;
    }
    select([]);
    gesture.current = { kind: "pan", start: p, origin };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g) return;
    // No button is down: the press ended where no pointerup reached the board (outside it, before it took the pointer).
    if (e.buttons === 0) {
      gesture.current = null;
      setPreview(null);
      return;
    }
    const p = local(e);
    const [dx, dy] = [p.x - g.start.x, p.y - g.start.y];
    if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP && !preview && g.kind !== "pan") return;
    if (!viewport.current?.hasPointerCapture(e.pointerId)) viewport.current?.setPointerCapture(e.pointerId);
    if (g.kind === "pan") panTo({ x: g.origin.x + dx, y: g.origin.y + dy });
    else if (g.kind === "move") {
      g.moved = true;
      setPreview({ kind: "move", ids: g.ids, dx: Math.round(dx / scale), dy: Math.round(dy / scale) });
    } else if (g.kind === "resize") setPreview({ kind: "resize", id: g.id, w: Math.max(8, Math.round(g.w + dx / scale)), h: Math.max(8, Math.round(g.h + dy / scale)) });
    else if (g.kind === "connect") setPreview({ kind: "connect", from: g.from, to: toBoard(p) });
    else {
      const a = toBoard(g.start);
      const b = toBoard(p);
      setPreview({ kind: "rect", box: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) } });
    }
  }

  function onPointerUp() {
    const g = gesture.current;
    gesture.current = null;
    const pv = preview;
    setPreview(null);
    if (!g || !pv) return;
    if (g.kind === "move" && pv.kind === "move" && (pv.dx || pv.dy)) {
      const ids = selectedRef.current;
      onEdit((b) => moveNodes(b, ids, pv.dx, pv.dy), `Moved ${label(ids)}`);
    } else if (g.kind === "resize" && pv.kind === "resize") {
      onEdit((b) => resizeNode(b, pv.id, pv.w, pv.h), `Resized ${label([pv.id])}`);
    } else if (g.kind === "connect" && pv.kind === "connect") {
      const to = nodeAt(board, pv.to, g.from);
      if (to) onEdit((b) => connect(b, g.from, to), `Connected ${label([g.from])} to ${label([to])}`);
    } else if (g.kind === "rect" && pv.kind === "rect") {
      const ids = nodesIn(board, pv.box);
      if (g.area) {
        setArea(false);
        onAskArea?.(ids);
      } else select(g.add ? [...new Set([...selectedRef.current, ...ids])] : ids);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (isEditableKeyboardTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey) {
      const z = ZOOM_KEYS[e.key];
      if (!z || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      zoomTo(z === "zoomFit" ? null : stepZoom(zoom ?? scale, z === "zoomIn" ? 1 : -1));
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      setSpace(true);
      return;
    }
    if (e.key === "Escape") {
      if (area) setArea(false);
      else select([]);
      return;
    }
    if (comments) {
      // Enter on a node or a connection opens its note box.
      if (e.key !== "Enter") return;
      const el = e.target as Element;
      const id = el.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
      const ed = board.edges[Number(el.closest("[data-edge-index]")?.getAttribute("data-edge-index") ?? -1)];
      if (id || ed) e.preventDefault();
      if (id) comments.onPick({ node: id });
      else if (ed) comments.onPick({ from: ed.from, to: ed.to });
      return;
    }
    const ids = selectedRef.current;
    if (e.key === "Enter" && ids.length === 1) {
      e.preventDefault();
      startEditing(ids[0]!);
      return;
    }
    if (e.key === "Enter" && edge !== null && edit) {
      e.preventDefault();
      startLabel(edge);
      return;
    }
    if (!edit) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove();
      return;
    }
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!arrow || ids.length === 0) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const [dx, dy] = [arrow[0]! * step, arrow[1]! * step];
    if (e.altKey && ids.length === 1) {
      const n = byId.get(ids[0]!);
      if (n) onEdit((b) => resizeNode(b, n.id, n.w + dx * 10, n.h + dy * 10), `Resized ${label(ids)}`, true);
    } else onEdit((b) => moveNodes(b, ids, dx, dy), `Moved ${label(ids)}`, true);
  }

  const one = selected.length === 1 ? byId.get(selected[0]!) : undefined;
  const editingNode = typeof editing?.id === "string" ? byId.get(editing.id) : undefined;
  const selectedEdge = edge !== null ? board.edges[edge] : undefined;
  // One arrowhead per stroke color: a marker takes no color from the line that uses it.
  const arrowId = (key: string) => `${uid}-arrow-${key}`;
  const lines = new Map(
    board.edges.flatMap((ed, i) => {
      const [a, b] = [byId.get(ed.from), byId.get(ed.to)];
      return a && b ? [[i, edgeLine(a, b)] as const] : [];
    }),
  );
  const mid = (i: number) => {
    const l = lines.get(i);
    return l ? { x: (l.p1.x + l.p2.x) / 2, y: (l.p1.y + l.p2.y) / 2 } : null;
  };
  const editingLabel = editingEdge < 0 ? null : mid(editingEdge);
  // The board changed under the local state (a refused add, an undo, a new version): what is
  // gone is no longer edited or selected. Else `editing` would block the pointer with no field to end it.
  const editingGone = editing !== null && !editingNode && !editingLabel;
  const selectionGone = selected.some((id) => !byId.has(id));
  useEffect(() => {
    if (editingGone) setEditing(null);
    if (selectionGone) select(selectedRef.current.filter((id) => byId.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the board of the render that found them gone
  }, [editingGone, selectionGone]);
  /** A comment target's box in the viewport's pixels; a connection's is its midpoint. */
  const screenBox = (t: BoardTarget): Box | null => {
    const n = "node" in t ? byId.get(t.node) : undefined;
    const m = "node" in t ? null : mid(findEdge(board, t));
    const box = n ?? (m ? { x: m.x - 4 / scale, y: m.y - 4 / scale, w: 8 / scale, h: 8 / scale } : null);
    return box && { x: origin.x + box.x * scale, y: origin.y + box.y * scale, w: box.w * scale, h: box.h * scale };
  };
  const draftBox = comments?.draft ? screenBox(comments.draft.target) : null;

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={viewport}
        role="region"
        aria-label="Whiteboard"
        tabIndex={-1}
        data-testid="whiteboard"
        className={cn(
          "relative size-full touch-none overflow-hidden bg-surface-background select-none focus:outline-none",
          space ? "cursor-grab" : area ? "cursor-crosshair" : undefined,
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => e.key === " " && setSpace(false)}
        onDoubleClick={(e) => {
          const el = e.target as Element;
          const id = el.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
          const i = el.closest("[data-edge-index]")?.getAttribute("data-edge-index");
          if (id) startEditing(id);
          else if (i != null) startLabel(Number(i));
        }}
      >
        {board.nodes.length === 0 ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-body2 text-text-secondary">
            {edit ? "This whiteboard is empty. Add a note from the toolbar." : "This whiteboard is empty."}
          </p>
        ) : null}
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ transform: `translate(${origin.x}px, ${origin.y}px) scale(${scale})` }}
          // One handler for every node, so a node's props stay the same while another is dragged.
          onFocus={(e) => {
            const id = (e.target as Element).closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
            // A press already chose the selection (Shift adds or removes); Tab selects the node.
            if (id && !commenting && !gesture.current && !selectedRef.current.includes(id)) select([id]);
          }}
        >
          {ordered.map((n) => (
            <BoardNodeView
              key={n.id}
              node={n}
              url={n.mxc ? urls.get(n.mxc) : undefined}
              selected={selected.includes(n.id)}
              hidden={editing?.id === n.id && n.type !== "image" && n.type !== "video"}
            />
          ))}
          {/* After the nodes, so connections follow them in the Tab order; drawn over sections, under the rest.
              ponytail: straight edges between box borders, no routing around other nodes. */}
          <svg className="pointer-events-none absolute top-0 left-0 z-[1] overflow-visible" width={1} height={1} aria-hidden={!edgesLive}>
            <defs>
              {(["default", "selected", ...BOARD_COLORS] as const).map((key) => (
                <marker
                  key={key}
                  id={arrowId(key)}
                  data-board-color={key === "default" || key === "selected" ? undefined : key}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path
                    d="M0,0 L10,5 L0,10 z"
                    className={key === "default" ? "fill-text-secondary" : key === "selected" ? "fill-accent-brand" : "fill-board-hue"}
                  />
                </marker>
              ))}
            </defs>
            {board.edges.map((ed, i) => {
              const line = lines.get(i);
              const [a, b] = [byId.get(ed.from), byId.get(ed.to)];
              if (!line || !a || !b) return null;
              const { p1, p2 } = line;
              const arrow = ed.arrow ?? "end";
              const style = ed.style ?? "solid";
              const on = edge === i && !commenting;
              const marker = `url(#${arrowId(on ? "selected" : (ed.color ?? "default"))})`;
              const name = `Connection from ${a.text ? short(a.text) : a.id} to ${b.text ? short(b.text) : b.id}${ed.label ? `: ${ed.label}` : ""}`;
              return (
                <g
                  key={i}
                  data-edge-index={i}
                  data-board-color={ed.color}
                  role={edgesLive ? "button" : undefined}
                  tabIndex={edgesLive ? 0 : undefined}
                  aria-label={edgesLive ? name : undefined}
                  aria-pressed={edit && !commenting ? on : undefined}
                  className="focus:outline-none [&:focus-visible>line:nth-child(2)]:stroke-accent-brand"
                  onPointerDown={(e) => {
                    if (!edgesLive || e.button !== 0 || space) return;
                    e.stopPropagation();
                    if (comments) comments.onPick({ from: ed.from, to: ed.to });
                    else {
                      select([]);
                      selectEdge(ed);
                    }
                  }}
                  onFocus={() => {
                    if (commenting) return;
                    selectedRef.current = [];
                    setSelectedState([]);
                    selectEdge(ed);
                  }}
                >
                  {/* A wide transparent stroke: what a click hits. */}
                  <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} strokeWidth={16 / scale} className="stroke-transparent" style={{ pointerEvents: edgesLive ? "stroke" : "none" }} />
                  <line
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    strokeWidth={2}
                    strokeDasharray={DASH[style]}
                    strokeLinecap={style === "dotted" ? "round" : undefined}
                    className={on ? "stroke-accent-brand" : ed.color ? "stroke-board-hue" : "stroke-text-secondary"}
                    markerEnd={arrow !== "none" ? marker : undefined}
                    markerStart={arrow === "both" ? marker : undefined}
                  />
                  {ed.label && editingEdge !== i ? (
                    <text
                      x={(p1.x + p2.x) / 2}
                      y={(p1.y + p2.y) / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      paintOrder="stroke"
                      strokeWidth={6}
                      // The hue is the line's only: the label stays primary text on the surface (AA in both themes).
                      className="fill-text-primary stroke-surface-background text-caption1"
                    >
                      {ed.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {preview?.kind === "connect" && byId.get(preview.from) ? (
              <line
                {...(({ x, y }) => ({ x1: x, y1: y }))(edgePoint(byId.get(preview.from)!, preview.to))}
                x2={preview.to.x}
                y2={preview.to.y}
                strokeWidth={2}
                strokeDasharray="6 4"
                className="stroke-accent-brand"
                markerEnd={`url(#${arrowId("selected")})`}
              />
            ) : null}
          </svg>
          {one && edit && !editing && !commenting ? (
            <>
              <div
                data-resize
                aria-hidden
                className="absolute z-[3] cursor-nwse-resize rounded-utility border-2 border-accent-brand bg-surface-primary"
                style={{ left: one.x + one.w - 6 / scale, top: one.y + one.h - 6 / scale, width: 12 / scale, height: 12 / scale }}
              />
              {/* Drag onto another node to connect the two; keyboard users have "Connect the two selected". */}
              <div
                data-connect
                aria-hidden
                data-testid="whiteboard-connect-handle"
                title="Drag to another node to connect"
                className="absolute z-[3] cursor-crosshair rounded-full border-2 border-accent-brand bg-surface-primary"
                style={{ left: one.x + one.w + 6 / scale, top: one.y + one.h / 2 - 7 / scale, width: 14 / scale, height: 14 / scale }}
              />
            </>
          ) : null}
          {preview?.kind === "rect" ? (
            <div
              aria-hidden
              className="absolute z-[3] border border-accent-brand bg-accent-brand-transparent"
              style={{ left: preview.box.x, top: preview.box.y, width: preview.box.w, height: preview.box.h }}
            />
          ) : null}
          {editing && (editingNode || editingLabel) ? (
            <textarea
              data-board-ignore
              aria-label={editingNode ? `Text of ${typeLabel(editingNode).toLowerCase()} ${editingNode.id}` : "Label of the connection"}
              data-board-color={editingNode && editingNode.type !== "text" ? (editingNode.color ?? DEFAULT_COLOR[editingNode.type]) : undefined}
              autoFocus
              maxLength={editingNode ? BOARD_LIMITS.text : BOARD_LIMITS.label}
              value={editing.text}
              onChange={(e) => setEditing({ id: editing.id, text: e.target.value })}
              onBlur={commitText}
              onKeyDown={(e) => {
                e.stopPropagation();
                // A label is one line: Enter ends it.
                if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey || !editingNode))) {
                  e.preventDefault();
                  focusNext.current =
                    typeof editing.id === "string" ? `[data-node-id="${editing.id}"]` : `[data-edge-index="${editingEdge}"]`;
                  commitText();
                }
              }}
              className={cn(
                "absolute z-[3] resize-none rounded-utility border-2 border-accent-brand p-3 text-body2 text-text-primary focus:outline-none",
                editingNode ? "bg-board-fill" : "bg-surface-primary",
              )}
              style={
                editingNode
                  ? {
                      left: editingNode.x,
                      top: editingNode.type === "image" || editingNode.type === "video" ? editingNode.y + editingNode.h + 8 : editingNode.y,
                      width: Math.max(editingNode.w, 160),
                      height: editingNode.type === "image" || editingNode.type === "video" ? 64 : Math.max(editingNode.h, 48),
                    }
                  : { left: editingLabel!.x - 100, top: editingLabel!.y - 24, width: 200, height: 48 }
              }
            />
          ) : null}
        </div>
        {area ? (
          <p className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-pill bg-surface-primary px-3 py-1 text-caption1 text-text-primary shadow-surface">
            Drag over the nodes to ask about. Esc cancels.
          </p>
        ) : null}
      </div>
      {comments ? (
        <FramePins
          comments={comments.markers.flatMap((m) => {
            const box = screenBox(m.target);
            return box ? [{ id: m.id, box, author: m.author, onSelect: m.onSelect }] : [];
          })}
          draft={comments.draft && draftBox ? { box: draftBox, form: comments.draft.form, onClose: comments.draft.onClose } : null}
        />
      ) : null}
      <div className="@container pointer-events-none absolute inset-x-2 bottom-2 z-10 flex justify-center [&>*]:pointer-events-auto">
        <WhiteboardToolbar
          selected={selected.length}
          edge={selectedEdge ?? null}
          canDelete={selected.length > 0 || edge !== null}
          onAdd={edit ? add : undefined}
          onUpload={edit && onUpload ? (kind) => {
            if (!fileInput.current) return;
            fileInput.current.accept = kind === "image" ? "image/*" : "video/*";
            fileInput.current.click();
          } : undefined}
          onColor={(color) => {
            const ids = selectedRef.current;
            if (ids.length === 0) changeEdge((b, i) => setEdge(b, i, { color }), "Changed a connection's color");
            else onEdit((b) => setNodeColor(b, ids, color), `Colored ${label(ids)} ${color ?? "default"}`);
          }}
          onEdge={(patch) =>
            changeEdge(
              (b, i) => setEdge(b, i, patch),
              patch.arrow ? "Changed a connection's arrowheads" : "Changed a connection's style",
            )
          }
          onReverse={() => changeEdge(reverseEdge, "Reversed a connection")}
          onLabel={() => edge !== null && startLabel(edge)}
          onConnect={() => {
            const [a, b] = selectedRef.current;
            if (a && b) onEdit((x) => connect(x, a, b), `Connected ${label([a])} to ${label([b])}`);
          }}
          onGroup={group}
          onDelete={remove}
          zoom={zoom}
          scale={scale}
          onZoom={zoomTo}
          onRequest={onRequest}
          onArea={onAskArea ? () => setArea(true) : undefined}
        />
        <input
          ref={fileInput}
          type="file"
          hidden
          data-testid="whiteboard-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file && onUpload) void onUpload(file).then((up) => up && addLatest.current({ type: up.kind, mxc: up.mxc, size: up.size }));
          }}
        />
      </div>
    </div>
  );
}

/** One node. Every string is a text node; media come only from blob URLs. Memoized: a drag redraws only what moves. */
const BoardNodeView = memo(function BoardNodeView({
  node: n,
  url,
  selected,
  hidden,
}: {
  node: BoardNode;
  url: string | undefined;
  selected: boolean;
  /** Its text is being edited over it. */
  hidden: boolean;
}) {
  const color = n.type === "text" ? undefined : (n.color ?? DEFAULT_COLOR[n.type]);
  const kind = typeLabel(n);
  return (
    <div
      data-node-id={n.id}
      data-board-color={color}
      role="group"
      tabIndex={0}
      aria-roledescription={kind.toLowerCase()}
      aria-label={`${n.text ? short(n.text) : `Empty ${kind.toLowerCase()}`}${selected ? ", selected" : ""}`}
      className={cn(
        "absolute text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-brand",
        selected && "ring-2 ring-accent-brand",
        hidden && "invisible",
        // Over the connections; a section stays under them.
        n.type !== "section" && "z-[2]",
        n.type === "note" && "overflow-hidden rounded-utility border border-board-hue bg-board-fill p-3 text-body2 whitespace-pre-wrap break-words shadow-button",
        n.type === "text" && "overflow-hidden text-body1 whitespace-pre-wrap break-words",
        n.type === "section" && "rounded-card border-2 border-dashed border-board-hue bg-board-fill/50",
        n.type === "shape" && "flex items-center justify-center p-3 text-center text-body2 break-words",
        (n.type === "image" || n.type === "video") && "overflow-hidden rounded-utility bg-surface-secondary",
      )}
      style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
    >
      {n.type === "shape" ? (
        <svg aria-hidden className="absolute inset-0 size-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
          {n.shape === "oval" ? (
            <ellipse cx="50" cy="50" rx="50" ry="50" vectorEffect="non-scaling-stroke" strokeWidth={2} className="fill-board-fill stroke-board-hue" />
          ) : n.shape === "diamond" ? (
            <polygon points="50,0 100,50 50,100 0,50" vectorEffect="non-scaling-stroke" strokeWidth={2} className="fill-board-fill stroke-board-hue" />
          ) : (
            <rect width="100" height="100" vectorEffect="non-scaling-stroke" strokeWidth={2} className="fill-board-fill stroke-board-hue" />
          )}
        </svg>
      ) : null}
      {n.type === "section" ? (
        <span className="block truncate px-3 py-2 font-heading text-subtitle font-semibold">{n.text}</span>
      ) : n.type === "image" ? (
        url ? (
          <img src={url} alt={n.text ?? ""} draggable={false} className="pointer-events-none size-full object-contain" />
        ) : (
          <MediaMissing kind="Image" />
        )
      ) : n.type === "video" ? (
        url ? (
          <video src={url} controls muted playsInline preload="metadata" aria-label={n.text || "Video"} className="size-full object-contain" />
        ) : (
          <MediaMissing kind="Video" />
        )
      ) : (
        <span className={cn(n.type === "shape" && "relative line-clamp-6")}>{n.text}</span>
      )}
    </div>
  );
});

function MediaMissing({ kind }: { kind: string }) {
  return (
    <span className="flex size-full items-center justify-center p-2 text-center text-caption1 text-text-secondary">
      {kind} not loaded
    </span>
  );
}
