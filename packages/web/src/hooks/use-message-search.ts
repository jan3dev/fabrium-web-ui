import {
  type IEventWithRoomId,
  type MatrixClient,
  SearchOrderBy,
} from "matrix-js-sdk";
import { useEffect, useMemo, useState } from "react";
import { MatrixClientPeg } from "../client/peg";
import {
  normalizeFromHandle,
  normalizeInRoom,
  parseSearchOperators,
} from "../lib/search/parse-search-operators";
import { displayNameOf } from "../lib/sender";
import { toActor } from "../model/from-matrix";
import type { ActorSummary } from "../model/types";
import { useDebounce } from "./use-debounce";
import { useWorkforce } from "./use-workforce";

export type MessageSearchStatus =
  | "idle"
  | "loading"
  | "done"
  | "unsupported"
  | "error";

export interface MessageSearchHit {
  id: string;
  roomId: string;
  roomName: string;
  threadRootId: string | null;
  author: ActorSummary;
  body: string;
  createdAt: number;
}

export interface MessageSearch {
  status: MessageSearchStatus;
  hits: MessageSearchHit[];
  error: string | null;
  /** The search term the hits answer, operators removed: what to highlight. */
  term: string;
}

interface RawState {
  status: MessageSearchStatus;
  events: IEventWithRoomId[];
  error: string | null;
}

const IDLE: RawState = { status: "idle", events: [], error: null };
const NO_HITS: RawState = { status: "done", events: [], error: null };

/**
 * Rooms the search may cover: joined, not a space, not encrypted (the server
 * cannot read those). `in:` narrows it by room ID, alias or name; an `in:` that
 * matches nothing yields no rooms, so the search never silently widens.
 */
function searchRooms(
  client: MatrixClient,
  inValue: string | null,
  scopeRoomId: string | null,
): string[] {
  const rooms = client
    .getRooms()
    .filter(
      (r) =>
        r.getMyMembership() === "join" &&
        !r.isSpaceRoom() &&
        !r.hasEncryptionStateEvent(),
    );
  if (scopeRoomId)
    return rooms.filter((r) => r.roomId === scopeRoomId).map((r) => r.roomId);
  if (!inValue) return rooms.map((r) => r.roomId);
  const raw = inValue.toLowerCase();
  const name = normalizeInRoom(raw);
  return rooms
    .filter(
      (r) =>
        r.roomId.toLowerCase() === raw ||
        r.getCanonicalAlias()?.toLowerCase() === raw ||
        r.name.toLowerCase() === name,
    )
    .map((r) => r.roomId);
}

/** `from:` → a user ID: a full `@user:server`, or a localpart / display name of someone in a joined room. */
function searchSender(client: MatrixClient, from: string): string | null {
  if (from.startsWith("@") && from.includes(":")) return from;
  const handle = normalizeFromHandle(from).toLowerCase();
  for (const room of client.getRooms()) {
    const member = room
      .getJoinedMembers()
      .find(
        (m) =>
          displayNameOf(m.userId).toLowerCase() === handle ||
          m.name.toLowerCase() === handle,
      );
    if (member) return member.userId;
  }
  return null;
}

function isUnsupported(e: unknown): boolean {
  const err = e as { errcode?: string; httpStatus?: number };
  return (
    err.errcode === "M_UNRECOGNIZED" ||
    err.httpStatus === 404 ||
    err.httpStatus === 405
  );
}

/**
 * Server-side message search (`/search`), newest first. Supports `in:#room`
 * and `from:@user`. Encrypted rooms are left out.
 */
export function useMessageSearch(
  query: string,
  {
    enabled = true,
    roomId = null,
    workforceSpaceId = null,
    limit = 20,
  }: {
    enabled?: boolean;
    roomId?: string | null;
    workforceSpaceId?: string | null;
    limit?: number;
  } = {},
): MessageSearch {
  const trimmed = query.trim();
  const debounced = useDebounce(trimmed, 300);
  const parsed = parseSearchOperators(debounced);
  const roster = useWorkforce(workforceSpaceId ?? "");
  const [raw, setRaw] = useState<RawState>(IDLE);

  useEffect(() => {
    const client = MatrixClientPeg.safeGet();
    if (!enabled || !client || !parsed.text) {
      setRaw(IDLE);
      return;
    }
    const rooms = searchRooms(client, parsed.in, roomId);
    const sender = parsed.from ? searchSender(client, parsed.from) : undefined;
    // Never send an empty list: the server reads `senders: []` as "nobody".
    if (rooms.length === 0 || sender === null) {
      setRaw(NO_HITS);
      return;
    }
    const controller = new AbortController();
    setRaw((prev) => ({ ...prev, status: "loading", error: null }));
    client
      .search(
        {
          body: {
            search_categories: {
              room_events: {
                search_term: parsed.text,
                order_by: SearchOrderBy.Recent,
                event_context: { before_limit: 0, after_limit: 0 },
                filter: {
                  rooms,
                  limit,
                  ...(sender ? { senders: [sender] } : {}),
                },
              },
            },
          },
        },
        controller.signal,
      )
      .then((res) => {
        const events = (res.search_categories.room_events.results ?? []).map(
          (r) => r.result,
        );
        setRaw({ status: "done", events, error: null });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (isUnsupported(e))
          setRaw({ status: "unsupported", events: [], error: null });
        else
          setRaw({
            status: "error",
            events: [],
            error: e instanceof Error ? e.message : "Search failed.",
          });
      });
    return () => controller.abort();
  }, [enabled, parsed.text, parsed.in, parsed.from, roomId, limit]);

  const hits = useMemo(() => {
    const client = MatrixClientPeg.safeGet();
    return raw.events.flatMap((ev): MessageSearchHit[] => {
      const content = (ev.content ?? {}) as {
        body?: unknown;
        "m.relates_to"?: { rel_type?: string; event_id?: string };
      };
      const rel = content["m.relates_to"];
      // An edit duplicates its original; the original is the hit to open.
      if (rel?.rel_type === "m.replace" || typeof content.body !== "string")
        return [];
      const room = client?.getRoom(ev.room_id) ?? null;
      return [
        {
          id: ev.event_id,
          roomId: ev.room_id,
          roomName: room?.name || ev.room_id,
          threadRootId:
            rel?.rel_type === "m.thread" ? (rel.event_id ?? null) : null,
          author: toActor(ev.sender, room, roster),
          body: content.body,
          createdAt: ev.origin_server_ts,
        },
      ];
    });
  }, [raw.events, roster]);

  // Typed text the debounce hasn't caught up with is a search in flight.
  const status =
    enabled && trimmed !== debounced && parseSearchOperators(trimmed).text
      ? "loading"
      : raw.status;
  return { status, hits, error: raw.error, term: parsed.text };
}

/** Where a hit opens: its room, scrolled to the event, inside its thread when it has one. */
export function messageHitPath(
  hit: Pick<MessageSearchHit, "id" | "roomId" | "threadRootId">,
): string {
  const params = new URLSearchParams();
  if (hit.threadRootId) params.set("thread", hit.threadRootId);
  params.set("event", hit.id);
  return `/room/${hit.roomId}?${params}`;
}
