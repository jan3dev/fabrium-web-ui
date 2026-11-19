import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { mswServer } from "../../test/setup";
import { signInForVmApi } from "../../test/vm-api";
import { MARKETING, PAYMENTS, PROJECTS } from "../../test/vm-fixtures";
import { MatrixClientPeg } from "../client/peg";
import type { ProjectList } from "../model/types";
import { useProjects } from "./use-projects";

const API = "/_fabrium/v1";

/** Answers each GET /projects with `api.list`, and counts the requests. */
function serve(list: ProjectList = { projects: PROJECTS, can: { manage: true } }) {
  const api = { list, gets: 0 };
  mswServer.use(
    http.get(`${API}/projects`, () => {
      api.gets++;
      return HttpResponse.json(api.list);
    }),
  );
  signInForVmApi();
  return api;
}

afterEach(() => MatrixClientPeg.reset());

describe("useProjects", () => {
  it("loads when enabled, and not before", async () => {
    const api = serve();
    const { result, rerender } = renderHook(({ enabled }) => useProjects(enabled), {
      initialProps: { enabled: false },
    });
    await act(async () => {});
    expect(api.gets).toBe(0);
    expect(result.current.list).toBeNull();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.list?.projects).toEqual(PROJECTS));
    expect(result.current.list?.can.manage).toBe(true);
    expect(api.gets).toBe(1);
  });

  it("loads again each time enabled turns true", async () => {
    const api = serve();
    const { result, rerender } = renderHook(({ enabled }) => useProjects(enabled), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.list).not.toBeNull());
    rerender({ enabled: false });
    api.list = { projects: [PAYMENTS], can: { manage: false } };
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.list?.projects).toEqual([PAYMENTS]));
    expect(api.gets).toBe(2);
  });

  it("refresh resolves after the new list is in state", async () => {
    const api = serve();
    const { result } = renderHook(() => useProjects(true));
    await waitFor(() => expect(result.current.list).not.toBeNull());

    api.list = { projects: [MARKETING], can: { manage: true } };
    await act(() => result.current.refresh());
    expect(result.current.list?.projects).toEqual([MARKETING]);
  });

  it("add inserts a project in the sorted place, ignoring ASCII case", async () => {
    const zed = { id: "ffffffffffffffffffffffffffffffff", name: "Zed", in_use: false };
    serve({ projects: [MARKETING, zed], can: { manage: true } });
    const { result } = renderHook(() => useProjects(true));
    await waitFor(() => expect(result.current.list).not.toBeNull());

    act(() => result.current.add({ id: "p9", name: "payments", in_use: false }));
    expect(result.current.list?.projects.map((p) => p.name)).toEqual([
      "Marketing",
      "payments",
      "Zed",
    ]);
  });

  it("keeps the error text of a failed load", async () => {
    signInForVmApi();
    mswServer.use(
      http.get(`${API}/projects`, () =>
        HttpResponse.json({ error: "control plane unreachable" }, { status: 502 }),
      ),
    );
    const { result } = renderHook(() => useProjects(true));
    await waitFor(() => expect(result.current.error).toBe("control plane unreachable"));
    expect(result.current.list).toBeNull();
  });
});
