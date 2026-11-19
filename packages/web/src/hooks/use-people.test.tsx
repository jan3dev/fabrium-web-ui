import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { mswServer } from "../../test/setup";
import { signInForVmApi } from "../../test/vm-api";
import { MatrixClientPeg } from "../client/peg";
import { usePeople } from "./use-people";

const PEOPLE = [{ user_id: "@ana:example.org", name: "Ana" }];

afterEach(() => MatrixClientPeg.reset());

describe("usePeople", () => {
  it("loads the people when enabled, and not before", async () => {
    signInForVmApi();
    let gets = 0;
    mswServer.use(
      http.get("/_fabrium/v1/agents", () => {
        gets++;
        return HttpResponse.json({ agents: [], vms: [], people: PEOPLE });
      }),
    );
    const { result, rerender } = renderHook(({ enabled }) => usePeople(enabled), {
      initialProps: { enabled: false },
    });
    await act(async () => {});
    expect(gets).toBe(0);
    expect(result.current.people).toBeNull();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.people).toEqual(PEOPLE));
    expect(gets).toBe(1);
  });
});
