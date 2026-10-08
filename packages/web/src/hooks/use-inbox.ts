import {
  ClientEvent,
  type MatrixClient,
  MatrixEvent,
  Method,
  type Room,
  RoomEvent,
} from "matrix-js-sdk";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { MatrixClientPeg } from "../client/peg";
import {
  type InboxItem,
  mergeInboxItems,
  toMentions,
  toNeedsAction,
  toThreadActivity,
} from "../model/inbox";
import { toTimelineMessages } from "../model/from-matrix";
import type { TimelineMessage } from "../model/types";
import { allRoomEvents } from "./use-timeline";
import { useWorkforce } from "./use-workforce";

/** Bumps on any change to any room's events or receipts. */
function useAllRoomsVersion(): number {
  const [version, bump] = useReducer((v: number) => v + 1, 0);
  useEffect(() => {
    const client = MatrixClientPeg.safeGet();
    const unsubPeg = MatrixClientPeg.subscribe(bump);
    if (!client) return unsubPeg;
    const events = [
      RoomEvent.Timeline,
      RoomEvent.TimelineReset,
      RoomEvent.Receipt,
      RoomEvent.MyMembership,
      ClientEvent.Room,
    ] as const;
    for (const e of events) client.on(e, bump);
    return () => {
      for (const e of events) client.off(e, bump);
      unsubPeg();
    };
  }, []);
  return version;
}

function joinedRooms(client: MatrixClient | null): Room[] {
  return (client?.getRooms() ?? []).filter(
    (r) => r.getMyMembership() === "join" && !r.isSpaceRoom(),
  );
}

// ponytail: rescans every joined room's loaded events on each change (a few ms
// for dozens of rooms); index per room if the sidebar badge ever shows in a profile.
function useNeedsAction(workforceSpaceId: string | null): InboxItem[] {
  const roster = useWorkforce(workforceSpaceId ?? "");
  const version = useAllRoomsVersion();
  return useMemo(() => {
    void version;
    return joinedRooms(MatrixClientPeg.safeGet()).flatMap((room) =>
      toNeedsAction(allRoomEvents(room), room, roster),
    );
  }, [roster, version]);
}

/** Open approvals and questions across rooms: the sidebar's Inbox badge. */
export function useInboxNeedsActionCount(
  workforceSpaceId: string | null,
): number {
  return useNeedsAction(workforceSpaceId).length;
}

export type MentionsState = "loading" | "ready" | "unsupported" | "error";

interface Notification {
  event: Record<string, unknown> & { event_id?: string; type?: string };
  room_id: string;
  read: boolean;
}

const PAGE = "50";

export interface InboxState {
  items: InboxItem[];
  mentions: MentionsState;
  hasMoreMentions: boolean;
  loadMoreMentions: () => void;
}

/** Everything that needs the viewer: open approvals and questions, mentions, unread replies in their threads. */
export function useInbox(workforceSpaceId: string | null): InboxState {
  const roster = useWorkforce(workforceSpaceId ?? "");
  const version = useAllRoomsVersion();
  const needsAction = useNeedsAction(workforceSpaceId);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [mentions, setMentions] = useState<MentionsState>("loading");
  const [nextToken, setNextToken] = useState<string | null>(null);

  const fetchPage = useCallback(async (from: string | null) => {
    const client = MatrixClientPeg.safeGet();
    if (!client) return;
    try {
      const res = await client.http.authedRequest<{
        notifications: Notification[];
        next_token?: string;
      }>(Method.Get, "/notifications", {
        only: "highlight",
        limit: PAGE,
        ...(from ? { from } : {}),
      });
      setNotifications((prev) =>
        from ? [...prev, ...res.notifications] : res.notifications,
      );
      setNextToken(res.next_token ?? null);
      setMentions("ready");
    } catch (err) {
      const e = err as { errcode?: string; httpStatus?: number };
      setMentions(
        e.errcode === "M_UNRECOGNIZED" || e.httpStatus === 404
          ? "unsupported"
          : "error",
      );
    }
  }, []);

  useEffect(() => {
    void fetchPage(null);
    // A new highlight lands in sync before /notifications lists it; refetch then.
    const client = MatrixClientPeg.safeGet();
    if (!client) return;
    const onTimeline = (
      ev: MatrixEvent,
      _room: Room | undefined,
      toStart: boolean | undefined,
    ) => {
      if (!toStart && client.getPushActionsForEvent(ev)?.tweaks?.highlight)
        void fetchPage(null);
    };
    client.on(RoomEvent.Timeline, onTimeline);
    return () => {
      client.off(RoomEvent.Timeline, onTimeline);
    };
  }, [fetchPage]);

  const items = useMemo(() => {
    void version;
    const client = MatrixClientPeg.safeGet();
    const rooms = joinedRooms(client);
    const byRoom = new Map<string, { event: MatrixEvent; read: boolean }[]>();
    for (const n of notifications) {
      if (
        n.event.type !== "m.room.message" ||
        typeof n.event.event_id !== "string"
      )
        continue;
      const room = client?.getRoom(n.room_id);
      // The loaded event carries its edits and redaction; the raw one stands in otherwise.
      const event =
        room?.findEventById(n.event.event_id) ??
        new MatrixEvent({ ...n.event, room_id: n.room_id });
      const list = byRoom.get(n.room_id) ?? [];
      list.push({ event, read: n.read });
      byRoom.set(n.room_id, list);
    }
    const me = client?.getUserId() ?? "";
    const mentionItems = rooms.flatMap((room) =>
      toMentions(byRoom.get(room.roomId) ?? [], room, roster),
    );
    const activity = rooms.flatMap((room) =>
      toThreadActivity(allRoomEvents(room), room, roster, (id) =>
        room.hasUserReadEvent(me, id),
      ),
    );
    return mergeInboxItems(needsAction, mentionItems, activity);
  }, [needsAction, notifications, roster, version]);

  return {
    items,
    mentions,
    hasMoreMentions: nextToken !== null,
    loadMoreMentions: () => {
      if (nextToken) void fetchPage(nextToken);
    },
  };
}

/**
 * One inbox item's message, mapped live from its room. The selected item keeps
 * rendering after it leaves the list, so an answered approval shows who answered.
 * Null when the room has not loaded the event.
 */
export function useInboxMessage(
  roomId: string | null,
  eventId: string | null,
  workforceSpaceId: string | null,
): TimelineMessage | null {
  const roster = useWorkforce(workforceSpaceId ?? "");
  const version = useAllRoomsVersion();
  return useMemo(() => {
    void version;
    const room = roomId ? MatrixClientPeg.safeGet()?.getRoom(roomId) : null;
    const ev = room && eventId ? room.findEventById(eventId) : undefined;
    return room && ev ? (toTimelineMessages([ev], room, roster)[0] ?? null) : null;
  }, [roomId, eventId, roster, version]);
}
