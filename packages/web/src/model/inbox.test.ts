import type { MatrixEvent, Room } from "matrix-js-sdk";
import { describe, expect, it } from "vitest";
import { allRoomEvents } from "@/hooks/use-timeline";
import {
  makeFakeClient,
  makeMatrixEvent,
  makeRoom,
  pushTimelineEvent,
} from "../../test/factories";
import {
  mergeInboxItems,
  toMentions,
  toNeedsAction,
  toThreadActivity,
} from "./inbox";

const roomId = "!r:h.example";
const me = "@me:h.example";
const ana = "@ana:h.example";
const agent = "@coder:h.example";
const roster = { isAgent: (id: string) => id === agent };

let n = 0;
let ts = 1_000;
function ev(
  sender: string,
  type: string,
  content: Record<string, unknown>,
  eventId = `$e${++n}`,
): MatrixEvent {
  const e = makeMatrixEvent({ eventId, roomId, sender, type, content });
  e.event.origin_server_ts = ts += 1_000;
  return e;
}
const inThread = (root: string) => ({
  "m.relates_to": { rel_type: "m.thread", event_id: root },
});
const text = (
  sender: string,
  body: string,
  extra: Record<string, unknown> = {},
  id?: string,
) => ev(sender, "m.room.message", { msgtype: "m.text", body, ...extra }, id);

function roomWith(...events: MatrixEvent[]): Room {
  const room = makeRoom(roomId, {
    client: makeFakeClient({ userId: me }),
    myUserId: me,
  });
  for (const e of events) pushTimelineEvent(room, e);
  return room;
}

describe("toNeedsAction", () => {
  const request = (id: string) =>
    ev(agent, "dev.zooid.approval_request", {
      approval_id: id,
      session_id: "s1",
      tool_call_id: id,
      tool_title: "bash",
    });
  const question = (id: string) =>
    ev(agent, "dev.zooid.elicitation_request", {
      request_id: id,
      session_id: "s1",
      message: "Which branch?",
      requested_schema: { type: "object", properties: {} },
    });

  it("lists open approvals and questions, not answered or expired ones", () => {
    const answered = request("ap1");
    const room = roomWith(
      answered,
      ev(ana, "dev.zooid.approval_response", {
        approval_id: "ap1",
        session_id: "s1",
        decision: "allow",
      }),
      request("ap2"),
      question("q1"),
      text(ana, "hello"),
    );
    const items = toNeedsAction(allRoomEvents(room), room, roster);
    expect(items.map((i) => [i.message.kind, i.preview])).toEqual([
      ["approval", "Wants to use bash"],
      ["question", "Which branch?"],
    ]);
    expect(items[0]).toMatchObject({
      category: "needs_action",
      roomId,
      unread: true,
    });
  });

  it("drops an approval once the agent's turn ends and a question once its agent resolves it", () => {
    const q = question("q1");
    const room = roomWith(request("ap1"), q);
    pushTimelineEvent(
      room,
      ev(agent, "dev.zooid.turn.end", { session_id: "s1", agent_id: "coder" }),
    );
    pushTimelineEvent(
      room,
      ev(agent, "dev.zooid.elicitation_resolved", {
        request_id: "q1",
        request_event_id: q.getId(),
        status: "accepted",
      }),
    );
    expect(toNeedsAction(allRoomEvents(room), room, roster)).toEqual([]);
  });

  it("ignores a resolution from someone other than the asking agent", () => {
    const q = question("q1");
    const room = roomWith(
      q,
      ev(ana, "dev.zooid.elicitation_resolved", {
        request_id: "q1",
        request_event_id: q.getId(),
        status: "accepted",
      }),
    );
    expect(toNeedsAction(allRoomEvents(room), room, roster)).toHaveLength(1);
  });
});

describe("toThreadActivity", () => {
  it("lists threads I am in whose latest reply is someone else's and unread", () => {
    const mine = text(me, "my root", {}, "$mine");
    const other = text(ana, "ana's root", {}, "$other");
    const joined = text(ana, "root I replied to", {}, "$joined");
    const room = roomWith(
      mine,
      other,
      joined,
      text(ana, "reply to mine", inThread("$mine")),
      text(ana, "reply in ana's", inThread("$other")),
      text(me, "my reply", inThread("$joined")),
      text(ana, "after mine", inThread("$joined")),
    );
    const items = toThreadActivity(
      allRoomEvents(room),
      room,
      roster,
      () => false,
    );
    expect(items.map((i) => i.message.body)).toEqual([
      "reply to mine",
      "after mine",
    ]);
    expect(items[0]).toMatchObject({
      category: "activity",
      message: { threadRootId: "$mine" },
    });
  });

  it("skips read threads and threads where I replied last", () => {
    const reply = text(ana, "reply", inThread("$mine"));
    const room = roomWith(
      text(me, "root", {}, "$mine"),
      reply,
      text(me, "root 2", {}, "$mine2"),
      text(ana, "x", inThread("$mine2")),
      text(me, "y", inThread("$mine2")),
    );
    expect(
      toThreadActivity(
        allRoomEvents(room),
        room,
        roster,
        (id) => id === reply.getId(),
      ),
    ).toEqual([]);
  });
});

describe("toMentions and mergeInboxItems", () => {
  it("maps highlights with their read flag, and keeps one item per event, newest first", () => {
    const old = text(ana, "hi @me");
    const fresh = text(ana, "again @me");
    const room = roomWith(old, fresh);
    const mentions = toMentions(
      [
        { event: old, read: true },
        { event: fresh, read: false },
      ],
      room,
      roster,
    );
    expect(mentions.map((m) => [m.preview, m.unread])).toEqual([
      ["hi @me", false],
      ["again @me", true],
    ]);
    const merged = mergeInboxItems(mentions, [
      { ...mentions[0]!, category: "activity" },
    ]);
    expect(merged.map((m) => [m.preview, m.category])).toEqual([
      ["again @me", "mention"],
      ["hi @me", "mention"],
    ]);
  });
});
