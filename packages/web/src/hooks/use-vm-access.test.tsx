import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
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

  it.each([
    ["a 403", () => HttpResponse.json({ error: "forbidden" }, { status: 403 })],
    ["a 404", () => HttpResponse.json({ error: "not found" }, { status: 404 })],
    [
      "a 200 that is not JSON",
      () =>
        new HttpResponse("<!doctype html><html></html>", {
          headers: { "content-type": "text/html" },
        }),
    ],
    ["a network error", () => HttpResponse.error()],
  ])("stays false after %s", async (_, reply) => {
    signInForVmApi();
    let answered!: () => void;
    const done = new Promise<void>((resolve) => (answered = resolve));
    mswServer.use(
      http.get(ACCESS, () => {
        answered();
        return reply();
      }),
    );
    const { result } = renderHook(() => useVmAccess());

    await done;
    // The hook reacts a few ticks after the answer; give it the time.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(result.current).toBe(false);
  });
});
