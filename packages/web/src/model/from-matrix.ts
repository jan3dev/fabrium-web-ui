// Matrix → view model. Pure functions: same events and room in, same view model out.
import {
  EventStatus,
  type IContent,
  type MatrixEvent,
  type Room,
} from "matrix-js-sdk";
import { ApprovalEventType } from "@/events/approval";
import { ElicitationEventType } from "@/events/elicitation";
import { decodeZooidEvent, isZooidLifecycle } from "@/events/zooid-events";
import { allRoomEvents } from "@/hooks/use-timeline";
import { describeMembershipTransition } from "@/lib/matrix/membership-transition";
import { describeSendError } from "@/lib/matrix/send-error";
import { readQuoteRef, splitQuoteFallback } from "@/lib/matrix/quote";
import { displayNameOf } from "@/lib/sender";
import type {
  ActorSummary,
  ThreadSummary,
  TimelineEntry,
  TimelineMessage,
  TimelineReaction,
} from "./types";

/** Who counts as an agent. `useWorkforce()` satisfies it. */
export interface Roster {
  isAgent(userId: string): boolean;
}

// ponytail: the daemon's appservice user is "zooid" by default but a workstation
// can rename it; read it from the roster sender when that matters.
const SYSTEM_LOCALPARTS = new Set(["zooid"]);

const serverOf = (userId: string) => userId.slice(userId.indexOf(":") + 1);

/** The daemon's user on our own homeserver; `@zooid:` on another server is just a user. */
function isSystemUser(userId: string, room: Room | null): boolean {
  return !!room && SYSTEM_LOCALPARTS.has(displayNameOf(userId)) && serverOf(userId) === serverOf(room.myUserId);
}

const MEDIA_MSGTYPES = new Set(["m.image", "m.file", "m.video", "m.audio"]);
const TEXT_MSGTYPES = new Set(["m.text", "m.notice", "m.emote"]);
const MAX_THREAD_PARTICIPANTS = 3;

export function toActor(
  userId: string,
  room: Room | null,
  roster: Roster | null,
): ActorSummary {
  const member = room?.getMember(userId);
  const kind = roster?.isAgent(userId)
    ? "agent"
    : isSystemUser(userId, room)
      ? "system"
      : "human";
  return {
    id: userId,
    kind,
    displayName: member?.name || displayNameOf(userId),
    avatarUrl: member?.getMxcAvatarUrl() ?? null,
  };
}

interface RelationIndex {
  /** Redaction events in the room, by target. */
  redactions: Map<string, MatrixEvent[]>;
  reactions: Map<string, MatrixEvent[]>;
  /** m.replace events per target; validity is checked against the target's sender. */
  edits: Map<string, MatrixEvent[]>;
  threads: Map<string, MatrixEvent[]>;
}

/**
 * Redacted by the server, by us and still pending, or the target of a
 * redaction its sender was allowed to make. The last catches what the SDK flags
 * late: a local redaction empties the content at once but sets
 * `redacted_because` only on a later sync, and the remote echo can clear the
 * local mark before that. Anyone can put a redaction event in the timeline; the
 * server only applies the authorised ones, so only those count here.
 */
function isRedacted(ev: MatrixEvent, redactions: RelationIndex["redactions"], room: Room | null): boolean {
  if (ev.isRedacted() || ev.localRedactionEvent() !== null) return true;
  return (redactions.get(ev.getId() ?? "") ?? []).some((r) => {
    const sender = r.getSender() ?? "";
    return sender === ev.getSender() || (room?.currentState.maySendRedactionForEvent(ev, sender) ?? false);
  });
}

function indexRelations(events: readonly MatrixEvent[], room: Room | null): RelationIndex {
  const redactions = new Map<string, MatrixEvent[]>();
  for (const ev of events) {
    if (ev.getType() !== "m.room.redaction" || ev.status === EventStatus.CANCELLED) continue;
    const target = ev.event.redacts ?? (ev.getContent() as { redacts?: string }).redacts;
    if (target) push(redactions, target, ev);
  }
  const reactions = new Map<string, MatrixEvent[]>();
  const edits = new Map<string, MatrixEvent[]>();
  const threads = new Map<string, MatrixEvent[]>();
  for (const ev of events) {
    // getRelation() reads the wire content, so it holds for edited events too.
    const rel = ev.getRelation();
    if (!rel?.event_id) continue;
    if (
      rel.rel_type === "m.annotation" &&
      ev.getType() === "m.reaction" &&
      !isRedacted(ev, redactions, room)
    ) {
      push(reactions, rel.event_id, ev);
    } else if (
      rel.rel_type === "m.replace" &&
      !isRedacted(ev, redactions, room) &&
      ev.getContent()["m.new_content"]
    ) {
      push(edits, rel.event_id, ev);
    } else if (rel.rel_type === "m.thread") {
      push(threads, rel.event_id, ev);
    }
  }
  return { redactions, reactions, edits, threads };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function toReactions(
  events: MatrixEvent[] | undefined,
  me: string | null,
): TimelineReaction[] {
  if (!events) return [];
  const byKey = new Map<string, TimelineReaction>();
  for (const ev of events) {
    const emoji = ev.getRelation()?.key;
    const sender = ev.getSender();
    if (!emoji || !sender) continue;
    const r = byKey.get(emoji) ?? {
      emoji,
      count: 0,
      reactedByMe: false,
      actorIds: [],
    };
    if (r.actorIds.includes(sender)) continue;
    r.count += 1;
    r.actorIds.push(sender);
    if (sender === me) {
      r.reactedByMe = true;
      r.myEventId = ev.getId() ?? undefined;
    }
    byKey.set(emoji, r);
  }
  return [...byKey.values()];
}

/** The latest edit by the message's own sender (MSC2676), or null. */
function editedContent(ev: MatrixEvent, edits: RelationIndex["edits"]): IContent | null {
  let latest: MatrixEvent | null = null;
  for (const edit of edits.get(ev.getId() ?? "") ?? []) {
    if (edit.getSender() !== ev.getSender()) continue;
    if (!latest || edit.getTs() >= latest.getTs()) latest = edit;
  }
  return latest ? (latest.getContent()["m.new_content"] as IContent) : null;
}

/** Kind + body for one event, or null when it renders nothing on its own. */
function classify(
  ev: MatrixEvent,
  room: Room | null,
  redactions: RelationIndex["redactions"],
): Pick<TimelineMessage, "kind" | "body" | "raw"> | null {
  const type = ev.getType();
  if (type === "m.room.message") {
    const msgtype = (ev.getContent() as { msgtype?: string }).msgtype;
    if (
      isRedacted(ev, redactions, room) ||
      TEXT_MSGTYPES.has(msgtype ?? "") ||
      MEDIA_MSGTYPES.has(msgtype ?? "")
    ) {
      return { kind: "message", body: "" };
    }
    return null;
  }
  if (type === "m.room.member") {
    const c = ev.getContent() as { membership?: string; reason?: string };
    const name = (id: string) => room?.getMember(id)?.name || displayNameOf(id);
    const line = describeMembershipTransition(
      {
        membership: c.membership,
        prevMembership: (ev.getPrevContent() as { membership?: string })
          .membership,
        sender: ev.getSender() ?? "",
        stateKey: ev.getStateKey() ?? "",
        reason: c.reason,
      },
      name,
    );
    return line ? { kind: "membership", body: line } : null;
  }
  if (type === "m.room.topic") {
    const topic = (ev.getContent() as { topic?: string }).topic;
    return {
      kind: "state",
      body: topic ? `changed the topic to "${topic}"` : "removed the topic",
    };
  }
  if (type === "m.room.name") {
    const name = (ev.getContent() as { name?: string }).name;
    return {
      kind: "state",
      body: name ? `renamed the room to "${name}"` : "removed the room name",
    };
  }
  if (type === "dev.zooid.session_reset")
    return { kind: "divider", body: "New session" };
  if (type === ApprovalEventType.Request)
    return { kind: "approval", body: "", raw: ev };
  if (type === ElicitationEventType.Request)
    return { kind: "question", body: "", raw: ev };
  if (isZooidLifecycle(ev)) {
    const decoded = decodeZooidEvent(ev);
    // turn.start renders nothing; tool_call_update folds into its tool_call card.
    if (
      !decoded ||
      decoded.kind === "turn.start" ||
      decoded.kind === "tool_call_update"
    )
      return null;
    return {
      kind: decoded.kind === "error" ? "error" : "agent-turn",
      body: "",
      raw: decoded,
    };
  }
  return null;
}

function toMessage(
  ev: MatrixEvent,
  room: Room | null,
  roster: Roster | null,
  index: RelationIndex,
  me: string | null,
): TimelineMessage | null {
  const base = classify(ev, room, index.redactions);
  const redacted = isRedacted(ev, index.redactions, room);
  if (!base) return null;
  const id = ev.getId() ?? `${ev.getType()}-${ev.getTs()}`;
  const rel = ev.getRelation();
  const message: TimelineMessage = {
    id,
    ...base,
    createdAt: ev.getTs(),
    author: toActor(ev.getSender() ?? "", room, roster),
    threadRootId: rel?.rel_type === "m.thread" ? (rel.event_id ?? null) : null,
    replyToId:
      (
        ev.getWireContent()["m.relates_to"] as
          | { "m.in_reply_to"?: { event_id?: string } }
          | undefined
      )?.["m.in_reply_to"]?.event_id ?? null,
    edited: false,
    pending:
      ev.status === EventStatus.SENDING ||
      ev.status === EventStatus.QUEUED ||
      ev.status === EventStatus.ENCRYPTING,
    failed: ev.status === EventStatus.NOT_SENT,
    failedReason: ev.status === EventStatus.NOT_SENT ? describeSendError(ev.error) : undefined,
    redacted,
    reactions: redacted ? [] : toReactions(index.reactions.get(id), me),
  };
  if (message.kind !== "message" || message.redacted) return message;

  const original = ev.getContent() as {
    msgtype?: string;
    body?: string;
    format?: string;
    formatted_body?: string;
    filename?: string;
    url?: string;
    info?: { mimetype?: string; size?: number; w?: number; h?: number };
  };
  const edit = editedContent(ev, index.edits);
  const content = (edit ?? original) as typeof original;
  message.edited = !!edit;
  const quote = readQuoteRef(original);
  if (quote) {
    message.quote = quote;
    message.body = splitQuoteFallback(content.body ?? "").comment;
  } else {
    message.body = content.body ?? "";
    // An edit keeps the original format only if it carries its own HTML.
    if (
      original.format === "org.matrix.custom.html" &&
      content.formatted_body
    ) {
      message.formattedBody = content.formatted_body;
    }
  }
  if (MEDIA_MSGTYPES.has(original.msgtype ?? "")) {
    message.media = {
      mxc: original.url ?? "",
      mimetype:
        original.info?.mimetype ??
        (original.msgtype === "m.image" ? "image/*" : ""),
      name: original.filename ?? original.body ?? "untitled",
      size: original.info?.size,
      w: original.info?.w,
      h: original.info?.h,
    };
  }
  return message;
}

function toThread(
  rootId: string,
  root: MatrixEvent,
  replies: MatrixEvent[] | undefined,
  room: Room | null,
  roster: Roster | null,
): ThreadSummary | null {
  const serverCount =
    (
      root.getUnsigned() as {
        "m.relations"?: { "m.thread"?: { count?: number } };
      }
    )["m.relations"]?.["m.thread"]?.count ?? 0;
  const replyCount = Math.max(serverCount, replies?.length ?? 0);
  if (replyCount === 0) return null;
  const participants: ActorSummary[] = [];
  for (
    let i = (replies?.length ?? 0) - 1;
    i >= 0 && participants.length < MAX_THREAD_PARTICIPANTS;
    i--
  ) {
    const sender = replies![i].getSender();
    if (sender && !participants.some((p) => p.id === sender))
      participants.push(toActor(sender, room, roster));
  }
  return {
    rootId,
    replyCount,
    lastReplyAt: replies?.length ? replies[replies.length - 1].getTs() : null,
    participants,
  };
}

/**
 * Maps `events` (in order) to timeline entries, each with its thread summary.
 * Reactions, edits and thread replies are read from every event the room has
 * loaded, so a reaction in an older timeline still lands on its message.
 */
export function toTimelineEntries(
  events: readonly MatrixEvent[],
  room: Room | null,
  roster: Roster | null,
): TimelineEntry[] {
  const index = indexRelations(room ? allRoomEvents(room) : events, room);
  const me = room?.myUserId ?? null;
  const out: TimelineEntry[] = [];
  for (const ev of events) {
    const message = toMessage(ev, room, roster, index, me);
    if (!message) continue;
    const thread =
      message.kind === "message" && !message.threadRootId
        ? toThread(message.id, ev, index.threads.get(message.id), room, roster)
        : null;
    out.push({ message, thread });
  }
  return out;
}

export function toTimelineMessages(
  events: readonly MatrixEvent[],
  room: Room | null,
  roster: Roster | null,
): TimelineMessage[] {
  return toTimelineEntries(events, room, roster).map((e) => e.message);
}
