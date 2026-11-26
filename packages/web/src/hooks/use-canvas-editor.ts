import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { findAssets } from "@/lib/artifacts/assets";
import {
  type Box,
  CanvasDoc,
  type CanvasSelection,
  type EditKey,
  editKeyOf,
  GESTURE_OPS,
  isCanvasKind,
  type KeyLike,
  type Op,
  readOp,
  type Template,
} from "@/lib/artifacts/canvas";
import { PreviewMessage } from "@/lib/artifacts/srcdoc";
import { flipScale, type Styles } from "@/lib/artifacts/styles";
import { copyToClipboard } from "@/lib/browser-actions";
import type { ArtifactKind } from "@/model/types";
import { uploadAsset } from "./use-artifact-assets";
import { useStyleDraft } from "./use-style-draft";

export type EditorMode = "off" | "inspect" | "style" | "full";

export type AlignAction =
  | "align-left"
  | "align-center"
  | "align-right"
  | "align-top"
  | "align-middle"
  | "align-bottom"
  | "distribute-h"
  | "distribute-v";
export type CanvasAction = EditKey | AlignAction | "select-all" | "select-none";

const TEMPLATE_LABEL: Record<Template, string> = {
  text: "Text box",
  rect: "Rectangle",
  rounded: "Rounded rectangle",
  oval: "Oval",
  diamond: "Diamond",
  line: "Line",
  arrow: "Arrow",
  table: "Table",
  note: "Note",
  image: "Image",
  video: "Video",
};

/** Where an insert goes and what it holds; all optional (the centre of the frame, the template's size). */
interface InsertOptions {
  rows?: number;
  cols?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  src?: string;
}

/** Properties panel open or closed, kept per user (spec §6.1). */
function useProperties(me: string): [boolean, (open: boolean) => void] {
  const key = `fabrium:artifact-properties:v1:${me}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const set = useCallback(
    (next: boolean) => {
      setOpen(next);
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Kept for this session only.
      }
    },
    [key],
  );
  return [open, set];
}

/**
 * The canvas editor's app side (spec §5.3): the inert, stamped copy of the source the frame
 * is built from, the frame's selection, and every canvas action as validated ops saved
 * through the draft (`apply`). A new document (another version, an undo, a frame edit from
 * the rail) is a new frame; ops keep the same document, so the frame is not reloaded.
 */
export function useCanvasEditor(o: {
  kind: ArtifactKind | undefined;
  text: string | null;
  /** The source shows in the frame: stamp it. */
  active: boolean;
  /** Ops are saved: the latest version, for a user with edit rights. */
  editable: boolean;
  frame: { index: number; unit: string; width: number; height: number };
  apply: (edit: (text: string) => string, summary: string, coalesce?: boolean) => boolean;
  /** The draft's undo and redo. */
  step: (from: "undo" | "redo") => boolean;
  post: (type: string, detail: unknown) => void;
  me: string;
}) {
  const docRef = useRef<CanvasDoc | null>(null);
  const [, rebuild] = useReducer((n: number) => n + 1, 0);
  const kind = o.kind && isCanvasKind(o.kind) ? o.kind : null;
  if (!o.active || !kind || o.text === null) docRef.current = null;
  else if (!docRef.current || docRef.current.kind !== kind || docRef.current.text !== o.text)
    docRef.current = new CanvasDoc(kind, o.text);
  const doc = docRef.current;

  const [selection, setSelection] = useState<CanvasSelection | null>(null);
  useEffect(() => setSelection(null), [doc]);
  // The doc is edited in place, so its text is part of the key.
  const docText = doc?.text;
  const ids = useMemo(
    () => (doc && selection ? selection.ids.filter((id) => doc.info(id) !== null) : []),
    [doc, docText, selection],
  );
  const [properties, setProperties] = useProperties(o.me);
  // After an await (upload, clipboard), the values of the render it lands in (the open frame may have changed).
  const latest = useRef({ o, insert, selection });
  latest.current = { o, insert, selection };

  const label = (list: readonly string[]) =>
    list.length === 1 ? (docRef.current?.name(list[0]!) ?? "a layer") : `${list.length} layers`;

  type Result = ReturnType<CanvasDoc["apply"]>;
  type Then = { select?: boolean; edit?: boolean; coalesce?: boolean };

  /** A change to the inert source, saved as one edit; the frame gets the patches. */
  function commit(produce: (d: CanvasDoc) => Result, summary: string, then: Then = {}): Result | null {
    const d = docRef.current;
    if (!d || !o.editable) return null;
    const out: { res?: Result } = {};
    const ok = o.apply(
      (t) => {
        // The panel's text moved on (an agent version arrived): the next render rebuilds.
        if (t !== d.text) return t;
        out.res = produce(d);
        return out.res.text;
      },
      summary,
      then.coalesce,
    );
    const res = out.res;
    if (!res) return null;
    if (ok) o.post(PreviewMessage.patch, { patches: res.patches, select: then.select && res.made.length ? res.made : undefined, edit: then.edit });
    // Refused (too large): the inert copy is ahead of the text, so start over from the text.
    else if (res.patches.length) {
      docRef.current = null;
      rebuild();
    }
    return res;
  }

  /** Validated ops onto the inert source. */
  function run(ops: Op[], summary: string, then?: Then) {
    if (ops.length) commit((d) => d.apply(ops), summary, then);
  }

  // The canvas saves each change as one style op; the draft only keeps the values.
  const styleDraft = useStyleDraft(() => {});
  const draft = {
    ...styleDraft,
    change(next: Styles) {
      styleDraft.change(next);
      style(next);
    },
  };

  function style(values: Styles) {
    const list = ids;
    if (list.length) run(list.map((id) => ({ kind: "style", id, values })), `Restyled ${label(list)}`, { coalesce: true });
  }

  function onSelection(next: CanvasSelection) {
    const same = selection && next.ids.join() === selection.ids.join();
    if (same) draft.refresh(next.styles);
    else draft.picked(next.styles);
    setSelection(next);
  }

  /** Gestures from the frame; anything else a frame sends is dropped. */
  function onOps(raw: unknown) {
    const list = Array.isArray((raw as { ops?: unknown })?.ops) ? ((raw as { ops: unknown[] }).ops) : [];
    const ops = list.slice(0, 200).map(readOp).filter((op): op is Op => op !== null && GESTURE_OPS.includes(op.kind));
    if (ops.length === 0) return;
    const first = ops[0]!;
    const targets = ops.flatMap((op) => ("id" in op ? [op.id] : []));
    const verb = first.kind === "resize" ? "Resized" : first.kind === "text" ? "Edited the text of" : "Moved";
    // Text arrives as it is typed: one undo step per retype.
    run(ops, `${verb} ${label(targets)}`, { coalesce: first.kind === "text" });
  }

  function insert(template: Template, options?: InsertOptions) {
    const parent = docRef.current?.frameId(o.frame.index);
    if (!parent) return;
    run(
      [{ kind: "insert", parent, template, ...options }],
      `Added ${/^[aeiou]/i.test(TEMPLATE_LABEL[template]) ? "an" : "a"} ${TEMPLATE_LABEL[template].toLowerCase()} to ${o.frame.unit} ${o.frame.index + 1}`,
      { select: true, edit: template === "text" || template === "note" },
    );
  }

  /**
   * Align and distribute by where the layers show on the frame (`view`), for free and flow
   * layers alike; each layer then moves by the difference (`pos`: left/top or its offset).
   * One layer aligns to the frame, several to their joint bounds.
   */
  function align(action: AlignAction) {
    const items = (selection?.items ?? []).filter((it) => ids.includes(it.id));
    if (items.length === 0) return;
    const v = items.map((i) => i.view);
    const bounds: Box =
      items.length === 1
        ? { x: 0, y: 0, w: o.frame.width, h: o.frame.height }
        : (() => {
            const x = Math.min(...v.map((b) => b.x));
            const y = Math.min(...v.map((b) => b.y));
            return { x, y, w: Math.max(...v.map((b) => b.x + b.w)) - x, h: Math.max(...v.map((b) => b.y + b.h)) - y };
          })();
    // Where each layer's box should go, on the frame.
    let targets: { x: number; y: number }[];
    if (action === "distribute-h" || action === "distribute-v") {
      if (items.length < 3) return;
      const h = action === "distribute-h";
      const order = v.map((_, i) => i).sort((a, b) => (h ? v[a]!.x - v[b]!.x : v[a]!.y - v[b]!.y));
      const total = v.reduce((s, b) => s + (h ? b.w : b.h), 0);
      const gap = ((h ? bounds.w : bounds.h) - total) / (items.length - 1);
      targets = v.map((b) => ({ x: b.x, y: b.y }));
      let at = h ? bounds.x : bounds.y;
      for (const i of order) {
        const b = v[i]!;
        targets[i] = h ? { x: at, y: b.y } : { x: b.x, y: at };
        at += (h ? b.w : b.h) + gap;
      }
    } else {
      targets = v.map((b) => {
        switch (action) {
          case "align-left":
            return { x: bounds.x, y: b.y };
          case "align-center":
            return { x: bounds.x + (bounds.w - b.w) / 2, y: b.y };
          case "align-right":
            return { x: bounds.x + bounds.w - b.w, y: b.y };
          case "align-top":
            return { x: b.x, y: bounds.y };
          case "align-middle":
            return { x: b.x, y: bounds.y + (bounds.h - b.h) / 2 };
          default:
            return { x: b.x, y: bounds.y + bounds.h - b.h };
        }
      });
    }
    const ops: Op[] = [];
    items.forEach((it, i) => {
      const dx = Math.round(targets[i]!.x - it.view.x);
      const dy = Math.round(targets[i]!.y - it.view.y);
      if (dx || dy) ops.push({ kind: "move", id: it.id, x: it.pos.x + dx, y: it.pos.y + dy });
    });
    if (ops.length) run(ops, `Aligned ${label(items.map((i) => i.id))}`);
  }

  /**
   * An image or video file as a layer (spec §5.4, §6.4): uploaded through authenticated media,
   * named by its mxc:// URI, centred on `at` (the frame's viewport px) or on the frame.
   */
  async function addFile(file: File, at?: { x: number; y: number }) {
    const d = docRef.current;
    if (!d || !o.editable) return;
    const up = await uploadAsset(file, findAssets(d.text).size);
    if (!up) return;
    const { mxc: src, kind } = up;
    const { frame } = latest.current.o;
    const base = up.size ?? { w: 640, h: 360 };
    const k = Math.min(1, (frame.width * 0.6) / base.w, (frame.height * 0.6) / base.h);
    const [w, h] = [Math.max(1, Math.round(base.w * k)), Math.max(1, Math.round(base.h * k))];
    const origin = latest.current.selection?.origin;
    const place =
      at && origin
        ? {
            x: Math.round(Math.min(Math.max(0, (at.x - origin.x) / origin.s - w / 2), Math.max(0, frame.width - w))),
            y: Math.round(Math.min(Math.max(0, (at.y - origin.y) / origin.s - h / 2), Math.max(0, frame.height - h))),
          }
        : {};
    latest.current.insert(kind, { src, w, h, ...place });
  }

  async function paste() {
    const d = docRef.current;
    if (!d || !o.editable) return;
    let clip: string;
    try {
      clip = await navigator.clipboard.readText();
    } catch {
      toast.error("Could not read the clipboard");
      return;
    }
    const { frame } = latest.current.o;
    const after = ids.at(-1) ?? null;
    const res = commit((doc) => doc.paste(clip, frame.index, after), `Pasted into ${frame.unit} ${frame.index + 1}`, { select: true });
    if (res && !res.made.length) toast.error("The clipboard holds no layers");
  }

  function action(a: CanvasAction) {
    const d = docRef.current;
    if (!d) return;
    const list = ids;
    const many = (op: (id: string) => Op | null, verb: string, then?: { select?: boolean }) => {
      const ops = list.map(op).filter((x): x is Op => x !== null);
      if (ops.length) run(ops, `${verb} ${label(list)}`, then);
    };
    switch (a) {
      case "properties":
        return setProperties(!properties);
      case "undo":
      case "redo":
        return void o.step(a);
      case "select-all":
        return o.post(PreviewMessage.select, {
          ids: d.layers(o.frame.index).filter((l) => l.depth === 0 && !l.locked).map((l) => l.id),
        });
      case "select-none":
        return o.post(PreviewMessage.select, { ids: [] });
      case "copy":
      case "cut":
        if (!list.length) return;
        copyToClipboard(d.markup(list), a === "cut" ? "Cut" : "Copied");
        if (a === "cut") many((id) => ({ kind: "delete", id }), "Cut");
        return;
      case "paste":
        return void paste();
      case "delete":
        return many((id) => ({ kind: "delete", id }), "Deleted");
      case "duplicate":
        return many((id) => ({ kind: "duplicate", id }), "Duplicated", { select: true });
      case "group":
        if (list.length) run([{ kind: "group", ids: list }], `Grouped ${label(list)}`, { select: true });
        return;
      case "ungroup":
        return many((id) => ({ kind: "ungroup", id }), "Ungrouped", { select: true });
      case "front":
        return many((id) => ({ kind: "reorder", id, before: null }), "Brought to front");
      case "back":
        return many((id) => {
          const first = d.siblings(id)[0];
          return first && first !== id ? { kind: "reorder", id, before: first } : null;
        }, "Sent to back");
      case "flipH":
      case "flipV":
        return many(
          (id) => ({ kind: "style", id, values: { scale: flipScale(selection?.styles.scale, a === "flipH" ? "h" : "v") } }),
          "Flipped",
        );
      default:
        if (a.startsWith("insert:")) return insert(a.slice(7) as Template);
        return align(a as AlignAction);
    }
  }

  /** A key from the frame or the stage; true when it was a canvas key. */
  function onKey(e: KeyLike): boolean {
    const k = editKeyOf(e);
    if (!k) return false;
    action(k);
    return true;
  }

  const info = ids[0] ? doc?.info(ids[0]) : null;
  const primary = ids[0] ? selection?.items.find((i) => i.id === ids[0]) : undefined;
  return {
    doc,
    selection: selection && { ...selection, ids },
    /** The first selected layer: its name, kind and box. */
    primary: primary && info ? { ...primary, ...info, name: doc?.name(primary.id) ?? "" } : null,
    draft,
    properties,
    setProperties,
    onSelection,
    onOps,
    onKey,
    action,
    insert,
    addFile,
    /** Position and size from the Properties panel; free layers move, others only resize. */
    setBox(box: Box) {
      if (!primary) return;
      run([{ kind: "resize", id: primary.id, ...box }], `Resized ${label([primary.id])}`, { coalesce: true });
    },
    /** The open frame's own style (its background) or transition. */
    frameStyle(values: Styles) {
      const id = docRef.current?.frameId(o.frame.index);
      if (id) run([{ kind: "style", id, values }], `Restyled ${o.frame.unit} ${o.frame.index + 1}`, { coalesce: true });
    },
    frameTransition(value: string) {
      const id = docRef.current?.frameId(o.frame.index);
      if (id)
        run(
          [{ kind: "attr", id, name: "data-transition", value }],
          `Set the transition of ${o.frame.unit} ${o.frame.index + 1}`,
        );
    },
    select(list: string[]) {
      o.post(PreviewMessage.select, { ids: list });
    },
  };
}
