// Inbox view model: what needs the viewer across rooms. Pure functions over a
// room's loaded events, like from-matrix.ts.
import type { MatrixEvent, Room } from "matrix-js-sdk";
import { ApprovalEventType } from "@/events/approval";
import {
  ElicitationEventType,
  decodeElicitationRequest,
  findElicitationResolution,
} from "@/events/elicitation";
import type { ApprovalView } from "./agent-activity";
import { type Roster, toTimelineMessages } from "./from-matrix";
import type { TimelineMessage } from "./types";

/** needs_action: open approvals and questions. mention: highlights. activity: unread replies in my threads. */
export type InboxCategory = "needs_action" | "mention" | "activity";

export interface InboxItem {
  id: string;
  category: InboxCategory;
  roomId: string;
  roomName: string;
  /** The approval, question or message the item is about. */
  message: TimelineMessage;
  /** One line for the list row. */
  preview: string;
  unread: boolean;
}

function previewOf(m: TimelineMessage): string {
  if (m.kind === "approval") {
    const { request } = m.raw as ApprovalView;
    return `Wants to use ${request.toolTitle ?? request.toolKind ?? "a tool"}`;
  }
  if (m.kind === "question") return decodeElicitationRequest(m.raw as MatrixEvent)?.message ?? "";
  return m.body;
}

function item(
  category: InboxCategory,
  room: Room,
  message: TimelineMessage,
  unread = true,
): InboxItem {
  return {
    id: message.id,
    category,
    roomId: room.roomId,
    roomName: room.name,
    message,
    preview: previewOf(message),
    unread,
  };
}

const isRequest = (ev: MatrixEvent) =>
  ev.getType() === ApprovalEventType.Request ||
  ev.getType() === ElicitationEventType.Request;

/** Approvals nobody answered whose turn still runs, and questions their agent has not closed. */
export function toNeedsAction(
  events: readonly MatrixEvent[],
  room: Room,
  roster: Roster | null,
): InboxItem[] {
  const requests = events.filter(isRequest);
  if (requests.length === 0) return [];
  const all = [...events];
  return toTimelineMessages(requests, room, roster)
    .filter((m) => {
      if (m.kind === "approval") {
        const a = m.raw as ApprovalView;
        return !a.resolution && !a.expired;
      }
      const q = decodeElicitationRequest(m.raw as MatrixEvent);
      return !!q && !findElicitationResolution(all, q.requestId, q.sender, q);
    })
    .map((m) => item("needs_action", room, m));
}

/**
 * Threads the viewer started or replied in, whose latest reply is someone
 * else's and not yet read. One item per thread: its latest reply.
 */
export function toThreadActivity(
  events: readonly MatrixEvent[],
  room: Room,
  roster: Roster | null,
  hasRead: (eventId: string) => boolean,
): InboxItem[] {
  const me = room.myUserId;
  const byRoot = new Map<string, MatrixEvent[]>();
  const senders = new Map<string, string>();
  for (const ev of events) {
    senders.set(ev.getId() ?? "", ev.getSender() ?? "");
    const rel = ev.getRelation();
    if (
      rel?.rel_type !== "m.thread" ||
      !rel.event_id ||
      ev.getType() !== "m.room.message"
    )
      continue;
    const list = byRoot.get(rel.event_id) ?? [];
    list.push(ev);
    byRoot.set(rel.event_id, list);
  }
  const latest: MatrixEvent[] = [];
  for (const [rootId, replies] of byRoot) {
    const mine =
      senders.get(rootId) === me || replies.some((r) => r.getSender() === me);
    const last = replies[replies.length - 1]!;
    if (mine && last.getSender() !== me && !hasRead(last.getId() ?? ""))
      latest.push(last);
  }
  return toTimelineMessages(latest, room, roster).map((m) =>
    item("activity", room, m),
  );
}

/** Highlight notifications (`GET /notifications?only=highlight`) in one room. */
export function toMentions(
  events: readonly { event: MatrixEvent; read: boolean }[],
  room: Room,
  roster: Roster | null,
): InboxItem[] {
  const read = new Map(events.map((e) => [e.event.getId(), e.read]));
  return toTimelineMessages(
    events.map((e) => e.event),
    room,
    roster,
  )
    .filter((m) => m.kind === "message" && !m.redacted)
    .map((m) => item("mention", room, m, !read.get(m.id)));
}

/** Newest first; an event in two categories keeps the first: needs_action, then mention, then activity. */
export function mergeInboxItems(...lists: InboxItem[][]): InboxItem[] {
  const seen = new Set<string>();
  const out: InboxItem[] = [];
  for (const list of lists) {
    for (const i of list) {
      if (seen.has(i.id)) continue;
      seen.add(i.id);
      out.push(i);
    }
  }
  return out.sort((a, b) => b.message.createdAt - a.message.createdAt);
}
