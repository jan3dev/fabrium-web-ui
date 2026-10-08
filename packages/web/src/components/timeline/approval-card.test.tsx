import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventType } from "matrix-js-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  injectStateEvent,
  makeFakeClient,
  makeRoom,
  mkMatrixEvent,
} from "../../../test/factories";
import { MatrixClientPeg } from "../../client/peg";
import { ApprovalEventType, decodeApprovalRequest } from "../../events/approval";
import type { ApprovalView } from "@/model/agent-activity";
import type { ActorSummary } from "@/model/types";
import { ApprovalCard } from "./approval-card";

const me = "@me:h.example";
const roomId = "!r:h.example";

const agent: ActorSummary = { id: "@architect.acme:h.example", kind: "agent", displayName: "Coder · Payments", avatarUrl: null };

function approval(over: Partial<ApprovalView> = {}): ApprovalView {
  const request = decodeApprovalRequest(
    mkMatrixEvent({
      roomId,
      sender: agent.id,
      type: ApprovalEventType.Request,
      content: { approval_id: "a1", session_id: "s1", tool_call_id: "tc1" },
      eventId: "$req1",
    }),
  )!;
  return { request, resolution: null, expired: false, viewerIsAgent: false, ...over };
}

const card = (over?: Partial<ApprovalView>) => <ApprovalCard roomId={roomId} approval={approval(over)} agent={agent} />;

function setup(opts: { canApprove?: boolean; sendEvent?: ReturnType<typeof vi.fn> } = {}) {
  const client = makeFakeClient({ userId: me });
  const room = makeRoom(roomId, {
    client,
    myUserId: me,
    powerLevels: { [me]: opts.canApprove === false ? 0 : 50 },
  });
  if (opts.canApprove === false) {
    injectStateEvent(
      room,
      mkMatrixEvent({
        roomId,
        sender: "@admin:h.example",
        type: EventType.RoomPowerLevels,
        stateKey: "",
        content: {
          users: { [me]: 0 },
          users_default: 0,
          events_default: 0,
          state_default: 50,
          events: { [ApprovalEventType.Response]: 50 },
        },
      }),
    );
  }
  (client as unknown as { getRoom: () => unknown }).getRoom = () => room;
  (client as unknown as { sendEvent: unknown }).sendEvent =
    opts.sendEvent ?? vi.fn().mockResolvedValue({ event_id: "$r1" });
  MatrixClientPeg.injectClientForTest(client);
  return { client, room };
}

afterEach(() => MatrixClientPeg.reset());

describe("<ApprovalCard />", () => {
  it("renders Allow + Cancel buttons when pending and the user can approve", () => {
    setup();
    render(card());
    expect(screen.getByRole("button", { name: /allow/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeEnabled();
  });

  it("hides buttons when the user lacks power to send approval_response", () => {
    setup({ canApprove: false });
    render(card());
    expect(screen.queryByRole("button", { name: /allow/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.getByText(/insufficient permission/i)).toBeInTheDocument();
  });

  it("clicking Allow sends dev.zooid.approval_response and disables buttons during send", async () => {
    let resolveSend: () => void = () => {};
    const sendEvent = vi.fn().mockImplementation(
      () =>
        new Promise<{ event_id: string }>((res) => {
          resolveSend = () => res({ event_id: "$r1" });
        }),
    );
    setup({ sendEvent });
    render(card());
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /allow/i }));
    expect(screen.getByRole("button", { name: /allow/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
    resolveSend();
    await waitFor(() =>
      expect(sendEvent).toHaveBeenCalledWith(roomId, ApprovalEventType.Response, {
        approval_id: "a1",
        session_id: "s1",
        decision: "allow",
      }),
    );
  });

  it("shows who answered instead of buttons once resolved", () => {
    setup();
    render(card({ resolution: { decision: "allow", respondedBy: "@bob:h.example", respondedAt: Date.now() } }));
    expect(screen.getByText(/approved by/i)).toHaveTextContent(/bob/);
    expect(screen.queryByRole("button", { name: /allow/i })).not.toBeInTheDocument();
  });

  it("shows an expired approval as denied, without buttons", () => {
    setup();
    render(card({ expired: true }));
    expect(screen.getByTestId("approval-card")).toHaveAttribute("data-state", "expired");
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /allow/i })).not.toBeInTheDocument();
  });

  it("hides the buttons from an agent viewer", () => {
    setup();
    render(card({ viewerIsAgent: true }));
    expect(screen.queryByRole("button", { name: /allow/i })).not.toBeInTheDocument();
    expect(screen.getByText(/only humans/i)).toBeInTheDocument();
  });

  it("double-click on Allow sends only one event", async () => {
    const sendEvent = vi.fn().mockResolvedValue({ event_id: "$r1" });
    setup({ sendEvent });
    render(card());
    const user = userEvent.setup();
    const btn = screen.getByRole("button", { name: /allow/i });
    await user.dblClick(btn);
    expect(sendEvent).toHaveBeenCalledTimes(1);
  });
});
