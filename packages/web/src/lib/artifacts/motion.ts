import { MAX_FRAMES, MAX_NAME } from "./frames";

/**
 * Motion (spec §6.11): one HTML document, one `body > section` per scene with `data-duration`
 * in ms, animated with CSS animations or the Web Animations API only. The app reads the scenes
 * from the source parsed inert (never from the frame) and owns the clock; the frame runtime
 * (srcdoc.ts `motionRuntime`) holds every animation at the time the app sends.
 */

export const DURATION = { min: 100, max: 600_000, fallback: 3000 } as const;

export interface Scene {
  name: string;
  /** ms, clamped to `DURATION`. */
  duration: number;
}

/** A scene's duration from `data-duration` or a number: clamped; missing or invalid is 3 s. */
export function clampDuration(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.round(Math.min(DURATION.max, Math.max(DURATION.min, n))) : DURATION.fallback;
}

const text = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** The scenes of a motion source; agent markup, so every value is clamped. */
export function readScenes(html: string): Scene[] {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  return [...body.children]
    .filter((el) => el.localName === "section")
    .slice(0, MAX_FRAMES)
    .map((el, i) => ({
      name: text(el.getAttribute("data-name") || el.querySelector("h1,h2,h3,h4,h5,h6")?.textContent).slice(0, MAX_NAME) || `Scene ${i + 1}`,
      duration: clampDuration(el.getAttribute("data-duration")),
    }));
}

/** Where scene `i` starts on the global clock, in ms. */
export const sceneStart = (scenes: readonly Scene[], i: number) =>
  scenes.slice(0, i).reduce((sum, s) => sum + s.duration, 0);

export const totalDuration = (scenes: readonly Scene[]) => sceneStart(scenes, scenes.length);

/** Global time `t` → the scene it falls in and the time inside it; the end of the last scene stays on it. */
export function sceneAt(scenes: readonly Scene[], t: number): { index: number; time: number } {
  let start = 0;
  for (let i = 0; i < scenes.length; i++) {
    const d = scenes[i]!.duration;
    if (t < start + d || i === scenes.length - 1) return { index: i, time: Math.min(d, Math.max(0, t - start)) };
    start += d;
  }
  return { index: 0, time: 0 };
}

/** `m:ss.s`, as the transport shows it. */
export function formatTime(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}
