import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { listPreviews } from "@/client/fabrium-api";
import { isPreviewsEnabled } from "@/client/feature-flags";
import type { PreviewEvent, PreviewInfo } from "@/model/types";
import { withPanel } from "./use-artifacts";
import { useThreadEntries } from "./use-timeline-entries";

export interface PreviewRef {
  agentId: string;
  name: string;
}

/** `?preview=<agent ID>/<name>`; a name never holds `/`, so the last one splits. */
export function parsePreviewParam(value: string | null): PreviewRef | null {
  const at = value?.lastIndexOf("/") ?? -1;
  if (!value || at < 1 || at === value.length - 1) return null;
  return { agentId: value.slice(0, at), name: value.slice(at + 1) };
}

/** The open preview lives in the URL beside `?thread=`, like an artifact; one of the two at a time. */
export function usePreviewRoute() {
  const [params, setParams] = useSearchParams();
  const open = useCallback(
    (ref: PreviewRef, threadId?: string | null) =>
      setParams((prev) => withPanel(prev, threadId, { preview: `${ref.agentId}/${ref.name}` })),
    [setParams],
  );
  const close = useCallback(
    () =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("preview");
        return next;
      }),
    [setParams],
  );
  return { current: parsePreviewParam(params.get("preview")), open, close };
}

/** The latest event of each preview in a thread: the newest start or stop wins. */
export function foldPreviews(events: readonly PreviewEvent[]): PreviewEvent[] {
  const latest = new Map<string, PreviewEvent>();
  for (const ev of events) {
    const key = `${ev.author.id}/${ev.name}`;
    const seen = latest.get(key);
    if (!seen || ev.createdAt >= seen.createdAt) latest.set(key, ev);
  }
  return [...latest.values()];
}

export function useThreadPreviews(
  roomId: string,
  threadRootId: string,
  workforceSpaceId: string | null,
): PreviewEvent[] {
  const { replies } = useThreadEntries(roomId, threadRootId, workforceSpaceId);
  return useMemo(
    () =>
      foldPreviews(
        replies
          .filter((m) => m.kind === "preview")
          .map((m) => m.raw as PreviewEvent),
      ),
    [replies],
  );
}

/** How often the room header asks which previews run; the open panel polls its own preview faster. */
const ROOM_POLL_MS = 10_000;

/** The mounted room polls. */
const roomPolls = new Set<() => void>();
/** A preview changed status (the open panel saw it): the room header asks now, not at its next poll. */
export const refreshRoomPreviews = () => roomPolls.forEach((poll) => poll());

/** The room's previews that are running or starting, for the room header. Empty when previews are off. */
export function useRoomPreviews(roomId: string): PreviewInfo[] {
  const [state, setState] = useState<{ roomId: string; list: PreviewInfo[] }>({ roomId: "", list: [] });
  useEffect(() => {
    if (!roomId || !isPreviewsEnabled()) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A refresh can start a poll while one is in flight: only the newest sets state and the next timer.
    let run = 0;
    const poll = async () => {
      const mine = ++run;
      clearTimeout(timer);
      try {
        const all = await listPreviews(roomId);
        if (!live || mine !== run) return;
        const list = all.filter((p) => p.status === "running" || p.status === "starting");
        setState((s) =>
          s.roomId === roomId && JSON.stringify(s.list) === JSON.stringify(list) ? s : { roomId, list },
        );
      } catch {
        // Off on this server, or not reachable: the button stays hidden.
      }
      if (live && mine === run) timer = setTimeout(() => void poll(), ROOM_POLL_MS);
    };
    const now = () => void poll();
    roomPolls.add(now);
    now();
    return () => {
      live = false;
      clearTimeout(timer);
      roomPolls.delete(now);
    };
  }, [roomId]);
  return state.roomId === roomId ? state.list : [];
}
