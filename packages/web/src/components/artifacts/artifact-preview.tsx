import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { FrameAsset } from "@/hooks/use-artifact-assets";
import type { EditorMode } from "@/hooks/use-canvas-editor";
import { type Box, type CanvasSelection, gestureGate, type KeyLike, readEditKey, readSelection } from "@/lib/artifacts/canvas";
import { type FrameKey, type FrameView, readFrameKey } from "@/lib/artifacts/frames";
import { type PinRequest, readPinBoxes } from "@/lib/artifacts/pins";
import { readTarget, type ArtifactRefTarget } from "@/lib/artifacts/refs";
import { readStyles, type StyleEdit, type Styles } from "@/lib/artifacts/styles";
import { loadRuntimes } from "@/lib/artifacts/runtime";
import {
  PREVIEW_SANDBOX,
  PRINT_SANDBOX,
  PreviewMessage,
  runtimesFor,
} from "@/lib/artifacts/srcdoc";
import type { ArtifactKind } from "@/model/types";

export interface ArtifactPreviewHandle {
  style: (edit: StyleEdit) => void;
  /** Any parent → frame message (the canvas editor's `patch` and `select`). */
  post: (type: string, detail: unknown) => void;
}

/** The canvas editor in the frame (spec §6.4): its mode and what it reports. */
export interface PreviewEditor {
  mode: EditorMode;
  onSelection: (selection: CanvasSelection) => void;
  /** Ops as the frame sent them: the caller validates (canvas.ts `readOp`). */
  onOps: (raw: unknown) => void;
  onKey: (key: KeyLike) => void;
}

export interface ArtifactPreviewProps {
  kind: ArtifactKind;
  srcdoc: string;
  /** Baked into `srcdoc`; every inbound message must carry it. */
  channel: string;
  title: string;
  /** Pick mode: the frame reports the clicked element instead of acting on it. */
  annotating: boolean;
  onPicked: (target: Extract<ArtifactRefTarget, { kind: "element" }>, styles: Styles) => void;
  handle?: Ref<ArtifactPreviewHandle>;
  onError: (detail: unknown) => void;
  /** Only ever an http(s) URL. */
  onOpenLink: (href: string) => void;
  /** Slides and design: the frame to show, sent again whenever the document loads. */
  frame?: FrameView;
  /** A key from `FRAME_KEYS` pressed while focus is inside the frame. */
  onKey?: (key: FrameKey) => void;
  /** Slides and design: the scale the open frame is drawn at, as the frame reports it. */
  onScale?: (scale: number) => void;
  /** Cmd/Ctrl+wheel or a pinch over the frame: zoom by this factor. */
  onZoom?: (factor: number) => void;
  editor?: PreviewEditor;
  /** Downloaded assets the document names (spec §5.4); each is posted once per document. */
  assets?: readonly FrameAsset[];
  /** Files are dragged over the frame: the caller shows its own drop target over it. */
  onDragFiles?: () => void;
  /** Elements to follow (pins.ts): comment markers and the agent cursor. Their boxes go to `onPinned`. */
  pins?: readonly PinRequest[];
  /** The followed elements' boxes in the frame's viewport, which the caller's stage matches. */
  onPinned?: (boxes: Map<string, Box>) => void;
  /** Tweak values to apply (tweaks.ts `tweakMessage`), sent again whenever the document loads. */
  tweaks?: { vars: Record<string, string>; texts: Record<string, string> } | null;
}

/** The URL if it is http(s), else null: the frame is untrusted, so the parent checks too. */
function httpUrl(href: unknown): string | null {
  if (typeof href !== "string") return null;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * The sandboxed frame. The caller keys it by version, so a new document is a
 * new frame. Messages are accepted only from this frame's window on this
 * channel, and their contents are treated as untrusted.
 */
export function ArtifactPreview({
  kind,
  pins,
  onPinned,
  srcdoc,
  channel,
  title,
  annotating,
  onPicked,
  handle,
  onError,
  onOpenLink,
  frame,
  onKey,
  onScale,
  onZoom,
  editor,
  assets,
  onDragFiles,
  tweaks,
}: ArtifactPreviewProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const handlers = useRef({ onPicked, onError, onOpenLink, onKey, onScale, onZoom, editor, onDragFiles, onPinned });
  handlers.current = { onPicked, onError, onOpenLink, onKey, onScale, onZoom, editor, onDragFiles, onPinned };
  const gate = useRef(gestureGate());
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  // The URIs this document already has: a new document (`ready`) starts empty.
  const posted = useRef(new Set<string>());
  const mode = editor?.mode ?? "off";
  const annotatingRef = useRef(annotating);
  annotatingRef.current = annotating;
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const tweaksRef = useRef(tweaks);
  tweaksRef.current = tweaks;

  const post = (type: string, detail: unknown) =>
    ref.current?.contentWindow?.postMessage({ type, channel, detail }, "*");

  const pinsKey = JSON.stringify(pins ?? []);
  const pinsRef = useRef(pins ?? []);
  pinsRef.current = pins ?? [];
  useEffect(() => {
    post(PreviewMessage.pins, { pins: pinsRef.current });
  }, [pinsKey]);

  useImperativeHandle(handle, () => ({ style: (edit) => post(PreviewMessage.style, edit), post }));

  function postAssets() {
    const fresh = (assetsRef.current ?? []).filter((a) => !posted.current.has(a.mxc));
    if (fresh.length === 0) return;
    for (const a of fresh) posted.current.add(a.mxc);
    post(PreviewMessage.assets, { assets: fresh });
  }
  useEffect(postAssets, [assets]);

  useEffect(() => {
    post(PreviewMessage.editor, { mode });
  }, [mode]);

  useEffect(() => {
    post(PreviewMessage.pick, { on: annotating });
  }, [annotating]);

  useEffect(() => {
    if (tweaks) post(PreviewMessage.tweak, tweaks);
  }, [tweaks]);

  useEffect(() => {
    if (frame) post(PreviewMessage.frame, frame);
  }, [frame?.index, frame?.zoom, frame?.present, frame?.canvas]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!ref.current || event.source !== ref.current.contentWindow) return;
      const data = event.data as {
        type?: unknown;
        channel?: unknown;
        detail?: unknown;
      } | null;
      if (!data || typeof data !== "object" || data.channel !== channel) return;
      const detail = (data.detail ?? {}) as Record<string, unknown>;
      // Every message renews the grace after a real activation; only ops and keys need it.
      const userActive = gate.current(navigator.userActivation?.isActive === true, Date.now());
      if (data.type === PreviewMessage.error) {
        handlers.current.onError(detail);
      } else if (data.type === PreviewMessage.openLink) {
        // A link opens only from a real click, never from a script on load.
        const href = httpUrl(detail.href);
        if (navigator.userActivation?.isActive && href)
          handlers.current.onOpenLink(href);
      } else if (data.type === PreviewMessage.picked) {
        if (!annotatingRef.current) return;
        const target = readTarget({ ...detail, kind: "element" });
        if (target?.kind === "element") handlers.current.onPicked(target, readStyles(detail.styles));
      } else if (data.type === PreviewMessage.key) {
        const key = readFrameKey(detail);
        if (key) handlers.current.onKey?.(key);
      } else if (data.type === PreviewMessage.scale || data.type === PreviewMessage.zoom) {
        const scale = data.type === PreviewMessage.scale;
        const n = scale ? detail.scale : detail.factor;
        if (typeof n === "number" && Number.isFinite(n) && n > 0) handlers.current[scale ? "onScale" : "onZoom"]?.(n);
      } else if (data.type === PreviewMessage.selection) {
        const sel = readSelection(detail);
        if (sel && handlers.current.editor?.mode !== "off") handlers.current.editor?.onSelection(sel);
      } else if (data.type === PreviewMessage.op) {
        // Gestures only, and only while the user is active (`gestureGate`): a script in the
        // frame cannot make an edit that saves as the user's.
        if (handlers.current.editor?.mode !== "off" && userActive) handlers.current.editor?.onOps(detail);
      } else if (data.type === PreviewMessage.editKey) {
        // Delete, cut and paste (which reads the clipboard) included: the same gate.
        const key = readEditKey(detail);
        if (key && handlers.current.editor?.mode !== "off" && userActive) handlers.current.editor?.onKey(key);
      } else if (data.type === PreviewMessage.pinned) {
        handlers.current.onPinned?.(readPinBoxes(detail, new Set(pinsRef.current.map((p) => p.id))));
      } else if (data.type === PreviewMessage.drag) {
        handlers.current.onDragFiles?.();
      } else if (data.type === PreviewMessage.ready) {
        // From the kind, not the frame: the parent never fetches what agent code names.
        const needs = runtimesFor(kind);
        if (annotatingRef.current) post(PreviewMessage.pick, { on: true });
        // A new document starts at frame 0: show the one the panel has open.
        if (frameRef.current) post(PreviewMessage.frame, frameRef.current);
        if (tweaksRef.current) post(PreviewMessage.tweak, tweaksRef.current);
        post(PreviewMessage.editor, { mode: handlers.current.editor?.mode ?? "off" });
        posted.current = new Set();
        if (pinsRef.current.length) post(PreviewMessage.pins, { pins: pinsRef.current });
        postAssets();
        if (needs.length === 0) return;
        loadRuntimes(needs).then(
          (modules) => post(PreviewMessage.runtime, { modules }),
          (err: unknown) =>
            handlers.current.onError({
              message: err instanceof Error ? err.message : String(err),
            }),
        );
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [channel, kind]);

  return (
    <iframe
      ref={ref}
      title={title}
      data-testid="artifact-preview"
      className="h-full w-full border-0"
      sandbox={PREVIEW_SANDBOX}
      referrerPolicy="no-referrer"
      srcDoc={srcdoc}
    />
  );
}

/**
 * The PDF export: an invisible frame with the print document (`buildArtifactSrcdoc(…, true)`)
 * that opens the print dialog itself. The only frame with `allow-modals`; `onDone` once the
 * dialog closes, so the caller unmounts it.
 */
export function PrintFrame({ srcdoc, channel, onDone }: { srcdoc: string; channel: string; onDone: () => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: unknown; channel?: unknown } | null;
      if (ref.current && event.source === ref.current.contentWindow && data?.channel === channel && data.type === PreviewMessage.printed)
        done.current();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [channel]);
  return (
    <iframe
      ref={ref}
      title="PDF export"
      aria-hidden
      tabIndex={-1}
      className="pointer-events-none fixed top-0 left-0 size-px border-0 opacity-0"
      sandbox={PRINT_SANDBOX}
      referrerPolicy="no-referrer"
      srcDoc={srcdoc}
    />
  );
}
