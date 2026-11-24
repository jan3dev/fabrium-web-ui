import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MatrixClientPeg } from "@/client/peg";
import {
  ARTIFACT_REFS_FIELD,
  formatArtifactRefs,
  getArtifactRefDrafts,
  QUIET_FIELD,
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

  it("sends comments with Send to agent off in a quiet message, and mentions the agent in the reply", async () => {
    const { send } = setup();
    render(<Composer roomId={roomId} threadRootEventId="$root" />);
    const held = { ...ref, note: "for later", target: { ...ref.target, selector: "h1" } };
    act(() => setArtifactRefDrafts(roomId, "$root", [{ ...ref, agent: "@coder:h.example" }, held]));
    const user = userEvent.setup();
    const boxes = screen.getAllByRole("checkbox", { name: "Send to agent" });
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, true]);
    await user.click(boxes[1]!);
    await user.type(screen.getByRole("textbox", { name: /message/i }), "please{Enter}");
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    const quiet = send.mock.calls[0][3];
    expect(quiet[QUIET_FIELD]).toBe(true);
    expect(quiet[ARTIFACT_REFS_FIELD]).toEqual([held]);
    expect(quiet["m.mentions"]).toBeUndefined();
    const reply = send.mock.calls[1][3];
    expect(reply[QUIET_FIELD]).toBeUndefined();
    expect(reply[ARTIFACT_REFS_FIELD]).toEqual([ref]);
    expect(reply.body).toBe(`please\n\n${formatArtifactRefs([ref])}`);
    expect(reply["m.mentions"]).toEqual({ user_ids: ["@coder:h.example"] });
    expect(getArtifactRefDrafts(roomId, "$root")).toEqual([]);
  });
});
