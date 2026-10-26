import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mswServer } from "../../test/setup";
import { signInForVmApi } from "../../test/vm-api";
import { makeVm } from "../../test/vm-fixtures";
import type { CreateVmRequest } from "../model/types";
import {
  FabriumApiError,
  createVm,
  deleteVm,
  getAccess,
  isNoAccess,
  listVms,
  rebootVm,
  setFabriumApiUrl,
  startVm,
  stopVm,
} from "./fabrium-api";
import { MatrixClientPeg } from "./peg";

const vm = makeVm();
const API = "/_fabrium/v1";

afterEach(() => {
  vi.useRealTimers();
  setFabriumApiUrl(undefined);
  MatrixClientPeg.reset();
});

describe("token", () => {
  it("is sent as a Bearer header under /_fabrium/v1", async () => {
    signInForVmApi(["tok-1"]);
    let auth: string | null = null;
    mswServer.use(
      http.get(`${API}/vms`, ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json([vm]);
      }),
    );
    await expect(listVms()).resolves.toEqual([vm]);
    expect(auth).toBe("Bearer tok-1");
  });

  it("is cached until 30 s before expires_in", async () => {
    const { getOpenIdToken } = signInForVmApi(["tok-1", "tok-2"], 3600);
    mswServer.use(http.get(`${API}/vms`, () => HttpResponse.json([vm])));
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.parse("2026-10-26T12:00:00Z");
    vi.setSystemTime(start);
    await listVms();
    await listVms();
    expect(getOpenIdToken).toHaveBeenCalledTimes(1);

    vi.setSystemTime(start + 3569_000);
    await listVms();
    expect(getOpenIdToken).toHaveBeenCalledTimes(1);

    vi.setSystemTime(start + 3571_000);
    await listVms();
    expect(getOpenIdToken).toHaveBeenCalledTimes(2);
  });

  it("is requested once for concurrent calls", async () => {
    const { getOpenIdToken } = signInForVmApi();
    mswServer.use(
      http.get(`${API}/vms`, () => HttpResponse.json([vm])),
      http.get(`${API}/access`, () =>
        HttpResponse.json({ user_id: "@ann:example.org", role: "admin" }),
      ),
    );
    const [vms, access] = await Promise.all([listVms(), getAccess()]);
    expect(vms).toEqual([vm]);
    expect(access).toEqual({ user_id: "@ann:example.org", role: "admin" });
    expect(getOpenIdToken).toHaveBeenCalledTimes(1);
  });

  it("is renewed, and the call retried once, on a 401", async () => {
    const { getOpenIdToken } = signInForVmApi(["tok-1", "tok-2"]);
    const seen: (string | null)[] = [];
    mswServer.use(
      http.get(`${API}/vms`, ({ request }) => {
        const auth = request.headers.get("authorization");
        seen.push(auth);
        return auth === "Bearer tok-2"
          ? HttpResponse.json([vm])
          : HttpResponse.json({ error: "invalid token" }, { status: 401 });
      }),
    );
    await expect(listVms()).resolves.toEqual([vm]);
    expect(seen).toEqual(["Bearer tok-1", "Bearer tok-2"]);
    expect(getOpenIdToken).toHaveBeenCalledTimes(2);
  });

  it("is not retried a second time when the 401 repeats", async () => {
    signInForVmApi();
    let requests = 0;
    mswServer.use(
      http.get(`${API}/vms`, () => {
        requests++;
        return HttpResponse.json({ error: "invalid token" }, { status: 401 });
      }),
    );
    await expect(listVms()).rejects.toMatchObject({
      status: 401,
      message: "invalid token",
    });
    expect(requests).toBe(2);
  });

  it("is requested again after a failed request", async () => {
    const { getOpenIdToken } = signInForVmApi();
    getOpenIdToken.mockRejectedValueOnce(new Error("homeserver down"));
    mswServer.use(http.get(`${API}/vms`, () => HttpResponse.json([vm])));
    await expect(listVms()).rejects.toThrow("homeserver down");
    await expect(listVms()).resolves.toEqual([vm]);
    expect(getOpenIdToken).toHaveBeenCalledTimes(2);
  });
});

describe("errors", () => {
  const body: CreateVmRequest = {
    name: "lima",
    agent: { mode: "existing", name: "lima" },
    haven_api_key: "hk-1",
  };

  it("carry the status, the message, and the step", async () => {
    signInForVmApi();
    mswServer.use(
      http.post(`${API}/vms`, () =>
        HttpResponse.json(
          { error: "matrix timeout", step: "whoami" },
          { status: 502 },
        ),
      ),
    );
    const err = await createVm(body).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FabriumApiError);
    expect(err).toMatchObject({
      status: 502,
      message: "matrix timeout",
      step: "whoami",
    });
  });

  it("fall back to a generic message when the body is not JSON", async () => {
    signInForVmApi();
    mswServer.use(
      http.post(
        `${API}/vms`,
        () => new HttpResponse("Payload Too Large", { status: 413 }),
      ),
    );
    const err = await createVm(body).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 413, message: "Request failed (413)" });
    expect((err as FabriumApiError).step).toBeUndefined();
  });

  it("cover a 200 answer that is not JSON (a host without the API)", async () => {
    signInForVmApi();
    mswServer.use(
      http.get(
        `${API}/access`,
        () =>
          new HttpResponse("<!doctype html><html></html>", {
            headers: { "content-type": "text/html" },
          }),
      ),
    );
    await expect(getAccess()).rejects.toMatchObject({
      name: "FabriumApiError",
      status: 200,
      message: "Unexpected response",
    });
  });

  it("cover a call made while nobody is signed in, with no request", async () => {
    MatrixClientPeg.reset();
    let requested = false;
    mswServer.use(
      http.get(`${API}/vms`, () => {
        requested = true;
        return HttpResponse.json([]);
      }),
    );
    await expect(listVms()).rejects.toMatchObject({ status: 401 });
    expect(requested).toBe(false);
  });

  it.each([
    [401, false],
    [403, true],
    [404, true],
    [409, false],
    [502, false],
  ])("map status %i to no-access: %s", (status, noAccess) => {
    expect(isNoAccess(new FabriumApiError(status, "x"))).toBe(noAccess);
  });

  it("do not treat other failures as no-access", () => {
    expect(isNoAccess(new Error("Failed to fetch"))).toBe(false);
  });
});

describe("routes", () => {
  it("create posts the body as JSON", async () => {
    signInForVmApi();
    const body: CreateVmRequest = {
      name: "lima",
      instance_type: "t3a.medium",
      agent: {
        mode: "new",
        name: "echo",
        persona: "Reviewer",
        project: "Fabrium",
      },
      haven_api_key: "hk-1",
      github_token: "gh-1",
    };
    let sent: unknown;
    let contentType: string | null = null;
    mswServer.use(
      http.post(`${API}/vms`, async ({ request }) => {
        contentType = request.headers.get("content-type");
        sent = await request.json();
        return HttpResponse.json(
          { ...vm, state: "pending", setup: "pending" },
          { status: 201 },
        );
      }),
    );
    await expect(createVm(body)).resolves.toMatchObject({ state: "pending" });
    expect(sent).toEqual(body);
    expect(contentType).toContain("application/json");
  });

  it.each([
    ["start", startVm],
    ["stop", stopVm],
    ["reboot", rebootVm],
  ])("%s posts to /vms/<id>/%s", async (verb, action) => {
    signInForVmApi();
    let hit = "";
    mswServer.use(
      http.post(`${API}/vms/:id/:verb`, ({ params }) => {
        hit = `${params.id}/${params.verb}`;
        return HttpResponse.json(vm, { status: 202 });
      }),
    );
    await expect(action(vm.id)).resolves.toEqual(vm);
    expect(hit).toBe(`${vm.id}/${verb}`);
  });

  it("delete resolves on an empty 202", async () => {
    signInForVmApi();
    let method = "";
    mswServer.use(
      http.delete(`${API}/vms/:id`, ({ request }) => {
        method = request.method;
        return new HttpResponse(null, { status: 202 });
      }),
    );
    await expect(deleteVm(vm.id)).resolves.toBeUndefined();
    expect(method).toBe("DELETE");
  });

  it("keep a VM id inside its own path segment", async () => {
    signInForVmApi();
    let path = "";
    mswServer.use(
      http.delete(`${API}/vms/:id`, ({ request }) => {
        path = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 202 });
      }),
    );
    await deleteVm("i-0123456789abcdef0/../x");
    expect(path).toBe(`${API}/vms/i-0123456789abcdef0%2F..%2Fx`);
  });
});

describe("base URL", () => {
  it("is fabrium_api_url when set, without a trailing slash", async () => {
    signInForVmApi();
    setFabriumApiUrl("https://api.example.org/");
    mswServer.use(
      http.get("https://api.example.org/_fabrium/v1/vms", () =>
        HttpResponse.json([vm]),
      ),
    );
    await expect(listVms()).resolves.toEqual([vm]);
  });
});
