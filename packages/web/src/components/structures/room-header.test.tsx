import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { injectStateEvent, makeFakeClient, makeRoom, mkMatrixEvent } from "../../../test/factories";
import { MatrixClientPeg } from "../../client/peg";
import { RoomHeader } from "./room-header";

const me = "@me:h.example";
const roomId = "!r:h.example";
afterEach(() => MatrixClientPeg.reset());

function setup(myPL: number) {
  const client = makeFakeClient({ userId: me });
  const room = makeRoom(roomId, { client, myUserId: me, powerLevels: { [me]: myPL } });
  injectStateEvent(
    room,
    mkMatrixEvent({
      roomId,
      sender: "@admin:h.example",
      type: "m.room.power_levels",
      stateKey: "",
      content: { users: { [me]: myPL }, invite: 50, state_default: 50, events_default: 0 },
    }),
  );
  const members = [{ userId: me, name: "me", membership: "join" }];
  (room as unknown as { getJoinedMembers: () => unknown[] }).getJoinedMembers = () => members;
  (client as unknown as { getRoom: (id: string) => unknown }).getRoom = (id) =>
    id === roomId ? room : null;
  (client as unknown as { getUser: (id: string) => unknown }).getUser = () => null;
  MatrixClientPeg.injectClientForTest(client);
  return room;
}

describe("<RoomHeader> favorite star", () => {
  it("renders an unstarred toggle for an untagged room", () => {
    setup(50);
    render(
      <MemoryRouter initialEntries={[`/room/${roomId}`]}>
        <Routes>
          <Route path="/room/:roomId" element={<RoomHeader />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /add to favorites/i })).toBeInTheDocument();
  });

  it("calls setRoomTag when the star is clicked on an unfavorited room", async () => {
    const room = setup(50);
    const setRoomTag = vi.fn(async () => undefined);
    const client = MatrixClientPeg.safeGet();
    (client as unknown as { setRoomTag: typeof setRoomTag }).setRoomTag = setRoomTag;
    void room;
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/room/${roomId}`]}>
        <Routes>
          <Route path="/room/:roomId" element={<RoomHeader />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: /add to favorites/i }));
    expect(setRoomTag).toHaveBeenCalledWith(
      roomId,
      "m.favourite",
      expect.objectContaining({ order: expect.any(Number) }),
    );
  });

  it("renders a starred toggle for a favorited room", () => {
    const room = setup(50);
    (room as unknown as { tags: Record<string, unknown> }).tags = {
      "m.favourite": { order: 0.5 },
    };
    render(
      <MemoryRouter initialEntries={[`/room/${roomId}`]}>
        <Routes>
          <Route path="/room/:roomId" element={<RoomHeader />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /remove from favorites/i })).toBeInTheDocument();
  });
});

function setupRoom(opts: { myLevel: number; joinRule?: string }) {
  const client = makeFakeClient({ userId: me });
  const room = makeRoom(roomId, { client, myUserId: me, powerLevels: { [me]: opts.myLevel } });
  injectStateEvent(
    room,
    mkMatrixEvent({
      roomId,
      sender: "@admin:h.example",
      type: "m.room.power_levels",
      stateKey: "",
      content: { users: { [me]: opts.myLevel }, invite: 50, state_default: 50, events_default: 0 },
    }),
  );
  if (opts.joinRule) {
    injectStateEvent(
      room,
      mkMatrixEvent({
        roomId,
        sender: "@admin:h.example",
        type: "m.room.join_rules",
        stateKey: "",
        content: { join_rule: opts.joinRule },
      }),
    );
  }
  const members = [{ userId: me, name: "me", membership: "join" }];
  Object.assign(room as unknown as Record<string, unknown>, {
    getJoinedMembers: () => members,
    name: "Design",
    getJoinedMemberCount: () => 1,
  });
  (client as unknown as { getRoom: (id: string) => unknown }).getRoom = (id) =>
    id === roomId ? room : null;
  (client as unknown as { getUser: (id: string) => unknown }).getUser = () => null;
  MatrixClientPeg.injectClientForTest(client);
  return room;
}

function renderHeader() {
  render(
    <MemoryRouter initialEntries={[`/room/${roomId}`]}>
      <Routes>
        <Route path="/room/:roomId" element={<RoomHeader />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("<RoomHeader> glyph and status", () => {
  it("marks an invite-only room with the private glyph", () => {
    setupRoom({ myLevel: 0, joinRule: "invite" });
    renderHeader();
    expect(screen.getByLabelText("Private")).toBeInTheDocument();
  });

  it("shows no private glyph for a public room", () => {
    setupRoom({ myLevel: 0, joinRule: "public" });
    renderHeader();
    expect(screen.queryByLabelText("Private")).toBeNull();
  });

  it("marks archived and encrypted rooms", () => {
    const room = setupRoom({ myLevel: 0, joinRule: "public" });
    injectStateEvent(
      room,
      mkMatrixEvent({ roomId, sender: "@a:h.example", type: "m.room.tombstone", stateKey: "", content: { body: "moved", replacement_room: "!new:h.example" } }),
    );
    injectStateEvent(
      room,
      mkMatrixEvent({ roomId, sender: "@a:h.example", type: "m.room.encryption", stateKey: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }),
    );
    renderHeader();
    expect(screen.getByLabelText(/archived/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/end-to-end encrypted/i)).toBeInTheDocument();
  });
});

describe("<RoomHeader> members toggle", () => {
  it("calls onToggleMembers when the member count is clicked", async () => {
    setup(50);
    const onToggleMembers = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/room/${roomId}`]}>
        <Routes>
          <Route
            path="/room/:roomId"
            element={<RoomHeader onToggleMembers={onToggleMembers} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: /\d+ member/i }));
    expect(onToggleMembers).toHaveBeenCalledTimes(1);
  });
});

describe("<RoomHeader> Slack layout", () => {
  it("opens the panel home when the room name is clicked; no dropdown menu", async () => {
    const room = setupRoom({ myLevel: 50 });
    const onToggleInfo = vi.fn();
    render(
      <MemoryRouter initialEntries={[`/room/${roomId}`]}>
        <Routes>
          <Route path="/room/:roomId" element={<RoomHeader onToggleInfo={onToggleInfo} />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: room.name }));
    expect(onToggleInfo).toHaveBeenCalled();
    expect(screen.queryByText(/leave room/i)).toBeNull();
  });

  it("opens the panel via the room details button", async () => {
    setupRoom({ myLevel: 50 });
    const onToggleInfo = vi.fn();
    render(
      <MemoryRouter initialEntries={[`/room/${roomId}`]}>
        <Routes>
          <Route path="/room/:roomId" element={<RoomHeader onToggleInfo={onToggleInfo} infoOpen />} />
        </Routes>
      </MemoryRouter>,
    );
    const details = screen.getByRole("button", { name: /room details/i });
    expect(details).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(details);
    expect(onToggleInfo).toHaveBeenCalled();
  });

  it("does not render a room avatar or inline topic in the header bar", () => {
    const room = setupRoom({ myLevel: 50 });
    injectStateEvent(
      room,
      mkMatrixEvent({ roomId, sender: "@a:h.example", type: "m.room.topic", stateKey: "", content: { topic: "ship it" } }),
    );
    render(
      <MemoryRouter initialEntries={[`/room/${roomId}`]}>
        <Routes>
          <Route path="/room/:roomId" element={<RoomHeader />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText("ship it")).toBeNull();
  });
});

describe("<RoomHeader> room image", () => {
  it("swaps the # glyph for the room image when one is set", async () => {
    const room = setup(50);
    const { container } = render(
      <MemoryRouter initialEntries={[`/room/${roomId}`]}>
        <Routes>
          <Route path="/room/:roomId" element={<RoomHeader />} />
        </Routes>
      </MemoryRouter>,
    );
    const roomImage = () => container.querySelector(`header img[alt="${room.name}"]`);
    expect(roomImage()).toBeNull();
    act(() =>
      injectStateEvent(
        room,
        mkMatrixEvent({
          roomId,
          sender: me,
          type: "m.room.avatar",
          stateKey: "",
          content: { url: "mxc://h.example/new" },
        }),
      ),
    );
    expect(roomImage()).not.toBeNull();
  });
});
