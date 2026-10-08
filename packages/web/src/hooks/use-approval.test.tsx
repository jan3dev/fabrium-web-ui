import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeFakeClient,
  makeRoom,
  mkMatrixEvent,
  pushTimelineEvent,
} from "../../test/factories";
import { ApprovalEventType, decodeApprovalRequest } from "../events/approval";
import { MatrixClientPeg } from "../client/peg";
import { useApproval } from "./use-approval";

const me = "@me:h.example";
const roomId = "!r:h.example";
const requestId = "$req1";

function setup(opts: { sendEvent?: ReturnType<typeof vi.fn> } = {}) {
  const client = makeFakeClient({ userId: me });
  const room = makeRoom(roomId, { client, myUserId: me, powerLevels: { [me]: 0 } });
  const requestEv = mkMatrixEvent({
    roomId,
    sender: "@architect.acme:h.example",
    type: ApprovalEventType.Request,
    content: { approval_id: "a1", session_id: "s1", tool_call_id: "tc1" },
    eventId: requestId,
  });
  pushTimelineEvent(room, requestEv);
  (client as unknown as { getRoom: () => unknown }).getRoom = () => room;
  (client as unknown as { sendEvent: unknown }).sendEvent =
    opts.sendEvent ?? vi.fn().mockResolvedValue({ event_id: "$resp1" });
  MatrixClientPeg.injectClientForTest(client);
  return { client, room, request: decodeApprovalRequest(requestEv)! };
}

const resolved = false;

afterEach(() => MatrixClientPeg.reset());

describe("useApproval — pending state", () => {
  it("starts pending", () => {
    const { request } = setup();
    const { result } = renderHook(() => useApproval(roomId, request, resolved));
    expect(result.current.state).toBe("pending");
  });
});

describe("useApproval — send", () => {
  it("send('allow') flips state to sending then back to pending awaiting timeline echo", async () => {
    const sendEvent = vi.fn().mockResolvedValue({ event_id: "$r1" });
    const { request } = setup({ sendEvent });
    const { result } = renderHook(() => useApproval(roomId, request, resolved));

    let p: Promise<void>;
    act(() => {
      p = result.current.send("allow");
    });
    expect(result.current.state).toBe("sending");
    await act(async () => {
      await p!;
    });
    // After sendEvent resolves we revert to "pending" — the resolved state
    // only flips when the response event actually appears in /sync.
    expect(result.current.state).toBe("pending");
    expect(sendEvent).toHaveBeenCalledWith(
      roomId,
      ApprovalEventType.Response,
      { approval_id: "a1", session_id: "s1", decision: "allow" },
    );
  });

  it("idempotency: while sending, repeat clicks no-op", async () => {
    let resolveSend: () => void = () => {};
    const sendEvent = vi.fn().mockImplementation(
      () =>
        new Promise<{ event_id: string }>((res) => {
          resolveSend = () => res({ event_id: "$r1" });
        }),
    );
    const { request } = setup({ sendEvent });
    const { result } = renderHook(() => useApproval(roomId, request, resolved));

    act(() => {
      result.current.send("allow");
    });
    expect(result.current.state).toBe("sending");
    act(() => {
      result.current.send("allow");
      result.current.send("cancel");
    });
    expect(sendEvent).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSend();
    });
  });

  it("idempotency: once resolved by *anyone*, send() is a no-op", () => {
    const sendEvent = vi.fn();
    const { request } = setup({ sendEvent });
    const { result } = renderHook(() => useApproval(roomId, request, true));
    expect(result.current.state).toBe("resolved");
    act(() => {
      void result.current.send("allow");
    });
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it("send error surfaces and re-enables the buttons", async () => {
    const sendEvent = vi.fn().mockRejectedValue(new Error("M_FORBIDDEN"));
    const { request } = setup({ sendEvent });
    const { result } = renderHook(() => useApproval(roomId, request, resolved));
    await act(async () => {
      await result.current.send("allow").catch(() => {});
    });
    expect(result.current.state).toBe("error");
    expect(result.current.error).toMatch(/M_FORBIDDEN/);
    sendEvent.mockResolvedValueOnce({ event_id: "$r1" });
    await act(async () => {
      await result.current.send("allow");
    });
    expect(sendEvent).toHaveBeenCalledTimes(2);
  });
});
