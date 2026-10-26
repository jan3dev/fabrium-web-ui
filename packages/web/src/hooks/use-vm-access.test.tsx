import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mswServer } from "../../test/setup";
import { signInForVmApi } from "../../test/vm-api";
import { MatrixClientPeg } from "../client/peg";
import { useVmAccess } from "./use-vm-access";

const ACCESS = "/_fabrium/v1/access";

afterEach(() => MatrixClientPeg.reset());

describe("useVmAccess", () => {
  it("is false until the API answers 200, then true", async () => {
    signInForVmApi();
    mswServer.use(
      http.get(ACCESS, () =>
        HttpResponse.json({ user_id: "@ann:example.org", role: "admin" }),
      ),
    );
    const { result } = renderHook(() => useVmAccess());
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  describe("with a fake clock", () => {
    type Reply = () => Response | Promise<Response>;

    const granted: Reply = () =>
      new Response(JSON.stringify({ user_id: "@ann:example.org", role: "admin" }));
    const status =
      (code: number): Reply =>
      () =>
        new Response(JSON.stringify({ error: "failed" }), { status: code });
    const offline: Reply = () => Promise.reject(new TypeError("Failed to fetch"));

    /** Longer than every retry delay. */
    const LONG = 10 * 60_000;

    /** Answers each GET /access with the next reply; the last one repeats. */
    function serve(...replies: Reply[]) {
      let next = 0;
      return vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => replies[Math.min(next++, replies.length - 1)]());
    }

    /** Moves the clock and lets the requests it starts finish. */
    const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

    const focus = () =>
      act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(0);
      });

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it.each([
      ["a 403", status(403)],
      ["a 404", status(404)],
      ["a 200 that is not JSON", () => new Response("<!doctype html><html></html>")],
    ])("stays false, without retrying or re-checking on focus, after %s", async (_, reply) => {
      signInForVmApi();
      const fetchMock = serve(reply);
      const { result } = renderHook(() => useVmAccess());

      await tick(LONG);
      await focus();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.current).toBe(false);
    });

    it.each([
      ["a 502", status(502)],
      ["a network error", offline],
    ])("retries after %s and turns true once the API answers", async (_, failure) => {
      signInForVmApi();
      const fetchMock = serve(failure, granted);
      const { result } = renderHook(() => useVmAccess());

      await tick(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.current).toBe(false);

      await tick(LONG);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.current).toBe(true);

      // Done: neither time nor focus asks again.
      await tick(LONG);
      await focus();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries after a failed OpenID token request", async () => {
      const { getOpenIdToken } = signInForVmApi();
      getOpenIdToken.mockRejectedValueOnce(new Error("openid unavailable"));
      const fetchMock = serve(granted);
      const { result } = renderHook(() => useVmAccess());

      await tick(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.current).toBe(false);

      await tick(LONG);
      expect(result.current).toBe(true);
    });

    it("stops retrying after a few tries, then checks again on focus", async () => {
      signInForVmApi();
      const fetchMock = serve(status(502));
      const { result } = renderHook(() => useVmAccess());

      await tick(LONG);
      const tries = fetchMock.mock.calls.length;
      expect(tries).toBeGreaterThan(1);
      await tick(LONG);
      expect(fetchMock).toHaveBeenCalledTimes(tries);
      expect(result.current).toBe(false);

      fetchMock.mockImplementation(async () => granted());
      await focus();
      expect(fetchMock).toHaveBeenCalledTimes(tries + 1);
      expect(result.current).toBe(true);
    });

    it("checks at once on focus during a wait, and drops that retry", async () => {
      signInForVmApi();
      const fetchMock = serve(status(502), granted);
      const { result } = renderHook(() => useVmAccess());
      await tick(0);
      expect(result.current).toBe(false);

      await focus();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.current).toBe(true);
      await tick(LONG);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("clears its timer and its focus listener on unmount", async () => {
      signInForVmApi();
      const fetchMock = serve(status(502));
      const { unmount } = renderHook(() => useVmAccess());
      await tick(0);
      unmount();

      await tick(LONG);
      await focus();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
