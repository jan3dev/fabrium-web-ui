import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixClientPeg } from "../client/peg";
import type { Vm } from "../model/types";
import { signInForVmApi } from "../../test/vm-api";
import { makeVm } from "../../test/vm-fixtures";
import { useVms } from "./use-vms";

type Reply = Vm[] | { status: number; body: unknown };

const respond = (reply: Reply) =>
  Array.isArray(reply)
    ? new Response(JSON.stringify(reply))
    : new Response(JSON.stringify(reply.body), { status: reply.status });

/** Answers each GET /vms with the next reply; the last one repeats. */
function serve(...replies: Reply[]) {
  let next = 0;
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => respond(replies[Math.min(next++, replies.length - 1)]));
}

/** Holds each GET /vms until the test answers it, so answers can arrive out of order. */
function hold() {
  const replies: Array<(reply: Reply) => void> = [];
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => new Promise((resolve) => replies.push((r) => resolve(respond(r)))));
  /** Answers the nth request (from 0) and lets the hook handle the answer. */
  const answer = (n: number, reply: Reply) =>
    act(async () => {
      replies[n](reply);
      await vi.advanceTimersByTimeAsync(0);
    });
  return { fetchMock, answer };
}

/** Moves the clock and lets the requests it starts finish. */
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

const settled = [makeVm()];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  signInForVmApi();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  MatrixClientPeg.reset();
});

describe("useVms", () => {
  it("loads at once, then polls every 30 s while nothing is in transition", async () => {
    const fetchMock = serve(settled);
    const { result } = renderHook(() => useVms());
    expect(result.current.vms).toBeNull();

    await tick(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.vms).toEqual(settled);

    await tick(29_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["is pending", { state: "pending" }],
    ["is stopping", { state: "stopping" }],
    ["is shutting down", { state: "shutting-down" }],
    ["has setup pending", { setup: "pending" }],
  ] as const)("polls every 5 s while a VM %s", async (_, over) => {
    const fetchMock = serve([makeVm(over)]);
    renderHook(() => useVms());

    await tick(0);
    await tick(4_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("polls every 30 s again once the VM settles", async () => {
    const fetchMock = serve([makeVm({ state: "pending" })], settled);
    renderHook(() => useVms());

    await tick(0);
    await tick(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await tick(29_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops polling on unmount", async () => {
    const fetchMock = serve([makeVm({ state: "pending" })]);
    const { unmount } = renderHook(() => useVms());
    await tick(0);
    unmount();

    await tick(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([403, 404])("stops polling on %i", async (status) => {
    const fetchMock = serve({ status, body: { error: "denied" } });
    const { result } = renderHook(() => useVms());

    await tick(0);
    expect(result.current.error).toMatchObject({ status });
    await tick(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the last list on another error and retries in 30 s", async () => {
    const pending = [makeVm({ state: "pending" })];
    const fetchMock = serve(pending, { status: 502, body: { error: "aws" } }, settled);
    const { result } = renderHook(() => useVms());

    await tick(0);
    await tick(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.vms).toEqual(pending);
    expect(result.current.error).toMatchObject({ status: 502 });

    await tick(29_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.vms).toEqual(settled);
    expect(result.current.error).toBeNull();
  });

  it("retries a failed first load in 30 s", async () => {
    const fetchMock = serve({ status: 502, body: { error: "aws" } }, settled);
    const { result } = renderHook(() => useVms());

    await tick(0);
    expect(result.current.vms).toBeNull();
    expect(result.current.error).toMatchObject({ status: 502 });
    await tick(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.vms).toEqual(settled);
  });

  it("refresh loads at once", async () => {
    const fetchMock = serve(settled);
    const { result } = renderHook(() => useVms());
    await tick(0);

    await act(async () => {
      result.current.refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe("when two requests overlap", () => {
    /** Renders the hook with its first load and a refresh both still in flight. */
    async function renderWithTwoInFlight() {
      const { fetchMock, answer } = hold();
      const { result } = renderHook(() => useVms());
      await tick(0);
      await act(async () => {
        result.current.refresh();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      return { fetchMock, result, answer };
    }

    it("keeps the newer list when an older request answers last", async () => {
      const { fetchMock, result, answer } = await renderWithTwoInFlight();
      const stopping = [makeVm({ state: "stopping" })];

      await answer(1, stopping);
      await answer(0, settled);
      expect(result.current.vms).toEqual(stopping);

      // The newer list is still in transition, so the next poll is 5 s out, not 30 s.
      await tick(5_000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("ignores an older failure that arrives after a newer list", async () => {
      const { result, answer } = await renderWithTwoInFlight();

      await answer(1, settled);
      await answer(0, { status: 502, body: { error: "aws" } });
      expect(result.current.vms).toEqual(settled);
      expect(result.current.error).toBeNull();
    });
  });
});
