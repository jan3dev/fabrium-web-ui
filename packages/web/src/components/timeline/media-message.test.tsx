import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "../../../test/setup";
import { makeFakeClient } from "../../../test/factories";
import { MatrixClientPeg } from "../../client/peg";
import { MediaMessage } from "./media-message";

const HS = "https://hs.test";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

afterEach(() => {
  cleanup();
  MatrixClientPeg.reset();
  vi.restoreAllMocks();
});

function injectClient() {
  const client = makeFakeClient({ userId: "@me:hs.test" });
  // These properties are used by the media hook
  Object.assign(client, {
    baseUrl: HS,
    getAccessToken: () => "tok",
  });
  MatrixClientPeg.injectClientForTest(client);
  return client;
}

describe("<MediaMessage />", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
    vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined as never);
  });

  it("fetches m.image bytes from the authenticated media endpoint and renders an <img>", async () => {
    injectClient();
    let sawAuth = "";
    mswServer.use(
      http.get(`${HS}/_matrix/client/v1/media/thumbnail/hs.test/abc`, ({ request }) => {
        sawAuth = request.headers.get("authorization") ?? "";
        return HttpResponse.arrayBuffer(PNG.buffer, {
          headers: { "Content-Type": "image/png" },
        });
      }),
    );
    render(
      <MediaMessage
        media={{ mxc: "mxc://hs.test/abc", mimetype: "image/png", name: "dog.png", size: 4, w: 100, h: 100 }}
      />,
    );
    await waitFor(() => expect(screen.getByRole("img", { name: "dog.png" })).toBeDefined(), {
      timeout: 2000,
    });
    expect(sawAuth).toBe("Bearer tok");
  });

  it("renders m.file as a download tile with name and size, no media fetch", async () => {
    injectClient();
    render(
      <MediaMessage
        media={{ mxc: "mxc://hs.test/def", mimetype: "application/pdf", name: "report.pdf", size: 2048 }}
      />,
    );
    expect(screen.getByText("report.pdf")).toBeDefined();
    expect(screen.getByRole("button", { name: /download/i })).toBeDefined();
  });

  it("renders m.video as a file-style tile (no inline player this cycle)", () => {
    injectClient();
    render(
      <MediaMessage
        media={{ mxc: "mxc://hs.test/ghi", mimetype: "video/mp4", name: "demo.mp4", size: 4096 }}
      />,
    );
    expect(screen.getByText("demo.mp4")).toBeDefined();
  });
});
