import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomStateEvent } from "matrix-js-sdk";
import { injectStateEvent, makeFakeClient, makeRoom, mkMatrixEvent } from "../../test/factories";
import { MatrixClientPeg } from "../client/peg";
import { subscribeRoomState } from "./matrix-subscriptions";

const me = "@me:h.example";
const roomId = "!r:h.example";
afterEach(() => MatrixClientPeg.reset());

describe("subscribeRoomState", () => {
  it("keeps hearing state changes after a limited sync forks the live timeline", () => {
    const client = makeFakeClient({ userId: me });
    const room = makeRoom(roomId, { client, myUserId: me, timelineSupport: true });
    (client as unknown as { getRoom: (id: string) => unknown }).getRoom = (id) =>
      id === roomId ? room : null;
    MatrixClientPeg.injectClientForTest(client);
    const cb = vi.fn();
    const unsub = subscribeRoomState(roomId, [RoomStateEvent.Events], cb);

    const before = room.currentState;
    // What the sync loop does on a limited timeline with timelineSupport on.
    room.resetLiveTimeline("prev", "old-sync-token");
    expect(room.currentState).not.toBe(before);
    cb.mockClear();

    injectStateEvent(
      room,
      mkMatrixEvent({ roomId, sender: me, type: "m.room.avatar", stateKey: "", content: { url: "mxc://h/a" } }),
    );
    expect(cb).toHaveBeenCalled();
    unsub();
  });
});
