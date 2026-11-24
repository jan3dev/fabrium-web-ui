import type { ArtifactKind } from "@/model/types";

// Slides and design artifacts are one HTML document whose `body > section`s are frames
// (slides, artboards). The app reads them from the source parsed inert (DOMParser runs
// no scripts); the frame runtime in srcdoc.ts lays out the same sections by position.
// Sections a script adds at run time are not listed.

export type FrameKind = Extract<ArtifactKind, "slides" | "design">;

export function isFrameKind(kind: ArtifactKind): kind is FrameKind {
  return kind === "slides" || kind === "design";
}

export type FrameTransition = "none" | "fade" | "slide";

export interface FrameInfo {
  name: string;
  width: number;
  height: number;
  /** `<aside data-notes>` as plain text; "" when there are none. */
  notes: string;
  /** `data-skip`: left out of Present and the PDF. */
  skip: boolean;
  /** `data-transition` of the section, else of `body`: how Present enters the frame. */
  transition: FrameTransition;
}

/** The active frame; `zoom: null` fits it to the stage. */
export interface FrameView {
  index: number;
  zoom: number | null;
  transition?: FrameTransition;
  /** Presenting: notes for the builder (`aside[data-note]`) hide. */
  present?: boolean;
  /** Design: every artboard in a row (spec §6.3); `index` is centred. */
  canvas?: boolean;
}

export const MAX_FRAMES = 200;
/** Canvas bounds and defaults; the frame runtime in srcdoc.ts embeds the same values. */
export const FRAME_SIZE = { min: 100, max: 10000, slides: [1920, 1080], design: [1440, 900] } as const;
/** A frame's name and its speaker notes, read and written. */
export const MAX_NAME = 120;
export const MAX_NOTES = 5000;
export const TRANSITIONS: readonly FrameTransition[] = ["none", "fade", "slide"];

const size = (v: string | null, fallback: number) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? Math.min(FRAME_SIZE.max, Math.max(FRAME_SIZE.min, n)) : fallback;
};
/** The canvas size of a `body > section`: fixed for slides, `data-width`/`data-height` for design. */
export function frameSize(kind: FrameKind, el: Element): { width: number; height: number } {
  return kind === "slides"
    ? { width: FRAME_SIZE.slides[0], height: FRAME_SIZE.slides[1] }
    : {
        width: size(el.getAttribute("data-width"), FRAME_SIZE.design[0]),
        height: size(el.getAttribute("data-height"), FRAME_SIZE.design[1]),
      };
}
const transition = (v: string | null) => TRANSITIONS.find((t) => t === v?.trim().toLowerCase());
const text = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
/** Speaker notes as read back from the source: runs of spaces and blank lines collapsed. */
export const cleanNotes = (s: string) =>
  s.replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*/g, "\n\n").trim();

/** The frames of a slides or design source; agent markup, so every value is clamped. */
export function readFrames(kind: FrameKind, html: string): FrameInfo[] {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const slides = kind === "slides";
  const fallback = transition(body.getAttribute("data-transition")) ?? "none";
  const sections = [...body.children].filter((el) => el.localName === "section").slice(0, MAX_FRAMES);
  return sections.map((el, i) => {
    const notes = [...el.children].filter((c) => c.localName === "aside" && c.hasAttribute("data-notes"));
    const heading = [...el.querySelectorAll("h1,h2,h3,h4,h5,h6")].find((h) => !notes.some((n) => n.contains(h)));
    const name = text(el.getAttribute(slides ? "data-title" : "data-name") || heading?.textContent).slice(0, MAX_NAME);
    return {
      name: name || `${slides ? "Slide" : "Screen"} ${i + 1}`,
      ...frameSize(kind, el),
      notes: notes
        .map((n) => cleanNotes(n.textContent ?? ""))
        .filter(Boolean)
        .join("\n\n")
        .slice(0, MAX_NOTES),
      skip: el.hasAttribute("data-skip"),
      transition: transition(el.getAttribute("data-transition")) ?? fallback,
    };
  });
}

/** Cmd/Ctrl + key → zoom step, in the panel and forwarded by the frame. */
export const ZOOM_KEYS: Record<string, "zoomIn" | "zoomOut" | "zoomFit"> = {
  "=": "zoomIn",
  "+": "zoomIn",
  "-": "zoomOut",
  "0": "zoomFit",
};

/** Navigation keys the frame keeps from its document and forwards (Space is `" "` there). */
export const NAV_KEYS = ["ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "Space"] as const;
/** Present keys the frame forwards and still lets through, so a zoomed frame still scrolls. */
export const PASS_KEYS = ["ArrowUp", "ArrowDown", "Escape", "f", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
/** The keys the frame forwards while it has focus; the panel decides what they do. */
export const FRAME_KEYS = [...NAV_KEYS, ...PASS_KEYS, "zoomIn", "zoomOut", "zoomFit"] as const;
export type FrameKey = (typeof FRAME_KEYS)[number];

export function readFrameKey(raw: unknown): FrameKey | null {
  const key = (raw as { key?: unknown } | null)?.key;
  return FRAME_KEYS.find((k) => k === key) ?? null;
}

/**
 * The frame a key moves to from `index`, or null if the key does not move.
 * Presenting skips skipped frames and adds Up, Down and `1`–`9` (the nth presented frame).
 */
export function stepFrame(
  key: string,
  index: number,
  frames: readonly Pick<FrameInfo, "skip">[],
  present = false,
): number | null {
  const order = frames.flatMap((f, i) => (present && f.skip ? [] : [i]));
  if (order.length === 0) return null;
  const k = key === " " ? "Space" : key;
  const digit = /^[1-9]$/.test(k);
  if (!present && (digit || k === "ArrowUp" || k === "ArrowDown")) return null;
  switch (k) {
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
      return [...order].reverse().find((i) => i < index) ?? order[0]!;
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case "Space":
      return order.find((i) => i > index) ?? order[order.length - 1]!;
    case "Home":
      return order[0]!;
    case "End":
      return order[order.length - 1]!;
    default:
      return digit ? (order[Number(k) - 1] ?? null) : null;
  }
}

/** The zoom levels besides Fit; the zoom menu lists the same ones. */
export const ZOOMS = [0.5, 1, 2] as const;

/** One zoom step in or out of `zoom` (null fits): 50 %, 100 %, 200 %. */
export function stepZoom(zoom: number | null, dir: 1 | -1): number {
  const i = zoom === null ? -1 : ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]);
  if (i < 0) return dir > 0 ? 1 : 0.5;
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + dir))]!;
}

/** Panel ↔ presenter window, over a BroadcastChannel (same origin only). `go` asks the panel for a
 * slide; from the panel it says which slide is showing. The deck is sent on `hello` and when it changes. */
export const presenterChannel = (session: string) => `fabrium:presenter:${session}`;
export type PresenterMessage =
  | { type: "hello" }
  | { type: "go"; index: number }
  | { type: "deck"; title: string; text: string; index: number }
  | { type: "end" };
