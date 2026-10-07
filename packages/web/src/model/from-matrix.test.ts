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
import { toActor, toTimelineEntries, toTimelineMessages } from "./from-matrix";

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
    expect(toActor(ana, null, roster)).toMatchObject({ kind: "human", displayName: "ana", avatarUrl: null });
  });

  it("does not mark a zooid user from another server as system", () => {
    expect(toActor("@zooid:evil.example", roomWith(), roster).kind).toBe("human");
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
      mkMatrixEvent({ roomId, sender: ana, type: "m.room.member", stateKey: ana, content: { membership: "join" } }),
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
    const react = ev(me, "m.reaction", { "m.relates_to": { rel_type: "m.annotation", event_id: "$m", key: "👍" } });
    const room = roomWith(m, react);
    m.markLocallyRedacted(ev(me, "m.room.redaction", { redacts: "$m" }));
    expect(entries(room)[0].message).toMatchObject({ kind: "message", redacted: true, reactions: [] });
  });

  it("treats the target of a redaction in the room as deleted, even before the SDK flags it", () => {
    // Not added to a room, so the SDK never applies the redaction to $m.
    const m = text(ana, "secret", "$m");
    const [entry] = toTimelineEntries([m, ev(ana, "m.room.redaction", { redacts: "$m" })], null, roster);
    expect(m.isRedacted()).toBe(false);
    expect(entry.message).toMatchObject({ kind: "message", redacted: true });
  });

  // The fixture's redactions carry `redacts` in content only, so the SDK does not
  // apply them itself; these exercise the mapper's own redaction index.
  it("ignores a redaction from a member who may not redact others", () => {
    const room = roomWith(text(ana, "mine", "$m"), ev(agent, "m.room.redaction", { redacts: "$m" }));
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
      mkMatrixEvent({ roomId, sender: agent, type: "m.room.member", stateKey: agent, content: { membership: "join" } }),
    );
    pushTimelineEvent(room, text(ana, "mine", "$m"));
    pushTimelineEvent(room, ev(agent, "m.room.redaction", { redacts: "$m" }));
    expect(entries(room)[0].message.redacted).toBe(true);
  });

  it("honours an author redacting their own message", () => {
    const room = roomWith(text(ana, "mine", "$m"), ev(ana, "m.room.redaction", { redacts: "$m" }));
    expect(entries(room)[0].message.redacted).toBe(true);
  });

  it("drops a reaction we are taking back", () => {
    const react = ev(me, "m.reaction", { "m.relates_to": { rel_type: "m.annotation", event_id: "$m", key: "👍" } });
    const room = roomWith(text(ana, "hi", "$m"), react);
    react.markLocallyRedacted(ev(me, "m.room.redaction", { redacts: react.getId() }));
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
