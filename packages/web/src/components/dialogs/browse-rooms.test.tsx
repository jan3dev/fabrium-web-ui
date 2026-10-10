import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { makeFakeClient } from "../../../test/factories";
import { MatrixClientPeg } from "../../client/peg";
import { BrowseRoomsDialog } from "./browse-rooms";

const SPACE_ID = "!space:h.example";
afterEach(() => MatrixClientPeg.reset());

it("filters by name or topic and joins the picked room, then closes", async () => {
  const client = makeFakeClient({ userId: "@me:h.example" });
  const joinRoom = vi.fn(async (id: string) => ({ roomId: id }));
  Object.assign(client as unknown as Record<string, unknown>, {
    getRoom: () => null,
    joinRoom,
    getRoomHierarchy: async () => ({
      rooms: [
        { room_id: SPACE_ID, name: "Acme", room_type: "m.space" },
        { room_id: "!general:h.example", name: "general", num_joined_members: 4 },
        { room_id: "!ops:h.example", name: "ops", topic: "deploys", num_joined_members: 3 },
      ],
    }),
  });
  MatrixClientPeg.injectClientForTest(client);
  const onOpenChange = vi.fn();
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<BrowseRoomsDialog open spaceId={SPACE_ID} onOpenChange={onOpenChange} />} />
        <Route path="/room/:roomId" element={<div data-testid="room-page" />} />
      </Routes>
    </MemoryRouter>,
  );

  await user.type(await screen.findByPlaceholderText(/search rooms/i), "deploy");
  expect(screen.queryByRole("listitem", { name: "general" })).not.toBeInTheDocument();
  await screen.findByRole("listitem", { name: "ops" });
  await user.keyboard("{Enter}");

  await waitFor(() => expect(joinRoom).toHaveBeenCalledWith("!ops:h.example"));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(screen.getByTestId("room-page")).toBeInTheDocument();
});
