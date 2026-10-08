import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MatrixClientPeg } from "../client/peg";
import { WorkforceSpaceContext } from "../hooks/use-workforce";
import {
  ALICE,
  CODER,
  ROOM,
  SPACE,
  seedPeopleClient,
} from "./structures/member-row.stories";
import { UserProfilePopover } from "./user-profile-popover";

afterEach(() => MatrixClientPeg.reset());

function renderPopover(userId: string) {
  render(
    <WorkforceSpaceContext.Provider value={SPACE}>
      <MemoryRouter>
        <Routes>
          <Route
            path="/"
            element={
              <UserProfilePopover userId={userId} roomId={ROOM}>
                <button type="button">open</button>
              </UserProfilePopover>
            }
          />
          <Route
            path="/room/:roomId"
            element={<div data-testid="room-page" />}
          />
        </Routes>
      </MemoryRouter>
    </WorkforceSpaceContext.Provider>,
  );
  return userEvent.click(screen.getByRole("button", { name: "open" }));
}

describe("<UserProfilePopover>", () => {
  it("shows an agent's persona, project and rooms, and no new-DM button", async () => {
    seedPeopleClient();
    await renderPopover(CODER);
    expect(screen.getByText("Coder · Payments")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "payments" })).toHaveAttribute(
      "href",
      `/room/${ROOM}`,
    );
    expect(screen.queryByRole("button", { name: /message/i })).toBeNull();
  });

  it("creates a DM with a person and opens it, whatever another space's roster claims", async () => {
    seedPeopleClient();
    const client = MatrixClientPeg.get() as unknown as Record<string, unknown>;
    client.createRoom = vi.fn(async () => ({ room_id: "!dm:h.example" }));
    client.setAccountData = vi.fn(async () => undefined);
    await renderPopover(ALICE);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Agent")).toBeNull();
    expect(screen.queryByText(/Security/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /message/i }));
    await waitFor(() =>
      expect(screen.getByTestId("room-page")).toBeInTheDocument(),
    );
    expect(client.createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ is_direct: true, invite: [ALICE] }),
    );
  });
});
