import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../app";
import { MatrixClientPeg } from "../../client/peg";
import { relaxUnhandled, stubStartClient, stubSyncWithRooms } from "../../../test/setup";

const HS = "https://h.example";
const me = "@me:h.example";
const roomId = "!a:h.example";

describe("<TimelinePanel />", () => {
  beforeEach(() => {
    localStorage.setItem(
      "zoon:session",
      JSON.stringify({ homeserverUrl: HS, accessToken: "tok", userId: me, deviceId: "DEV1" }),
    );
    relaxUnhandled();
    stubStartClient(HS);
  });
  afterEach(() => {
    MatrixClientPeg.reset();
    localStorage.clear();
  });

  it("renders m.room.message events as plain text", async () => {
    stubSyncWithRooms(HS, [
      {
        roomId,
        myUserId: me,
        state: [{ type: "m.room.name", sender: me, stateKey: "", content: { name: "alpha" } }],
        timeline: [
          {
            type: "m.room.message",
            sender: "@me:h.example",
            content: { msgtype: "m.text", body: "hello world" },
          },
        ],
      },
    ]);
    render(<App config={{ homeserverUrl: HS }} initialRoute={`/room/${roomId}`} />);
    await waitFor(() => expect(screen.getByText("hello world")).toBeInTheDocument());
  });

  it("groups an agent's tool calls into one turn block", async () => {
    const tool = (id: string, title: string) => ({
      type: "dev.zooid.tool_call",
      sender: "@architect.acme:h.example",
      content: { session_id: "s1", tool_call_id: id, title, kind: "execute" },
    });
    stubSyncWithRooms(HS, [
      {
        roomId,
        myUserId: me,
        state: [{ type: "m.room.name", sender: me, stateKey: "", content: { name: "alpha" } }],
        timeline: [tool("tc1", "Bash"), tool("tc2", "Grep")],
      },
    ]);
    render(<App config={{ homeserverUrl: HS }} initialRoute={`/room/${roomId}`} />);
    const turn = await screen.findByTestId("agent-turn");
    expect(screen.getAllByTestId("agent-turn")).toHaveLength(1);
    expect(turn).toHaveTextContent(/is working · 2 tools/);
    expect(turn).toHaveTextContent("Bash");
    expect(turn).toHaveTextContent("Grep");
  });

  it("does not render unknown dev.zooid.* events (forward-compat)", async () => {
    stubSyncWithRooms(HS, [
      {
        roomId,
        myUserId: me,
        state: [{ type: "m.room.name", sender: me, stateKey: "", content: { name: "alpha" } }],
        timeline: [
          {
            type: "dev.zooid.future_event",
            sender: "@architect.acme:h.example",
            content: { session_id: "s1" },
          },
          {
            type: "m.room.message",
            sender: "@me:h.example",
            content: { msgtype: "m.text", body: "after the unknown" },
          },
        ],
      },
    ]);
    render(<App config={{ homeserverUrl: HS }} initialRoute={`/room/${roomId}`} />);
    await waitFor(() => expect(screen.getByText("after the unknown")).toBeInTheDocument());
    expect(screen.queryByText(/future_event/i)).not.toBeInTheDocument();
  });
});
