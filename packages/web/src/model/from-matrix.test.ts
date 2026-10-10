import {
  EventStatus,
  MatrixError,
  type MatrixEvent,
  type Room,
} from "matrix-js-sdk";
import { describe, expect, it } from "vitest";
import { allRoomEvents } from "@/hooks/use-timeline";
import { QUOTE_FIELD, type QuoteRef } from "@/lib/matrix/quote";
import {
  injectStateEvent,
  makeFakeClient,
  makeMatrixEvent,
  makeRoom,
  mkMatrixEvent,
  pushTimelineEvent,
} from "../../test/factories";
import {
  toActor,
  toOpenTurns,
  toTimelineEntries,
  toTimelineMessages,
} from "./from-matrix";
import type { AgentTurn, ApprovalView } from "./agent-activity";

const roomId = "!r:h.example";
const me = "@me:h.example";
const ana = "@ana:h.example";
const agent = "@coder:h.example";
const roster = { isAgent: (id: string) => id === agent };

let n = 0;
function ev(
  sender: string,
  type: string,
  content: Record<string, unknown>,
  eventId = `$e${++n}`,
): MatrixEvent {
  return makeMatrixEvent({ eventId, roomId, sender, type, content });
}
const text = (
  sender: string,
  body: string,
  id?: string,
  extra: Record<string, unknown> = {},
) => ev(sender, "m.room.message", { msgtype: "m.text", body, ...extra }, id);

function roomWith(...events: MatrixEvent[]): Room {
  const room = makeRoom(roomId, {
    client: makeFakeClient({ userId: me }),
    myUserId: me,
  });
  for (const e of events) pushTimelineEvent(room, e);
  return room;
}

/** Maps every loaded event, as the timeline does. */
function entries(room: Room) {
  return toTimelineEntries(allRoomEvents(room), room, roster);
}

describe("toActor", () => {
  it("tells agents, the daemon and humans apart", () => {
    const room = roomWith();
    expect(toActor(agent, room, roster).kind).toBe("agent");
    expect(toActor("@zooid:h.example", room, roster).kind).toBe("system");
    expect(toActor(ana, null, roster)).toMatchObject({
      kind: "human",
      displayName: "ana",
      avatarUrl: null,
    });
  });

  it("labels an agent Persona · Project from the roster, project falling back to the space", () => {
    const room = roomWith();
    const withRoster = (entry: Record<string, string>) => ({
      ...roster,
      agent: (id: string) =>
        id === agent
          ? {
              userId: agent,
              name: "coder",
              role: undefined,
              avatarUrl: undefined,
              rooms: [],
              ...entry,
            }
          : undefined,
      spaceName: "Acme",
    });
    expect(
      toActor(
        agent,
        room,
        withRoster({ persona: "Coder", project: "Payments" }),
      ),
    ).toMatchObject({
      displayName: "Coder · Payments",
      persona: "Coder",
      project: "Payments",
    });
    expect(toActor(agent, room, withRoster({})).displayName).toBe(
      "coder · Acme",
    );
    expect(toActor(ana, room, withRoster({})).displayName).toBe("ana");
  });

  it("does not mark a zooid user from another server as system", () => {
    expect(toActor("@zooid:evil.example", roomWith(), roster).kind).toBe(
      "human",
    );
  });
});

describe("toTimelineEntries", () => {
  it("maps a text message", () => {
    const room = roomWith(text(ana, "hello", "$m"));
    expect(entries(room)).toEqual([
      {
        message: expect.objectContaining({
          id: "$m",
          kind: "message",
          body: "hello",
          author: expect.objectContaining({ id: ana, kind: "human" }),
          threadRootId: null,
          edited: false,
          pending: false,
          failed: false,
          redacted: false,
          reactions: [],
        }),
        thread: null,
      },
    ]);
  });

  it("aggregates reactions per emoji, once per sender, and marks mine", () => {
    const react = (sender: string, key: string) =>
      ev(sender, "m.reaction", {
        "m.relates_to": { rel_type: "m.annotation", event_id: "$m", key },
      });
    const mine = react(me, "👍");
    const room = roomWith(
      text(ana, "hi", "$m"),
      react(ana, "👍"),
      react(ana, "👍"),
      mine,
      react(agent, "🎉"),
    );
    const [entry] = entries(room);
    expect(entry.message.reactions).toEqual([
      {
        emoji: "👍",
        count: 2,
        reactedByMe: true,
        myEventId: mine.getId(),
        actorIds: [ana, me],
      },
      { emoji: "🎉", count: 1, reactedByMe: false, actorIds: [agent] },
    ]);
  });

  it("shows the latest edit from the original sender only", () => {
    const edit = (sender: string, body: string) =>
      ev(sender, "m.room.message", {
        msgtype: "m.text",
        body: `* ${body}`,
        "m.new_content": { msgtype: "m.text", body },
        "m.relates_to": { rel_type: "m.replace", event_id: "$m" },
      });
    const room = roomWith(
      text(ana, "helo", "$m"),
      edit(ana, "hello"),
      edit(me, "hijacked"),
    );
    const [entry] = entries(room).filter((e) => e.message.id === "$m");
    expect(entry.message).toMatchObject({ body: "hello", edited: true });
  });

  it("summarises a thread on its root", () => {
    const reply = (sender: string, body: string) =>
      text(sender, body, undefined, {
        "m.relates_to": { rel_type: "m.thread", event_id: "$root" },
      });
    const room = roomWith(
      text(ana, "root", "$root"),
      reply(agent, "a"),
      reply(ana, "b"),
      reply(agent, "c"),
    );
    const root = entries(room).find((e) => e.message.id === "$root")!;
    expect(root.thread).toMatchObject({ rootId: "$root", replyCount: 3 });
    expect(root.thread!.participants.map((p) => p.id)).toEqual([agent, ana]);
    const replies = entries(room).filter(
      (e) => e.message.threadRootId === "$root",
    );
    expect(replies).toHaveLength(3);
    expect(replies.every((e) => e.thread === null)).toBe(true);
  });

  it("counts only messages as thread replies, not the agent's turn events", () => {
    const inThread = {
      "m.relates_to": { rel_type: "m.thread", event_id: "$root" },
    };
    const root = text(ana, "root", "$root");
    // The server's bundled count includes the turn.end event.
    root.setUnsigned({ "m.relations": { "m.thread": { count: 2 } } });
    const room = roomWith(
      root,
      text(agent, "done", undefined, inThread),
      ev(agent, "dev.zooid.turn.end", { session_id: "s", ...inThread }),
    );
    const entry = entries(room).find((e) => e.message.id === "$root")!;
    expect(entry.thread).toMatchObject({ replyCount: 1 });
  });

  it("splits a quote's comment from its fallback", () => {
    const quote: QuoteRef = {
      room_id: roomId,
      event_id: "$q",
      thread_id: "$q",
      sender: ana,
      origin_server_ts: 0,
      snapshot: { msgtype: "m.text", body: "quoted" },
    };
    const room = roomWith(
      text(me, "my take\n\n> Ana · link\n> quoted", "$m", {
        [QUOTE_FIELD]: quote,
      }),
    );
    expect(entries(room)[0].message).toMatchObject({ body: "my take", quote });
  });

  it("maps media, membership and session breaks, and skips what renders nothing", () => {
    const room = roomWith(
      ev(ana, "m.room.message", {
        msgtype: "m.image",
        body: "dog.png",
        url: "mxc://h/abc",
        info: { mimetype: "image/png", size: 4 },
      }),
      mkMatrixEvent({
        roomId,
        sender: ana,
        type: "m.room.member",
        stateKey: ana,
        content: { membership: "join" },
      }),
      ev(agent, "dev.zooid.session_reset", {}),
      ev(agent, "dev.zooid.turn.start", { session_id: "s" }),
      ev(agent, "dev.zooid.approval_response", { request_id: "x" }),
      ev(ana, "m.room.message", { msgtype: "m.unknown", body: "?" }),
    );
    const kinds = entries(room).map((e) => e.message.kind);
    expect(kinds).toEqual(["message", "membership", "divider"]);
    const [image, joined] = entries(room).map((e) => e.message);
    expect(image.media).toEqual({
      mxc: "mxc://h/abc",
      mimetype: "image/png",
      name: "dog.png",
      size: 4,
      w: undefined,
      h: undefined,
    });
    expect(joined.body).toBe(`${ana} joined`);
  });

  it("keeps a redacted message as a tombstone", () => {
    const m = text(ana, "secret", "$m");
    (m as unknown as { isRedacted: () => boolean }).isRedacted = () => true;
    expect(toTimelineMessages([m], roomWith(m), roster)[0]).toMatchObject({
      kind: "message",
      redacted: true,
    });
  });

  it("treats our own pending redaction as deleted, reactions and all", () => {
    const m = text(ana, "secret", "$m");
    const react = ev(me, "m.reaction", {
      "m.relates_to": { rel_type: "m.annotation", event_id: "$m", key: "👍" },
    });
    const room = roomWith(m, react);
    m.markLocallyRedacted(ev(me, "m.room.redaction", { redacts: "$m" }));
    expect(entries(room)[0].message).toMatchObject({
      kind: "message",
      redacted: true,
      reactions: [],
    });
  });

  it("treats the target of a redaction in the room as deleted, even before the SDK flags it", () => {
    // Not added to a room, so the SDK never applies the redaction to $m.
    const m = text(ana, "secret", "$m");
    const [entry] = toTimelineEntries(
      [m, ev(ana, "m.room.redaction", { redacts: "$m" })],
      null,
      roster,
    );
    expect(m.isRedacted()).toBe(false);
    expect(entry.message).toMatchObject({ kind: "message", redacted: true });
  });

  // The fixture's redactions carry `redacts` in content only, so the SDK does not
  // apply them itself; these exercise the mapper's own redaction index.
  it("ignores a redaction from a member who may not redact others", () => {
    const room = roomWith(
      text(ana, "mine", "$m"),
      ev(agent, "m.room.redaction", { redacts: "$m" }),
    );
    expect(entries(room)[0].message.redacted).toBe(false);
  });

  it("honours a redaction from a member whose power level allows it", () => {
    const room = makeRoom(roomId, {
      client: makeFakeClient({ userId: me }),
      myUserId: me,
      powerLevels: { [agent]: 50 },
    });
    injectStateEvent(
      room,
      mkMatrixEvent({
        roomId,
        sender: agent,
        type: "m.room.member",
        stateKey: agent,
        content: { membership: "join" },
      }),
    );
    pushTimelineEvent(room, text(ana, "mine", "$m"));
    pushTimelineEvent(room, ev(agent, "m.room.redaction", { redacts: "$m" }));
    expect(entries(room)[0].message.redacted).toBe(true);
  });

  it("honours an author redacting their own message", () => {
    const room = roomWith(
      text(ana, "mine", "$m"),
      ev(ana, "m.room.redaction", { redacts: "$m" }),
    );
    expect(entries(room)[0].message.redacted).toBe(true);
  });

  it("drops a reaction we are taking back", () => {
    const react = ev(me, "m.reaction", {
      "m.relates_to": { rel_type: "m.annotation", event_id: "$m", key: "👍" },
    });
    const room = roomWith(text(ana, "hi", "$m"), react);
    react.markLocallyRedacted(
      ev(me, "m.room.redaction", { redacts: react.getId() }),
    );
    expect(entries(room)[0].message.reactions).toEqual([]);
  });

  it("marks a rejected send failed, with a readable reason", () => {
    const m = text(me, "hi", "~txn");
    m.setStatus(EventStatus.NOT_SENT);
    m.error = new MatrixError(
      {
        errcode: "M_FORBIDDEN",
        error: "sender's membership 'invite' is not 'join'",
      },
      403,
    );
    expect(toTimelineMessages([m], null, roster)[0]).toMatchObject({
      failed: true,
      failedReason: "You're not a member of this room yet",
    });
  });
});

describe("agent turns", () => {
  const ROOT = "$root";
  let ts = 1_000;
  /** An agent event in the thread, each one later than the last. */
  function zev(
    type: string,
    content: Record<string, unknown>,
    sender = agent,
  ): MatrixEvent {
    const e = ev(sender, type, {
      ...content,
      "m.relates_to": { rel_type: "m.thread", event_id: ROOT },
    });
    e.event.origin_server_ts = ts += 1_000;
    return e;
  }
  const call = (id: string, session = "s1") =>
    zev("dev.zooid.tool_call", {
      session_id: session,
      tool_call_id: id,
      title: id,
      kind: "execute",
    });
  const done = (id: string) =>
    zev("dev.zooid.tool_call_update", {
      session_id: "s1",
      tool_call_id: id,
      status: "completed",
    });
  const end = (session = "s1") =>
    zev("dev.zooid.turn.end", { session_id: session, agent_id: "coder" });
  const turns = (room: Room) =>
    entries(room)
      .filter((e) => e.message.kind === "agent-turn")
      .map((e) => e.message.raw as AgentTurn);

  it("groups a turn's tool calls into one row at its first event", () => {
    const room = roomWith(call("a"), done("a"), call("b"), end());
    const rows = entries(room);
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toMatchObject({
      kind: "agent-turn",
      author: expect.objectContaining({ id: agent }),
    });
    const turn = rows[0].message.raw as AgentTurn;
    expect(turn.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(turn).toMatchObject({
      threadRootId: ROOT,
      sessionId: "s1",
      endedAt: expect.any(Number),
    });
  });

  it("starts a new turn after turn.end, and keeps sessions apart", () => {
    const room = roomWith(call("a"), end(), call("b"), call("c", "s2"));
    expect(
      turns(room).map((t) => [
        t.sessionId,
        t.items.map((i) => i.id),
        t.endedAt !== null,
      ]),
    ).toEqual([
      ["s1", ["a"], true],
      ["s1", ["b"], false],
      ["s2", ["c"], false],
    ]);
  });

  it("lists the turns still running", () => {
    const room = roomWith(call("a"), end(), call("b"));
    expect(
      toOpenTurns(allRoomEvents(room), room, roster).map((t) => t.items[0]?.id),
    ).toEqual(["b"]);
  });

  it("resolves an approval from its response, with who and when", () => {
    const req = zev("dev.zooid.approval_request", {
      approval_id: "ap1",
      session_id: "s1",
      tool_call_id: "a",
    });
    const res = zev(
      "dev.zooid.approval_response",
      { approval_id: "ap1", session_id: "s1", decision: "allow" },
      ana,
    );
    const view = entries(roomWith(req, res))[0].message.raw as ApprovalView;
    expect(view.resolution).toEqual({
      decision: "allow",
      optionId: undefined,
      respondedBy: ana,
      respondedAt: res.getTs(),
    });
    expect(view.expired).toBe(false);
  });

  it("ignores responses from agents and for another session", () => {
    const req = zev("dev.zooid.approval_request", {
      approval_id: "ap1",
      session_id: "s1",
      tool_call_id: "a",
    });
    const byAgent = zev("dev.zooid.approval_response", {
      approval_id: "ap1",
      session_id: "s1",
      decision: "allow",
    });
    const otherSession = zev(
      "dev.zooid.approval_response",
      { approval_id: "ap1", session_id: "s2", decision: "allow" },
      ana,
    );
    const room = roomWith(req, byAgent, otherSession);
    expect(
      (entries(room)[0].message.raw as ApprovalView).resolution,
    ).toBeNull();
    const real = zev(
      "dev.zooid.approval_response",
      { approval_id: "ap1", session_id: "s1", decision: "cancel" },
      ana,
    );
    pushTimelineEvent(room, real);
    expect(
      (entries(room)[0].message.raw as ApprovalView).resolution,
    ).toMatchObject({ decision: "cancel", respondedBy: ana });
  });

  it("expires an unanswered approval once the agent's turn ends", () => {
    const earlier = end();
    const req = zev("dev.zooid.approval_request", {
      approval_id: "ap1",
      session_id: "s1",
      tool_call_id: "a",
    });
    const room = roomWith(earlier, req);
    expect((entries(room)[0].message.raw as ApprovalView).expired).toBe(false);
    pushTimelineEvent(room, end());
    expect((entries(room)[0].message.raw as ApprovalView).expired).toBe(true);
  });

  it("tells the approval card when the viewer is an agent", () => {
    const req = zev("dev.zooid.approval_request", {
      approval_id: "ap1",
      session_id: "s1",
      tool_call_id: "a",
    });
    const room = roomWith(req);
    const asAgent = toTimelineEntries(allRoomEvents(room), room, {
      isAgent: () => true,
    });
    expect((asAgent[0].message.raw as ApprovalView).viewerIsAgent).toBe(true);
  });
});
