import {
  ClientEvent,
  Direction,
  type EventTimeline,
  type IEvent,
  type MatrixClient,
  MatrixEvent,
  type Room,
  RoomEvent,
} from "matrix-js-sdk";
import { useSyncExternalStore } from "react";
import { ElicitationEventType, openElicitationSenders } from "../events/elicitation";
import { MatrixClientPeg } from "../client/peg";

interface TimelineState {
  events: MatrixEvent[];
  /** Root event_ids referenced by thread replies that aren't yet in any local timeline. */
  pendingRootIds: string[];
  /**
   * Ids of rendered events that begin a stretch of timeline the SDK could not
   * join to what came before it. Everything above such an event is older, but
   * not adjacent — messages are missing in between and have to be paginated in.
   */
  gapBeforeEventIds: string[];
  /**
   * `id:status` of every local echo. A status change (SENDING → NOT_SENT →
   * SENDING → sent) mutates the same MatrixEvent in place, so without this the
   * cached snapshot would look unchanged and the tile would never repaint.
   */
  echoKey: string;
}

export interface ThreadPreviewState {
  /** Last ≤3 thread-reply events for this root, in arrival order. */
  events: MatrixEvent[];
  /** Authoritative total reply count (from server unsigned or live timeline). */
  totalCount: number;
}

export interface ThreadFullState {
  /** The thread root event, or undefined while loading. */
  root: MatrixEvent | undefined;
  /** True while we're trying to fetch the root event from the server. */
  rootPending: boolean;
  /** All thread-reply events, in chronological order. */
  events: MatrixEvent[];
  /** Authoritative total reply count. */
  totalCount: number;
}

const EMPTY: TimelineState = { events: [], pendingRootIds: [], gapBeforeEventIds: [], echoKey: "" };
const THREAD_EMPTY: ThreadPreviewState = { events: [], totalCount: 0 };
const THREAD_FULL_EMPTY: ThreadFullState = {
  root: undefined,
  rootPending: false,
  events: [],
  totalCount: 0,
};

const snapshotCache = new WeakMap<Room, TimelineState>();

const threadCache = new Map<
  string,
  { replyCount: number; totalCount: number; state: ThreadPreviewState }
>();

const threadFullCache = new Map<
  string,
  { replyCount: number; totalCount: number; root: MatrixEvent | undefined; rootPending: boolean; state: ThreadFullState }
>();

// Lazy-loaded events fetched via /rooms/{roomId}/event/{eventId} when the
// thread root falls outside the synced timeline window. Keyed by event_id.
const fetchedEvents = new Map<string, MatrixEvent>();
const inFlightFetches = new Set<string>(); // `${roomId}:${eventId}`
const failedFetches = new Set<string>(); // don't retry endlessly
const fetchSubscribers = new Set<() => void>();

function notifyFetchSubscribers() {
  for (const cb of fetchSubscribers) cb();
}

function ensureRootFetched(client: MatrixClient, roomId: string, eventId: string): void {
  const key = `${roomId}:${eventId}`;
  if (
    fetchedEvents.has(eventId) ||
    inFlightFetches.has(key) ||
    failedFetches.has(key)
  ) {
    return;
  }
  inFlightFetches.add(key);
  void client
    .fetchRoomEvent(roomId, eventId)
    .then((raw) => {
      fetchedEvents.set(eventId, new MatrixEvent(raw as IEvent));
      notifyFetchSubscribers();
    })
    .catch((err) => {
      console.warn(`[useTimeline] fetchRoomEvent(${roomId}, ${eventId}) failed:`, err);
      failedFetches.add(key);
    })
    .finally(() => {
      inFlightFetches.delete(key);
    });
}

export function allRoomEvents(room: Room): MatrixEvent[] {
  // getLiveTimeline() only covers the current window. After a limited sync,
  // older events live in historical timelines within the same set — which is
  // true only because the peg creates the client with timelineSupport: true.
  // Without it the SDK drops those timelines outright and this loop would
  // never see more than one.
  const timelineSet = room.getUnfilteredTimelineSet();
  const seen = new Set<string>();
  const out: MatrixEvent[] = [];
  for (const tl of timelineSet.getTimelines()) {
    for (const ev of tl.getEvents()) {
      const id = ev.getId() ?? `${ev.getType()}-${ev.getTs()}`;
      if (!seen.has(id)) {
        seen.add(id);
        out.push(ev);
      }
    }
  }
  out.sort((a, b) => a.getTs() - b.getTs());
  return out;
}

/** The room's non-empty unfiltered timelines, ordered by their first event. */
function timelinesOldestFirst(room: Room): EventTimeline[] {
  return room
    .getUnfilteredTimelineSet()
    .getTimelines()
    .filter((tl) => tl.getEvents().length > 0)
    .sort((a, b) => a.getEvents()[0].getTs() - b.getEvents()[0].getTs());
}

/**
 * The timeline that owns the start of loaded history — the one "Load more"
 * must paginate. After a gappy sync the live timeline is the far side of a
 * hole, and joining it to an older one nulls its backward token, so it says
 * nothing about whether older history remains. Falls back to the live timeline
 * while the room has no events yet.
 */
export function oldestTimeline(room: Room): EventTimeline {
  return timelinesOldestFirst(room)[0] ?? room.getLiveTimeline();
}

/**
 * Timelines that start after a hole in the room's history.
 *
 * A gappy ("limited: true") sync forks a new timeline and leaves the previous
 * one in the set, unjoined — the events either side are contiguous once
 * allRoomEvents() sorts them by timestamp, but there are messages missing in
 * between. The SDK marks the boundary two ways: the later timeline has no
 * backward neighbour (nothing has been paginated across yet) and it still
 * carries a backward pagination token (there is something to fetch).
 *
 * The oldest timeline is excluded on purpose. It has both properties too, but
 * its backward token is simply the start of loaded history — that is what the
 * "Load more" button at the top of the panel is for, not a hole.
 */
function gapStartTimelines(room: Room): Set<EventTimeline> {
  const timelines = timelinesOldestFirst(room);

  const out = new Set<EventTimeline>();
  for (let i = 1; i < timelines.length; i++) {
    const tl = timelines[i];
    if (tl.getNeighbouringTimeline(Direction.Backward)) continue;
    if (tl.getPaginationToken(Direction.Backward) === null) continue;
    out.add(tl);
  }
  return out;
}

function snapshot(roomId: string): TimelineState {
  const client = MatrixClientPeg.safeGet();
  const room = client?.getRoom(roomId);
  if (!client || !room) return EMPTY;

  const all = allRoomEvents(room);
  const inSetIds = new Set<string>();
  const referencedRootIds = new Set<string>();
  const events: MatrixEvent[] = [];

  for (const ev of all) {
    const id = ev.getId();
    if (id) inSetIds.add(id);
    // getRelation() reads getWireContent() — the original wire event — so it
    // is correct even for replaced events (getContent() returns m.new_content
    // which has no m.relates_to, causing edited threaded messages to leak into
    // the main timeline).
    const rel = ev.getRelation();
    if (rel?.rel_type === "m.thread") {
      if (rel.event_id) referencedRootIds.add(rel.event_id);
    } else if (rel?.rel_type === "m.replace") {
      // Edit events: suppress from the timeline; content applied to the
      // original event via resolveEditedContent / useEditedContent.
    } else {
      events.push(ev);
    }
  }

  const pendingRootIds: string[] = [];

  for (const rootId of referencedRootIds) {
    if (inSetIds.has(rootId)) continue;
    const cached = fetchedEvents.get(rootId);
    if (cached) {
      events.push(cached);
      continue;
    }
    const found = room.findEventById(rootId);
    if (found) {
      events.push(found);
      continue;
    }
    ensureRootFetched(client, roomId, rootId);
    pendingRootIds.push(rootId);
  }

  events.sort((a, b) => a.getTs() - b.getTs());

  // Anchor each gap to the first *rendered* event of the timeline that follows
  // it. The timeline's own first event may have been filtered out above (a
  // thread reply or an edit), and anchoring to an event that never reaches the
  // DOM would silently drop the marker.
  const gapTimelines = gapStartTimelines(room);
  const gapBeforeEventIds: string[] = [];
  if (gapTimelines.size > 0) {
    const timelineSet = room.getUnfilteredTimelineSet();
    for (const ev of events) {
      const id = ev.getId();
      if (!id) continue;
      const tl = timelineSet.getTimelineForEvent(id);
      if (!tl || !gapTimelines.has(tl)) continue;
      gapBeforeEventIds.push(id);
      gapTimelines.delete(tl);
      if (gapTimelines.size === 0) break;
    }
  }

  const echoKey = events
    .filter((ev) => ev.status)
    .map((ev) => `${ev.getId()}:${ev.status}`)
    .join(",");

  const cached = snapshotCache.get(room);
  if (
    cached &&
    cached.echoKey === echoKey &&
    cached.events.length === events.length &&
    cached.events[events.length - 1] === events[events.length - 1] &&
    cached.pendingRootIds.length === pendingRootIds.length &&
    cached.pendingRootIds.every((id, i) => id === pendingRootIds[i]) &&
    cached.gapBeforeEventIds.length === gapBeforeEventIds.length &&
    cached.gapBeforeEventIds.every((id, i) => id === gapBeforeEventIds[i])
  ) {
    return cached;
  }
  const next = { events, pendingRootIds, gapBeforeEventIds, echoKey };
  snapshotCache.set(room, next);
  return next;
}

function snapshotThread(roomId: string, rootEventId: string): ThreadPreviewState {
  const client = MatrixClientPeg.safeGet();
  const room = client?.getRoom(roomId);
  if (!room) return THREAD_EMPTY;

  const all = allRoomEvents(room);
  const rootEvent =
    all.find((ev) => ev.getId() === rootEventId) ??
    fetchedEvents.get(rootEventId) ??
    room.findEventById(rootEventId);
  const unsigned = rootEvent?.getUnsigned() as
    | { "m.relations"?: { "m.thread"?: { count?: number } } }
    | undefined;
  const serverCount = unsigned?.["m.relations"]?.["m.thread"]?.count ?? 0;

  const threadEvents = all.filter((ev) => {
    const rel = ev.getRelation();
    return rel?.rel_type === "m.thread" && rel.event_id === rootEventId;
  });

  const totalCount = Math.max(serverCount, threadEvents.length);
  const cacheKey = `${roomId}:${rootEventId}`;
  const cached = threadCache.get(cacheKey);
  if (cached && cached.replyCount === threadEvents.length && cached.totalCount === totalCount) {
    return cached.state;
  }

  const state: ThreadPreviewState = { events: threadEvents.slice(-3), totalCount };
  threadCache.set(cacheKey, { replyCount: threadEvents.length, totalCount, state });
  return state;
}

function snapshotThreadFull(roomId: string, rootEventId: string): ThreadFullState {
  const client = MatrixClientPeg.safeGet();
  const room = client?.getRoom(roomId);
  if (!client || !room) return THREAD_FULL_EMPTY;

  const all = allRoomEvents(room);
  const root =
    all.find((ev) => ev.getId() === rootEventId) ??
    fetchedEvents.get(rootEventId) ??
    room.findEventById(rootEventId);

  let rootPending = false;
  if (!root) {
    ensureRootFetched(client, roomId, rootEventId);
    rootPending = true;
  }

  const unsigned = root?.getUnsigned() as
    | { "m.relations"?: { "m.thread"?: { count?: number } } }
    | undefined;
  const serverCount = unsigned?.["m.relations"]?.["m.thread"]?.count ?? 0;

  const threadEvents = all.filter((ev) => {
    const rel = ev.getRelation();
    return rel?.rel_type === "m.thread" && rel.event_id === rootEventId;
  });

  const totalCount = Math.max(serverCount, threadEvents.length);
  const cacheKey = `${roomId}:${rootEventId}`;
  const cached = threadFullCache.get(cacheKey);
  if (
    cached &&
    cached.replyCount === threadEvents.length &&
    cached.totalCount === totalCount &&
    cached.root === root &&
    cached.rootPending === rootPending
  ) {
    return cached.state;
  }

  const state: ThreadFullState = { root, rootPending, events: threadEvents, totalCount };
  threadFullCache.set(cacheKey, {
    replyCount: threadEvents.length,
    totalCount,
    root,
    rootPending,
    state,
  });
  return state;
}

export function makeSubscribe(roomId: string) {
  return (cb: () => void) => {
    const client = MatrixClientPeg.safeGet();
    if (!client) return MatrixClientPeg.subscribe(cb);
    const onTimeline = (_ev: MatrixEvent, room?: Room) => {
      if (room?.roomId === roomId) cb();
    };
    const onRoom = (room: Room) => {
      if (room.roomId === roomId) cb();
    };
    // A gappy sync makes the SDK rebuild the timeline set without emitting a
    // single Timeline event. Without this listener the store keeps serving a
    // snapshot of events that are no longer in the room, then collapses at
    // whatever unrelated event happens to arrive next.
    const onTimelineReset = (room?: Room) => {
      if (room?.roomId === roomId) cb();
    };
    // Fires when a local echo's status changes or it is cancelled or
    // resent; the event is mutated in place so no Timeline event follows.
    const onLocalEcho = (_ev: MatrixEvent, room: Room) => {
      if (room.roomId === roomId) cb();
    };
    client.on(RoomEvent.Timeline, onTimeline);
    client.on(RoomEvent.TimelineReset, onTimelineReset);
    client.on(ClientEvent.Room, onRoom);
    const room = client.getRoom(roomId);
    room?.on(RoomEvent.Timeline, onTimeline);
    room?.on(RoomEvent.TimelineReset, onTimelineReset);
    room?.on(RoomEvent.LocalEchoUpdated, onLocalEcho);
    fetchSubscribers.add(cb);
    const unsubPeg = MatrixClientPeg.subscribe(cb);
    return () => {
      client.off(RoomEvent.Timeline, onTimeline);
      client.off(RoomEvent.TimelineReset, onTimelineReset);
      client.off(ClientEvent.Room, onRoom);
      room?.off(RoomEvent.Timeline, onTimeline);
      room?.off(RoomEvent.TimelineReset, onTimelineReset);
      room?.off(RoomEvent.LocalEchoUpdated, onLocalEcho);
      fetchSubscribers.delete(cb);
      unsubPeg();
    };
  };
}

export function useTimeline(roomId: string): TimelineState {
  return useSyncExternalStore(
    makeSubscribe(roomId),
    () => snapshot(roomId),
    () => EMPTY,
  );
}

export function useThreadPreview(roomId: string, rootEventId: string): ThreadPreviewState {
  return useSyncExternalStore(
    makeSubscribe(roomId),
    () => snapshotThread(roomId, rootEventId),
    () => THREAD_EMPTY,
  );
}

export function useThread(roomId: string, rootEventId: string): ThreadFullState {
  return useSyncExternalStore(
    makeSubscribe(roomId),
    () => snapshotThreadFull(roomId, rootEventId),
    () => THREAD_FULL_EMPTY,
  );
}

const NO_EVENTS: MatrixEvent[] = [];
const NO_USERS: string[] = [];
const trailCache = new Map<string, { room: Room; key: string; value: MatrixEvent[] }>();
const awaitingCache = new Map<string, { key: string; value: string[] }>();

function snapshotElicitationTrail(roomId: string, requestId: string): MatrixEvent[] {
  const room = MatrixClientPeg.safeGet()?.getRoom(roomId);
  if (!room || !requestId) return NO_EVENTS;
  const hits = allRoomEvents(room).filter(
    (ev) =>
      (ev.getType() === ElicitationEventType.Resolved || ev.getType() === ElicitationEventType.Rejected) &&
      (ev.getContent() as { request_id?: unknown }).request_id === requestId,
  );
  const key = `${hits.length}:${hits.map((e) => e.getId()).join(",")}`;
  const cacheKey = `${roomId}|${requestId}`;
  const prev = trailCache.get(cacheKey);
  if (prev && prev.room === room && prev.key === key) return prev.value;
  const value = hits.length > 0 ? hits : NO_EVENTS;
  trailCache.set(cacheKey, { room, key, value });
  return value;
}

/** Resolved/rejected events for one question, thread-related ones included. */
export function useElicitationTrail(roomId: string, requestId: string): MatrixEvent[] {
  return useSyncExternalStore(
    makeSubscribe(roomId),
    () => snapshotElicitationTrail(roomId, requestId),
    () => NO_EVENTS,
  );
}

function snapshotAwaiting(roomId: string): string[] {
  const room = MatrixClientPeg.safeGet()?.getRoom(roomId);
  if (!room) return NO_USERS;
  const senders = openElicitationSenders(
    allRoomEvents(room).filter(
      (ev) => ev.getType() === ElicitationEventType.Request || ev.getType() === ElicitationEventType.Resolved,
    ),
  );
  const key = senders.join(",");
  const prev = awaitingCache.get(roomId);
  if (prev && prev.key === key) return prev.value;
  const value = senders.length > 0 ? senders : NO_USERS;
  awaitingCache.set(roomId, { key, value });
  return value;
}

/** Agents in this room waiting on a human answer. */
export function useAwaitingInput(roomId: string): string[] {
  return useSyncExternalStore(makeSubscribe(roomId), () => snapshotAwaiting(roomId), () => NO_USERS);
}
