// Matrix → view model. Pure functions: same events and room in, same view model out.
import {
  EventStatus,
  type IContent,
  type MatrixEvent,
  type Room,
} from "matrix-js-sdk";
import { ApprovalEventType, decodeApprovalRequest, decodeApprovalResponse } from "@/events/approval";
import { ElicitationEventType } from "@/events/elicitation";
import { decodeZooidEvent, isZooidLifecycle, ZooidEventType } from "@/events/zooid-events";
import { allRoomEvents } from "@/hooks/use-timeline";
import { describeMembershipTransition } from "@/lib/matrix/membership-transition";
import { describeSendError } from "@/lib/matrix/send-error";
import { readQuoteRef, splitQuoteFallback } from "@/lib/matrix/quote";
import type { RosterAgent } from "@/lib/matrix/agent-detection";
import { displayNameOf } from "@/lib/sender";
import type { AgentTurn, ApprovalView } from "./agent-activity";
import { type TimedZooidEvent, toTranscriptItems } from "./from-zooid";
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
  /** The agent's roster entry, for its "Persona · Project" label. */
  agent?(userId: string): RosterAgent | undefined;
  /** The workforce space's name: an agent's project when it names none. */
  spaceName?: string;
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
  const name = member?.name || displayNameOf(userId);
  const entry = kind === "agent" ? roster?.agent?.(userId) : undefined;
  if (!entry) return { id: userId, kind, displayName: name, avatarUrl: member?.getMxcAvatarUrl() ?? null };
  const persona = entry.persona ?? name;
  const project = entry.project ?? roster?.spaceName;
  return {
    id: userId,
    kind,
    displayName: project ? `${persona} · ${project}` : persona,
    avatarUrl: member?.getMxcAvatarUrl() ?? null,
    persona,
    project,
  };
}

interface RelationIndex {
  /** Redaction events in the room, by target. */
  redactions: Map<string, MatrixEvent[]>;
  reactions: Map<string, MatrixEvent[]>;
  /** m.replace events per target; validity is checked against the target's sender. */
  edits: Map<string, MatrixEvent[]>;
  threads: Map<string, MatrixEvent[]>;
  turns: TurnIndex;
}

interface TurnIndex {
  /** Turn per tool_call / tool_call_update / plan event id. */
  turnOf: Map<string, TurnBuild>;
  /** turn.end times per `sender|session`, oldest first. */
  ends: Map<string, number[]>;
  /** Approval responses by approval_id, oldest first; toApprovalView picks the one that counts. */
  responses: Map<string, MatrixEvent[]>;
  /** Approval tool inputs by tool_call_id. */
  approvalInputs: Map<string, Record<string, unknown>>;
}

interface TurnBuild {
  id: string;
  /** The turn's first loaded event: its row sits here. */
  anchorId: string;
  sender: string;
  sessionId: string;
  threadRootId: string | null;
  events: TimedZooidEvent[];
  endedAt: number | null;
}

const TURN_ACTIVITY: ReadonlySet<string> = new Set([
  ZooidEventType.ToolCall,
  ZooidEventType.ToolCallUpdate,
  ZooidEventType.Plan,
]);

/**
 * Groups agent activity into turns. The daemon sends no turn.start, so a turn
 * is an agent's activity in one session up to its next turn.end.
 */
function indexTurns(events: readonly MatrixEvent[]): TurnIndex {
  const ends = new Map<string, number[]>();
  const responses = new Map<string, MatrixEvent[]>();
  const approvalInputs = new Map<string, Record<string, unknown>>();
  for (const ev of events) {
    const type = ev.getType();
    if (type === ZooidEventType.TurnEnd) {
      const session = (ev.getContent() as { session_id?: unknown }).session_id;
      if (typeof session === "string") push(ends, `${ev.getSender()}|${session}`, ev.getTs());
    } else if (type === ApprovalEventType.Response) {
      const r = decodeApprovalResponse(ev);
      if (r) push(responses, r.approvalId, ev);
    } else if (type === ApprovalEventType.Request) {
      const r = decodeApprovalRequest(ev);
      const input = r?.toolInput;
      if (r && input && typeof input === "object" && !Array.isArray(input))
        approvalInputs.set(r.toolCallId, input as Record<string, unknown>);
    }
  }
  for (const list of ends.values()) list.sort((a, b) => a - b);

  const turns = new Map<string, TurnBuild>();
  const turnOf = new Map<string, TurnBuild>();
  for (const ev of events) {
    if (!TURN_ACTIVITY.has(ev.getType())) continue;
    const decoded = decodeZooidEvent(ev);
    const id = ev.getId();
    if (!decoded || !id || decoded.kind === "error" || !decoded.sessionId) continue;
    const key = `${ev.getSender()}|${decoded.sessionId}`;
    const turnEnds = ends.get(key) ?? [];
    const n = turnEnds.filter((t) => t < ev.getTs()).length;
    let turn = turns.get(`${key}|${n}`);
    if (!turn) {
      const rel = ev.getRelation();
      turn = {
        id: `${key}|${n}`,
        anchorId: id,
        sender: ev.getSender() ?? "",
        sessionId: decoded.sessionId,
        threadRootId: rel?.rel_type === "m.thread" ? (rel.event_id ?? null) : null,
        events: [],
        endedAt: turnEnds[n] ?? null,
      };
      turns.set(turn.id, turn);
    }
    turn.events.push({ decoded, ts: ev.getTs() });
    turnOf.set(id, turn);
  }
  return { turnOf, ends, responses, approvalInputs };
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
  return { redactions, reactions, edits, threads, turns: indexTurns(events) };
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
  roster: Roster | null,
  { redactions, turns }: RelationIndex,
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
  if (type === ApprovalEventType.Request) {
    const raw = toApprovalView(ev, turns, room, roster);
    return raw ? { kind: "approval", body: "", raw } : null;
  }
  if (type === ElicitationEventType.Request)
    return { kind: "question", body: "", raw: ev };
  if (isZooidLifecycle(ev)) {
    const decoded = decodeZooidEvent(ev);
    if (decoded?.kind === "error") return { kind: "error", body: "", raw: decoded };
    // A turn renders once, at its first event; turn.end and the rest fold into it.
    const turn = turns.turnOf.get(ev.getId() ?? "");
    if (!turn || turn.anchorId !== ev.getId()) return null;
    const raw = toAgentTurn(turn, turns, room, roster);
    return raw.items.length > 0 ? { kind: "agent-turn", body: "", raw } : null;
  }
  return null;
}

function toAgentTurn(
  turn: TurnBuild,
  turns: TurnIndex,
  room: Room | null,
  roster: Roster | null,
): AgentTurn {
  return {
    id: turn.id,
    sessionId: turn.sessionId,
    agent: toActor(turn.sender, room, roster),
    threadRootId: turn.threadRootId,
    items: toTranscriptItems(turn.events, turns.approvalInputs),
    startedAt: turn.events[0]!.ts,
    endedAt: turn.endedAt,
  };
}

function toApprovalView(
  ev: MatrixEvent,
  turns: TurnIndex,
  room: Room | null,
  roster: Roster | null,
): ApprovalView | null {
  const request = decodeApprovalRequest(ev);
  if (!request) return null;
  // What the daemon would act on: the first response for this session's
  // approval from a non-agent. Agents never approve; a response naming another
  // session resolves nothing.
  const responseEv = (turns.responses.get(request.approvalId) ?? []).find(
    (r) =>
      (r.getContent() as { session_id?: unknown }).session_id === request.sessionId &&
      !roster?.isAgent(r.getSender() ?? "") &&
      r.getSender() !== ev.getSender(),
  );
  const response = responseEv ? decodeApprovalResponse(responseEv) : null;
  const ends = turns.ends.get(`${ev.getSender()}|${request.sessionId}`) ?? [];
  return {
    request,
    resolution:
      response && responseEv
        ? {
            decision: response.decision,
            optionId: response.optionId,
            respondedBy: response.respondedBy,
            respondedAt: responseEv.getTs(),
          }
        : null,
    expired: !response && ends.some((t) => t > ev.getTs()),
    viewerIsAgent: !!room && !!roster?.isAgent(room.myUserId),
  };
}

function toMessage(
  ev: MatrixEvent,
  room: Room | null,
  roster: Roster | null,
  index: RelationIndex,
  me: string | null,
): TimelineMessage | null {
  const base = classify(ev, room, roster, index);
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

/** Agent turns with no turn.end yet, oldest first. */
export function toOpenTurns(
  events: readonly MatrixEvent[],
  room: Room | null,
  roster: Roster | null,
): AgentTurn[] {
  const turns = indexTurns(events);
  const open = new Set([...turns.turnOf.values()].filter((t) => t.endedAt === null));
  return [...open].map((t) => toAgentTurn(t, turns, room, roster));
}
