import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import {
  makeFakeClient,
  makeMatrixEvent,
  makeRoom,
  pushTimelineEvent,
} from "../../../test/factories";
import { MatrixClientPeg } from "../../client/peg";
import { TimelinePanel } from "./timeline-panel";

const me = "@me:h.example";
const ana = "@ana:h.example";
const roomId = "!r:h.example";
afterEach(() => MatrixClientPeg.reset());

function seed(
  bodies: Array<[id: string, sender: string]>,
  opts: { readUpTo?: string } = {},
) {
  const client = makeFakeClient({ userId: me });
  const room = makeRoom(roomId, { client, myUserId: me });
  for (const [id, sender] of bodies) {
    pushTimelineEvent(
      room,
      makeMatrixEvent({
        eventId: id,
        roomId,
        sender,
        type: "m.room.message",
        content: { msgtype: "m.text", body: id },
      }),
    );
  }
  Object.assign(room as unknown as Record<string, unknown>, {
    name: "general",
    getEventReadUpTo: () => opts.readUpTo ?? null,
  });
  const cast = client as unknown as Record<string, unknown>;
  cast.getRoom = (id: string) => (id === roomId ? room : null);
  cast.sendEvent = vi.fn().mockResolvedValue({ event_id: "$new" });
  MatrixClientPeg.injectClientForTest(client);
  return { cast, room };
}

const renderPanel = (
  props: Partial<Parameters<typeof TimelinePanel>[0]> = {},
) =>
  render(
    <MemoryRouter>
      <TimelinePanel roomId={roomId} {...props} />
    </MemoryRouter>,
  );

it("highlights the message a ?event= link points at", async () => {
  seed([
    ["$a", ana],
    ["$b", ana],
  ]);
  const { container } = renderPanel({ highlightEventId: "$a" });
  await waitFor(() =>
    expect(container.querySelector('[data-message-id="$a"]')).toHaveAttribute(
      "data-highlighted",
    ),
  );
  expect(container.querySelector('[data-message-id="$b"]')).not.toHaveAttribute(
    "data-highlighted",
  );
});

it("draws the New divider above the first message after my read receipt", async () => {
  seed(
    [
      ["$read", ana],
      ["$mine", me],
      ["$new", ana],
    ],
    { readUpTo: "$read" },
  );
  renderPanel();
  const divider = await screen.findByTestId("message-unread-divider");
  const rows = screen.getAllByTestId("message-row");
  // $new follows the divider; my own message does not count as unread.
  expect(
    divider.compareDocumentPosition(rows[2]) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    divider.compareDocumentPosition(rows[1]) & Node.DOCUMENT_POSITION_PRECEDING,
  ).toBeTruthy();
});

it("reacts from the action bar", async () => {
  const { cast } = seed([["$a", ana]]);
  renderPanel();
  const row = (await screen.findAllByTestId("message-row"))[0];
  await userEvent.click(
    within(row).getByRole("button", { name: "React with 👍" }),
  );
  expect(cast.sendEvent).toHaveBeenCalledWith(roomId, "m.reaction", {
    "m.relates_to": { rel_type: "m.annotation", event_id: "$a", key: "👍" },
  });
});
