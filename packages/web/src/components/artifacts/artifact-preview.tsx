import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { type FrameKey, type FrameView, readFrameKey } from "@/lib/artifacts/frames";
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
}: ArtifactPreviewProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const handlers = useRef({ onPicked, onError, onOpenLink, onKey });
  handlers.current = { onPicked, onError, onOpenLink, onKey };
  const annotatingRef = useRef(annotating);
  annotatingRef.current = annotating;
  const frameRef = useRef(frame);
  frameRef.current = frame;

  const post = (type: string, detail: unknown) =>
    ref.current?.contentWindow?.postMessage({ type, channel, detail }, "*");

  useImperativeHandle(handle, () => ({ style: (edit) => post(PreviewMessage.style, edit) }));

  useEffect(() => {
    post(PreviewMessage.pick, { on: annotating });
  }, [annotating]);

  useEffect(() => {
    if (frame) post(PreviewMessage.frame, frame);
  }, [frame?.index, frame?.zoom]);

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
      } else if (data.type === PreviewMessage.ready) {
        // From the kind, not the frame: the parent never fetches what agent code names.
        const needs = runtimesFor(kind);
        if (annotatingRef.current) post(PreviewMessage.pick, { on: true });
        // A new document starts at frame 0: show the one the panel has open.
        if (frameRef.current) post(PreviewMessage.frame, frameRef.current);
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
