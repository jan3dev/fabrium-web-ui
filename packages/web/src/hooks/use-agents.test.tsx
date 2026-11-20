import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixClientPeg } from "../client/peg";
import type { AgentList } from "../model/types";
import { signInForVmApi } from "../../test/vm-api";
import { PROFILE, makeAgent } from "../../test/vm-fixtures";
import { useAgents } from "./use-agents";

type Reply = AgentList | { status: number; body: unknown };

const respond = (reply: Reply) =>
  "agents" in reply
    ? new Response(JSON.stringify(reply))
    : new Response(JSON.stringify(reply.body), { status: reply.status });

/** Answers each GET /agents with the next reply; the last one repeats. */
function serve(...replies: Reply[]) {
  let next = 0;
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => respond(replies[Math.min(next++, replies.length - 1)]));
}

/** Moves the clock and lets the requests it starts finish. */
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

const settled: AgentList = {
  agents: [makeAgent(), PROFILE],
  vms: [{ name: "lima", state: "running", project_id: null }],
  people: [],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  signInForVmApi();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  MatrixClientPeg.reset();
});

describe("useAgents", () => {
  it("polls every 5 s while a VM is in transition, and every 30 s otherwise", async () => {
    const busy: AgentList = {
      agents: [makeAgent({ vm: { name: "lima", id: "i-0123456789abcdef0", state: "pending" } })],
      vms: [],
      people: [],
    };
    const fetchMock = serve(busy, settled);
    const { result } = renderHook(() => useAgents());
    expect(result.current.list).toBeNull();

    await tick(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.list).toEqual(busy);
    await tick(4_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.list).toEqual(settled);

    await tick(29_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(["pending", "stopping", "shutting-down"] as const)(
    "polls every 5 s while a VM of the list is %s",
    async (state) => {
      const fetchMock = serve({ agents: [PROFILE], vms: [{ name: "lima", state, project_id: null }], people: [] });
      renderHook(() => useAgents());

      await tick(0);
      await tick(4_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await tick(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it.each([403, 404])("stops on a %i", async (status) => {
    const fetchMock = serve({ status, body: { error: "forbidden" } });
    const { result } = renderHook(() => useAgents());

    await tick(0);
    expect(result.current.error).toMatchObject({ status });
    await tick(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the last list on another error and retries in 30 s", async () => {
    const fetchMock = serve(settled, { status: 502, body: { error: "control plane unreachable" } }, settled);
    const { result } = renderHook(() => useAgents());

    await tick(0);
    await tick(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.list).toEqual(settled);
    expect(result.current.error).toMatchObject({ status: 502 });

    await tick(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeNull();
  });

  it("refresh loads at once", async () => {
    const fetchMock = serve(settled);
    const { result } = renderHook(() => useAgents());
    await tick(0);

    await act(async () => {
      result.current.refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
