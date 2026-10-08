import { useEffect, useMemo, useReducer } from "react";
import { MatrixClientPeg } from "../client/peg";
import type { AgentTurn } from "../model/agent-activity";
import {
  toOpenTurns,
  toTimelineEntries,
  toTimelineMessages,
} from "../model/from-matrix";
import type { TimelineEntry, TimelineMessage } from "../model/types";
import { allRoomEvents, makeSubscribe, useThread, useTimeline } from "./use-timeline";
import { useWorkforce } from "./use-workforce";

/**
 * Bumps on every change to the room's loaded events. useTimeline's snapshot
 * leaves out edits, so it alone would miss an edit landing.
 */
function useRoomVersion(roomId: string): number {
  const [version, bump] = useReducer((v: number) => v + 1, 0);
  useEffect(() => makeSubscribe(roomId)(bump), [roomId]);
  return version;
}

function gapEntry(before: TimelineMessage): TimelineEntry {
  return {
    message: {
      ...before,
      id: `gap:${before.id}`,
      kind: "gap",
      body: "",
      formattedBody: undefined,
      reactions: [],
      media: undefined,
      quote: undefined,
      // The event the hole ends at: what useFillGap paginates back from.
      raw: before.id,
    },
    thread: null,
  };
}

export interface TimelineEntriesState {
  /** Top-level timeline, gap markers included. */
  entries: TimelineEntry[];
  /** Thread roots still being fetched; render a placeholder for each. */
  pendingRootIds: string[];
}

// ponytail: remaps the whole room on each change (a few ms at 5k events); keep
// unchanged entries' identity if row re-renders ever show up in a profile.
export function useTimelineEntries(
  roomId: string,
  workforceSpaceId: string | null,
): TimelineEntriesState {
  const { events, pendingRootIds, gapBeforeEventIds } = useTimeline(roomId);
  const roster = useWorkforce(workforceSpaceId ?? "");
  const version = useRoomVersion(roomId);
  const entries = useMemo(() => {
    void version;
    const room = MatrixClientPeg.safeGet()?.getRoom(roomId) ?? null;
    const mapped = toTimelineEntries(events, room, roster);
    if (gapBeforeEventIds.length === 0) return mapped;
    const gaps = new Set(gapBeforeEventIds);
    return mapped.flatMap((e) =>
      gaps.has(e.message.id) ? [gapEntry(e.message), e] : [e],
    );
  }, [roomId, events, gapBeforeEventIds, roster, version]);
  return { entries, pendingRootIds };
}

export interface ThreadEntriesState {
  root: TimelineMessage | null;
  rootPending: boolean;
  replies: TimelineMessage[];
  totalCount: number;
}

export function useThreadEntries(
  roomId: string,
  rootId: string,
  workforceSpaceId: string | null,
): ThreadEntriesState {
  const { root, rootPending, events, totalCount } = useThread(roomId, rootId);
  const roster = useWorkforce(workforceSpaceId ?? "");
  const version = useRoomVersion(roomId);
  return useMemo(() => {
    void version;
    const room = MatrixClientPeg.safeGet()?.getRoom(roomId) ?? null;
    return {
      root: root ? (toTimelineMessages([root], room, roster)[0] ?? null) : null,
      rootPending,
      replies: toTimelineMessages(events, room, roster),
      totalCount,
    };
  }, [roomId, root, rootPending, events, totalCount, roster, version]);
}

/** Agent turns still running in the room. */
export function useOpenTurns(roomId: string, workforceSpaceId: string | null): AgentTurn[] {
  const roster = useWorkforce(workforceSpaceId ?? "");
  const version = useRoomVersion(roomId);
  return useMemo(() => {
    void version;
    const room = MatrixClientPeg.safeGet()?.getRoom(roomId) ?? null;
    return room ? toOpenTurns(allRoomEvents(room), room, roster) : [];
  }, [roomId, roster, version]);
}
