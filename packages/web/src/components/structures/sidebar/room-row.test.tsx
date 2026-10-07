import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { NotificationCountType } from "matrix-js-sdk";
import { makeFakeClient, makeRoom } from "../../../../test/factories";
import { MatrixClientPeg } from "../../../client/peg";
import { RoomRow } from "./room-row";

const me = "@me:h.example";
afterEach(() => MatrixClientPeg.reset());

describe("<RoomRow>", () => {
  it("toggles the m.favourite tag from the context menu", async () => {
    const setTag = vi.fn(async () => undefined);
    const deleteTag = vi.fn(async () => undefined);
    const client = makeFakeClient({ userId: me });
    const room = makeRoom("!r:h.example", { client, myUserId: me });
    (room as unknown as { name: string }).name = "general";
    (client as unknown as { setRoomTag: typeof setTag }).setRoomTag = setTag;
    (client as unknown as { deleteRoomTag: typeof deleteTag }).deleteRoomTag = deleteTag;
    MatrixClientPeg.injectClientForTest(client);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RoomRow room={room} />
      </MemoryRouter>,
    );

    fireEvent.contextMenu(screen.getByRole("link", { name: /general/ }));
    await user.click(await screen.findByRole("menuitem", { name: /add to favorites/i }));
    await waitFor(() => expect(setTag).toHaveBeenCalledWith("!r:h.example", "m.favourite", { order: 0.5 }));
  });
});

function unreadRoom(total: number, highlight: number) {
  const client = makeFakeClient({ userId: me });
  const room = makeRoom("!r:h.example", { client, myUserId: me });
  (room as unknown as { name: string }).name = "general";
  (room as unknown as { getUnreadNotificationCount: (t: string) => number }).getUnreadNotificationCount = (t) =>
    t === NotificationCountType.Total ? total : t === NotificationCountType.Highlight ? highlight : 0;
  (client as unknown as { getRoom: (id: string) => unknown }).getRoom = () => room;
  MatrixClientPeg.injectClientForTest(client);
  return room;
}

describe("<RoomRow> unread", () => {
  it("counts mentions in a channel", () => {
    const room = unreadRoom(4, 1);
    render(
      <MemoryRouter>
        <RoomRow room={room} />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("4 unread")).toBeInTheDocument();
  });

  it("shows plain channel unread as bold text, without a count", () => {
    const room = unreadRoom(4, 0);
    render(
      <MemoryRouter>
        <RoomRow room={room} />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText("4 unread")).toBeNull();
    expect(screen.getByRole("listitem")).toHaveAttribute("data-unread", "true");
  });

  it("always counts unread in a DM", () => {
    const room = unreadRoom(2, 0);
    render(
      <MemoryRouter>
        <RoomRow room={room} isDm />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("2 unread")).toBeInTheDocument();
  });

  it("renders the room name in bold when unread", () => {
    const client = makeFakeClient({ userId: me });
    const room = makeRoom("!r:h.example", { client, myUserId: me });
    (room as unknown as { name: string }).name = "general";
    (room as unknown as { getUnreadNotificationCount: (t: string) => number }).getUnreadNotificationCount =
      (t) => (t === NotificationCountType.Total ? 1 : 0);
    (client as unknown as { getRoom: (id: string) => unknown }).getRoom = () => room;
    MatrixClientPeg.injectClientForTest(client);

    render(
      <MemoryRouter>
        <RoomRow room={room} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /general/ }).className).toMatch(/font-semibold/);
  });

  it("does not render a badge when unread is 0", () => {
    const client = makeFakeClient({ userId: me });
    const room = makeRoom("!r:h.example", { client, myUserId: me });
    (room as unknown as { name: string }).name = "general";
    (room as unknown as { getUnreadNotificationCount: () => number }).getUnreadNotificationCount = () => 0;
    (client as unknown as { getRoom: (id: string) => unknown }).getRoom = () => room;
    MatrixClientPeg.injectClientForTest(client);

    render(
      <MemoryRouter>
        <RoomRow room={room} />
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText(/unread/i)).toBeNull();
  });
});
