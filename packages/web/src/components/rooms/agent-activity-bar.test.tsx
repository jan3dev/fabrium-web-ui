import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type MatrixEvent, RoomMember } from "matrix-js-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFakeClient, makeRoom, mkMatrixEvent, pushTimelineEvent } from "../../../test/factories";
import { MatrixClientPeg } from "../../client/peg";
import { AgentActivityBar } from "./agent-activity-bar";

const me = "@me:h.example";
const agent = "@coder:h.example";
const roomId = "!r:h.example";
let tick = 0;

function setup() {
  const client = makeFakeClient({ userId: me });
  const room = makeRoom(roomId, { client, myUserId: me });
  (client as unknown as { addRoom(r: unknown): void }).addRoom(room);
  const send = vi.fn().mockResolvedValue({ event_id: "$i1" });
  (client as unknown as { sendEvent: unknown }).sendEvent = send;
  MatrixClientPeg.injectClientForTest(client);
  const emit = (type: string, content: Record<string, unknown>, root = "$root"): MatrixEvent => {
    const ev = mkMatrixEvent({
      roomId,
      sender: agent,
      type,
      content: { session_id: "s1", ...content, "m.relates_to": { rel_type: "m.thread", event_id: root } },
    });
    // mkMatrixEvent stamps ts 0, which reads as a turn dead for decades.
    ev.event.origin_server_ts = Date.now() + ++tick;
    act(() => pushTimelineEvent(room, ev));
    return ev;
  };
  return { room, send, emit };
}

afterEach(() => {
  cleanup();
  MatrixClientPeg.reset();
});

describe("<AgentActivityBar />", () => {
  it("shows a running turn with its current tool, and hides it at turn.end", () => {
    const { emit } = setup();
    render(<AgentActivityBar roomId={roomId} />);
    expect(screen.queryByTestId("agent-activity-bar")).toBeNull();
    emit("dev.zooid.tool_call", { tool_call_id: "t1", title: "Run", kind: "execute", raw_input: { command: "pnpm test" } });
    expect(screen.getByTestId("agent-activity-bar")).toHaveTextContent("Running pnpm test");
    emit("dev.zooid.turn.end", { agent_id: "coder" });
    expect(screen.queryByTestId("agent-activity-bar")).toBeNull();
  });

  it("Stop sends dev.zooid.interrupt into the turn's thread", async () => {
    const { emit, send } = setup();
    const onOpenThread = vi.fn();
    render(<AgentActivityBar roomId={roomId} onOpenThread={onOpenThread} />);
    emit("dev.zooid.tool_call", { tool_call_id: "t1", title: "Run", kind: "execute" }, "$other");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View thread" }));
    expect(onOpenThread).toHaveBeenCalledWith("$other");
    await user.click(screen.getByRole("button", { name: /^stop/i }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(roomId, "$other", "dev.zooid.interrupt", {
        "m.relates_to": { rel_type: "m.thread", event_id: "$other" },
      }),
    );
    expect(screen.getByRole("button", { name: /^stop/i })).toHaveTextContent("Stopping…");
  });

  it("in the room, leaves out the thread open in the side pane", () => {
    const { emit } = setup();
    render(<AgentActivityBar roomId={roomId} openThreadId="$root" />);
    emit("dev.zooid.tool_call", { tool_call_id: "t1", title: "Run", kind: "execute" }, "$root");
    expect(screen.queryByTestId("agent-activity-bar")).toBeNull();
  });

  it("in a thread, shows only that thread's turns", () => {
    const { emit } = setup();
    render(<AgentActivityBar roomId={roomId} threadRootId="$root" />);
    emit("dev.zooid.tool_call", { tool_call_id: "t1", title: "Run", kind: "execute" }, "$elsewhere");
    expect(screen.queryByTestId("agent-activity-bar")).toBeNull();
  });

  it("in a thread, an agent typing before its first tool call can be stopped", async () => {
    const { room, send } = setup();
    const typer = new RoomMember(roomId, agent);
    typer.typing = true;
    (room.currentState as unknown as { getMembers: () => RoomMember[] }).getMembers = () => [typer];
    render(<AgentActivityBar roomId={roomId} threadRootId="$root" />);
    expect(screen.getByTestId("agent-activity-bar")).toHaveTextContent("Working");
    await userEvent.setup().click(screen.getByRole("button", { name: /^stop/i }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(roomId, "$root", "dev.zooid.interrupt", {
        "m.relates_to": { rel_type: "m.thread", event_id: "$root" },
      }),
    );
  });
});
