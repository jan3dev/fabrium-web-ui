import { onePath, readTarget, type ArtifactRefTarget } from "@/lib/artifacts/refs";

// The parent side of the bridge script the gateway adds to every page of a preview
// (PREVIEWS_SPEC.md §5.3). The frame is the agent's app: everything it sends is untrusted.

/** A console entry is capped at 2 KB, and the drawer keeps the latest 50 (spec §3.4). */
const MAX_CONSOLE_ENTRY = 2048;
export const MAX_CONSOLE_ENTRIES = 50;

export type BridgeMessage =
  | { type: "location"; path: string }
  | { type: "console"; message: string }
  | { type: "picked"; path: string; target: Extract<ArtifactRefTarget, { kind: "element" }> };

export type BridgeCommand = "back" | "forward" | "reload" | "pick";

/** The page path of an href on the session origin, or null. */
export function pathOn(href: unknown, origin: string): string | null {
  if (typeof href !== "string") return null;
  try {
    const url = new URL(href);
    return url.origin === origin ? onePath(`${url.pathname}${url.search}${url.hash}`) : null;
  } catch {
    return null;
  }
}

/** A message from the bridge, or null. The caller checks `event.source` and `event.origin` first. */
export function readBridgeMessage(data: unknown, origin: string): BridgeMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.source !== "fabrium-preview") return null;
  if (d.type === "location") {
    const path = pathOn(d.href, origin);
    return path ? { type: "location", path } : null;
  }
  if (d.type === "console" && typeof d.message === "string" && d.message.trim()) {
    return { type: "console", message: d.message.slice(0, MAX_CONSOLE_ENTRY) };
  }
  if (d.type === "picked") {
    const path = pathOn(d.href, origin);
    const target = readTarget({ ...d, kind: "element" });
    return path && target?.kind === "element" ? { type: "picked", path, target } : null;
  }
  return null;
}

/** A page can log the same error in a loop: a repeat of the last entry is dropped. */
export function addConsoleEntry(entries: readonly string[], message: string): readonly string[] {
  return entries.at(-1) === message ? entries : [...entries, message].slice(-MAX_CONSOLE_ENTRIES);
}

export function postToBridge(
  frame: HTMLIFrameElement | null,
  origin: string,
  command: BridgeCommand,
  extra: Record<string, unknown> = {},
): void {
  frame?.contentWindow?.postMessage({ source: "fabrium-preview-parent", command, ...extra }, origin);
}

/**
 * Where a typed path goes: a URL on the session origin, never another site.
 * Null for anything that leaves the origin.
 */
export function frameUrl(input: string, origin: string): string | null {
  const raw = input.trim() || "/";
  try {
    const url = new URL(raw.startsWith("/") ? raw : `/${raw}`, origin);
    return url.origin === origin ? url.href : null;
  } catch {
    return null;
  }
}
