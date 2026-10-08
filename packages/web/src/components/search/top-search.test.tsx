import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Room } from "matrix-js-sdk";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFakeClient, makeRoom } from "../../../test/factories";
import { MatrixClientPeg } from "@/client/peg";
import { focusTopSearch, TopSearch } from "./top-search";

const me = "@me:h";

function setup(
  search: ReturnType<typeof vi.fn> = vi.fn(async () => ({
    search_categories: { room_events: { results: [] } },
  })),
) {
  const client = makeFakeClient({ userId: me });
  const rooms = ["general", "design"].map((name) => {
    const room = makeRoom(`!${name}:h`, { client, myUserId: me });
    const r = room as unknown as Record<string, unknown>;
    r.getMyMembership = () => "join";
    r.name = name;
    return room;
  });
  const cast = client as unknown as Record<string, unknown>;
  cast.getRooms = () => rooms;
  cast.getRoom = (id: string) =>
    rooms.find((r: Room) => r.roomId === id) ?? null;
  cast.publicRooms = vi.fn(async () => ({ chunk: [] }));
  cast.search = search;
  MatrixClientPeg.injectClientForTest(client);
  return search;
}

function Location() {
  const { pathname, search } = useLocation();
  return <span data-testid="location">{pathname + search}</span>;
}

function renderSearch(at = "/") {
  render(
    <MemoryRouter initialEntries={[at]}>
      <TopSearch />
      <Routes>
        <Route path="*" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByRole("combobox", { name: "Search" });
}

afterEach(() => MatrixClientPeg.reset());

describe("<TopSearch>", () => {
  it("⌘G focus opens recent rooms", () => {
    setup();
    renderSearch();
    act(() => focusTopSearch());
    expect(screen.getByTestId("top-search-results")).toHaveTextContent(
      "Recent",
    );
    expect(screen.getByRole("option", { name: /general/ })).toBeInTheDocument();
  });

  it("matches rooms and messages; Enter opens the selected message at its event", async () => {
    const search = setup(
      vi.fn(async () => ({
        search_categories: {
          room_events: {
            results: [
              {
                rank: 1,
                context: {},
                result: {
                  event_id: "$hit",
                  room_id: "!design:h",
                  sender: "@bob:h",
                  origin_server_ts: 1,
                  type: "m.room.message",
                  content: { msgtype: "m.text", body: "the design review" },
                },
              },
            ],
          },
        },
      })),
    );
    const input = renderSearch();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "design" } });

    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: /the design review/ }),
      ).toBeInTheDocument(),
    );
    expect(search).toHaveBeenCalled();
    // Options: room "design", the message, "See all results".
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/room/!design:h?event=%24hit",
    );
  });

  it("in a room, the first option scopes the search to it and See all keeps the scope", async () => {
    setup();
    const input = renderSearch("/room/!general:h");
    fireEvent.focus(input);
    fireEvent.click(screen.getByTestId("search-current-room-action"));
    expect(
      screen.getByRole("combobox", { name: "Search in #general" }),
    ).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "plan" } });
    await waitFor(() =>
      expect(screen.getByText(/No messages match/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("option", { name: "See all results" }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/search?q=${encodeURIComponent("in:!general:h plan")}`,
    );
  });

  it("says so when the server has no search", async () => {
    setup(
      vi.fn(async () => {
        throw Object.assign(new Error("no"), {
          errcode: "M_UNRECOGNIZED",
          httpStatus: 404,
        });
      }),
    );
    const input = renderSearch();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "hello" } });
    await waitFor(() =>
      expect(
        screen.getByText("Search is not supported by this server."),
      ).toBeInTheDocument(),
    );
  });
});
