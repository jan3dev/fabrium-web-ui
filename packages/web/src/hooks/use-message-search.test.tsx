import { renderHook, waitFor } from "@testing-library/react";
import { EventType, type Room } from "matrix-js-sdk";
import { mkMatrixEvent } from "matrix-js-sdk/lib/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFakeClient, makeRoom } from "../../test/factories";
import { MatrixClientPeg } from "../client/peg";
import { messageHitPath, useMessageSearch } from "./use-message-search";

const me = "@me:h";

function joined(room: Room, name: string, encrypted = false): Room {
  const r = room as unknown as Record<string, unknown>;
  r.getMyMembership = () => "join";
  r.name = name;
  if (encrypted) r.hasEncryptionStateEvent = () => true;
  return room;
}

function setup(search: ReturnType<typeof vi.fn>) {
  const client = makeFakeClient({ userId: me });
  const general = joined(makeRoom("!g:h", { client, myUserId: me }), "general");
  const secret = joined(
    makeRoom("!s:h", { client, myUserId: me }),
    "secret",
    true,
  );
  general.currentState.setStateEvents([
    mkMatrixEvent({
      roomId: "!g:h",
      sender: "@bob:h",
      type: EventType.RoomMember,
      stateKey: "@bob:h",
      content: { membership: "join", displayname: "Bob" },
    }),
  ]);
  const cast = client as unknown as Record<string, unknown>;
  cast.getRooms = () => [general, secret];
  cast.getRoom = (id: string) =>
    [general, secret].find((r) => r.roomId === id) ?? null;
  cast.search = search;
  MatrixClientPeg.injectClientForTest(client);
}

function hit(
  eventId: string,
  body: string,
  relatesTo?: Record<string, unknown>,
) {
  return {
    rank: 1,
    context: {},
    result: {
      event_id: eventId,
      room_id: "!g:h",
      sender: "@bob:h",
      origin_server_ts: 1000,
      type: "m.room.message",
      content: {
        msgtype: "m.text",
        body,
        ...(relatesTo ? { "m.relates_to": relatesTo } : {}),
      },
    },
  };
}

const roomEvents = (search: ReturnType<typeof vi.fn>) =>
  search.mock.calls.at(-1)![0].body.search_categories.room_events;

afterEach(() => MatrixClientPeg.reset());

describe("useMessageSearch", () => {
  it("searches unencrypted joined rooms and maps hits, dropping edits", async () => {
    const search = vi.fn(async () => ({
      search_categories: {
        room_events: {
          results: [
            hit("$1", "pineapple"),
            hit("$2", "* pineapple", { rel_type: "m.replace", event_id: "$1" }),
            hit("$3", "in a thread", {
              rel_type: "m.thread",
              event_id: "$root",
            }),
          ],
        },
      },
    }));
    setup(search);

    const { result } = renderHook(() => useMessageSearch("pine"));
    await waitFor(() => expect(result.current.status).toBe("done"));

    expect(roomEvents(search)).toMatchObject({
      search_term: "pine",
      order_by: "recent",
      filter: { rooms: ["!g:h"] },
    });
    expect(roomEvents(search).filter.senders).toBeUndefined();
    expect(result.current.hits.map((h) => h.id)).toEqual(["$1", "$3"]);
    expect(result.current.hits[0]).toMatchObject({
      roomName: "general",
      author: { id: "@bob:h", displayName: "Bob" },
    });
    expect(messageHitPath(result.current.hits[1])).toBe(
      "/room/!g:h?thread=%24root&event=%243",
    );
  });

  it("maps in: and from: onto the filter", async () => {
    const search = vi.fn(async () => ({
      search_categories: { room_events: { results: [] } },
    }));
    setup(search);

    const { result } = renderHook(() =>
      useMessageSearch("deploy in:#general from:bob"),
    );
    await waitFor(() => expect(result.current.status).toBe("done"));

    expect(roomEvents(search)).toMatchObject({
      search_term: "deploy",
      filter: { rooms: ["!g:h"], senders: ["@bob:h"] },
    });
    expect(result.current.term).toBe("deploy");
  });

  it("an in: that matches no searchable room returns nothing without asking the server", async () => {
    const search = vi.fn();
    setup(search);

    const { result } = renderHook(() => useMessageSearch("x in:#secret"));
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(search).not.toHaveBeenCalled();
    expect(result.current.hits).toEqual([]);
  });

  it("reports unsupported when the server does not know /search", async () => {
    const search = vi.fn(async () => {
      throw Object.assign(new Error("Unrecognized request"), {
        errcode: "M_UNRECOGNIZED",
        httpStatus: 400,
      });
    });
    setup(search);

    const { result } = renderHook(() => useMessageSearch("hello"));
    await waitFor(() => expect(result.current.status).toBe("unsupported"));
  });

  it("stays idle for an empty term", () => {
    const search = vi.fn();
    setup(search);
    const { result } = renderHook(() => useMessageSearch("from:@bob:h"));
    expect(result.current.status).toBe("idle");
    expect(search).not.toHaveBeenCalled();
  });
});
