import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MatrixClientPeg } from "@/client/peg";
import {
  ARTIFACT_REFS_FIELD,
  formatArtifactRefs,
  getArtifactRefDrafts,
  setArtifactRefDrafts,
  type ArtifactRef,
} from "@/lib/artifacts/refs";
import { makeFakeClient, makeRoom } from "../../../test/factories";
import { Composer } from "./composer";

const me = "@me:h.example";
const roomId = "!r:h.example";
const ref: ArtifactRef = {
  identifier: "page",
  title: "Landing page",
  version: 2,
  event_id: "$v2",
  target: { kind: "element", selector: "button.cta", html: "<button>Go</button>", text: "Go" },
  note: "make it blue",
};

function setup() {
  const client = makeFakeClient({ userId: me });
  const room = makeRoom(roomId, { client, myUserId: me });
  const send = vi.fn().mockResolvedValue({ event_id: "$m" });
  const cast = client as unknown as Record<string, unknown>;
  cast.getRoom = () => room;
  cast.sendEvent = send;
  MatrixClientPeg.injectClientForTest(client);
  return { send };
}

afterEach(() => {
  cleanup();
  MatrixClientPeg.reset();
  setArtifactRefDrafts(roomId, "$root", []);
});

describe("<Composer /> artifact annotations", () => {
  it("sends the annotations as a field and as text for the agent, then clears them", async () => {
    const { send } = setup();
    render(<Composer roomId={roomId} threadRootEventId="$root" />);
    act(() => setArtifactRefDrafts(roomId, "$root", [ref]));
    expect(screen.getByRole("list", { name: /artifact annotations/i })).toHaveTextContent("make it blue");
    await userEvent.setup().type(screen.getByRole("textbox", { name: /message/i }), "**please**{Enter}");
    await waitFor(() => expect(send).toHaveBeenCalled());
    const [r, thread, type, content] = send.mock.calls[0];
    expect([r, thread, type]).toEqual([roomId, "$root", "m.room.message"]);
    expect(content.body).toBe(`**please**\n\n${formatArtifactRefs([ref])}`);
    expect(content.formatted_body).toBeUndefined();
    expect(content[ARTIFACT_REFS_FIELD]).toEqual([ref]);
    expect(getArtifactRefDrafts(roomId, "$root")).toEqual([]);
  });

  it("can send annotations without a comment", async () => {
    const { send } = setup();
    render(<Composer roomId={roomId} threadRootEventId="$root" />);
    act(() => setArtifactRefDrafts(roomId, "$root", [ref]));
    await userEvent.setup().click(screen.getByRole("button", { name: /send message/i }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][3].body).toBe(formatArtifactRefs([ref]));
  });
});
