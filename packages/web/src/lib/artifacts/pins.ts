import type { AgentFocusInfo } from "@/model/types";
import type { Box } from "./canvas";

/**
 * Pins: comment markers and the agent cursor (DESIGN_MODES_SPEC.md §6.6, §6.8). The app names
 * elements by selector, the frame only queries them and reports their boxes, and the app draws
 * the markers over the frame. No markup ever goes into the frame.
 */

const MAX_SELECTOR = 300;
export const MAX_PINS = 200;
const LIMIT = 100_000;

/** The agent cursor's pin id; comment pins are `<event id>:<index>`. */
export const CURSOR_PIN = "agent-cursor";
/** The pin id of the element being commented on: its note popover opens beside it. */
export const PICK_PIN = "comment-pick";
/** The pin id of the active slide or artboard while markups are drawn on it (spec §3.8 Draw). */
export const SKETCH_PIN = "sketch-frame";

export interface PinRequest {
  id: string;
  selector: string;
}

/** A selector from someone else (a message, an agent): one line, at most 300 characters; null otherwise. */
export function oneSelector(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s && s.length <= MAX_SELECTOR && !/[\r\n]/.test(s) ? s : null;
}

/** The boxes a frame reported (untrusted): only ids the app asked for, finite numbers, clamped. */
export function readPinBoxes(raw: unknown, ids: ReadonlySet<string>): Map<string, Box> {
  const out = new Map<string, Box>();
  const list = (raw as { boxes?: unknown } | null)?.boxes;
  if (!Array.isArray(list)) return out;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-LIMIT, Math.min(LIMIT, v)) : null);
  for (const b of list.slice(0, MAX_PINS)) {
    const o = (b ?? {}) as Record<string, unknown>;
    const [x, y, w, h] = [n(o.x), n(o.y), n(o.w), n(o.h)];
    if (typeof o.id !== "string" || !ids.has(o.id) || x === null || y === null || w === null || h === null) continue;
    out.set(o.id, { x, y, w: Math.max(0, w), h: Math.max(0, h) });
  }
  return out;
}

/** `GET /previews/focus` (untrusted: an agent wrote the selector): well-formed artifact focuses only. */
export function readAgentFocus(raw: unknown): AgentFocusInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f): AgentFocusInfo[] => {
    const o = (f ?? {}) as Record<string, unknown>;
    const selector = oneSelector(o.selector);
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    const [agent, room, thread, identifier] = [str(o.agent_id), str(o.room_id), str(o.thread_root), str(o.identifier)];
    if (!selector || !agent || !room || !thread || !identifier) return [];
    return [{ agent_id: agent, room_id: room, thread_root: thread, identifier: identifier.slice(0, 80), selector }];
  });
}
