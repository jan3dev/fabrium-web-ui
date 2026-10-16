import { describe, expect, it } from "vitest";
import { makeMatrixEvent } from "../../test/factories";
import { ArtifactEventType, decodeArtifactVersion } from "./fabrium-artifact";

const event = (content: Record<string, unknown>) =>
  makeMatrixEvent({ eventId: "$a", roomId: "!r:h", sender: "@coder:h", type: ArtifactEventType, content });

describe("decodeArtifactVersion", () => {
  it("decodes inline and media-stored versions", () => {
    expect(decodeArtifactVersion(event({ identifier: "page", type: "html", title: "Page", body: "<p/>" }))).toEqual({
      identifier: "page",
      kind: "html",
      title: "Page",
      language: undefined,
      body: "<p/>",
      mxc: undefined,
      sha256: undefined,
    });
    const sha256 = "a".repeat(64);
    expect(decodeArtifactVersion(event({ identifier: "big", type: "markdown", url: "mxc://h/x", sha256 }))).toMatchObject({
      title: "big",
      mxc: "mxc://h/x",
      sha256,
    });
  });

  it("rejects unknown types and media without a hash", () => {
    expect(decodeArtifactVersion(event({ identifier: "p", type: "mermaid", body: "x" }))).toBeNull();
    expect(decodeArtifactVersion(event({ identifier: "p", type: "html", url: "mxc://h/x" }))).toBeNull();
  });
});
