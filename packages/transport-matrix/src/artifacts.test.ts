import { describe, expect, it, vi } from "vitest";
import {
  applyArtifactEdits,
  ARTIFACT_EVENT_TYPE,
  validateArtifactInput,
} from "./artifacts.js";
import { MatrixContextProvider } from "./context-provider.js";
import type { MatrixClient } from "./matrix-client.js";

describe("applyArtifactEdits", () => {
  it("applies pairs in order, tolerating re-indented old_str", () => {
    const base = "<div>\n    <b>hi</b>\n</div>";
    expect(
      applyArtifactEdits(base, [
        { old_str: "<b>hi</b>", new_str: "<b>hello</b>" },
        { old_str: "<div>\n  <b>hello</b>", new_str: "<p>\n<b>hello</b>" },
      ]),
    ).toBe("<p>\n<b>hello</b>\n</div>");
  });

  it("fails on a missing or ambiguous old_str instead of skipping it", () => {
    expect(() =>
      applyArtifactEdits("a a", [{ old_str: "a", new_str: "b" }]),
    ).toThrow(/more than once/);
    expect(() =>
      applyArtifactEdits("abc", [{ old_str: "x", new_str: "y" }]),
    ).toThrow(/edit 1 old_str not found/);
  });
});

describe("validateArtifactInput", () => {
  it("wants exactly one of content and edits, and a type with content", () => {
    expect(() => validateArtifactInput({ identifier: "a" })).toThrow(/either/);
    expect(() =>
      validateArtifactInput({ identifier: "a", content: "x" }),
    ).toThrow(/type/);
    expect(() =>
      validateArtifactInput({
        identifier: "bad id",
        type: "html",
        content: "x",
      }),
    ).toThrow(/identifier/);
    expect(() =>
      validateArtifactInput({ identifier: "a", type: "html", content: "x" }),
    ).not.toThrow();
  });
});

describe("MatrixContextProvider.sendArtifact", () => {
  const me = "@ws.coder:hs";
  function setup(chunk: Array<Record<string, unknown>> = []) {
    const sendCustomEvent = vi.fn().mockResolvedValue({ event_id: "$new" });
    const fetchThreadRelations = vi.fn().mockResolvedValue({ chunk });
    const upload = vi.fn().mockResolvedValue({ content_uri: "mxc://hs/big" });
    const download = vi.fn();
    const provider = new MatrixContextProvider({
      client: {
        sendCustomEvent,
        fetchThreadRelations,
      } as unknown as MatrixClient,
      asUserId: me,
      agentBots: new Map(),
      media: { upload, download },
    });
    return { provider, sendCustomEvent, fetchThreadRelations, upload, download };
  }

  it("sends a full version inline, threaded", async () => {
    const { provider, sendCustomEvent } = setup();
    await provider.sendArtifact("!r:hs", "$root", {
      identifier: "page",
      type: "html",
      title: "Page",
      content: "<p>x</p>",
    });
    expect(sendCustomEvent).toHaveBeenCalledWith({
      roomId: "!r:hs",
      asUserId: me,
      eventType: ARTIFACT_EVENT_TYPE,
      content: {
        identifier: "page",
        type: "html",
        title: "Page",
        body: "<p>x</p>",
        "m.relates_to": { rel_type: "m.thread", event_id: "$root" },
      },
    });
  });

  it("applies edits to its own latest version, ignoring other senders", async () => {
    const { provider, sendCustomEvent, fetchThreadRelations } = setup([
      {
        sender: "@human:hs",
        content: {
          identifier: "page",
          type: "html",
          title: "Forged",
          body: "evil",
        },
      },
      {
        sender: me,
        content: {
          identifier: "page",
          type: "html",
          title: "Page",
          body: "<b>v2</b>",
        },
      },
      {
        sender: me,
        content: {
          identifier: "page",
          type: "html",
          title: "Page",
          body: "<b>v1</b>",
        },
      },
    ]);
    await provider.sendArtifact("!r:hs", "$root", {
      identifier: "page",
      edits: [{ old_str: "v2", new_str: "v3" }],
    });
    expect(fetchThreadRelations.mock.calls[0]![0]).toMatchObject({
      eventType: ARTIFACT_EVENT_TYPE,
      dir: "b",
    });
    expect(sendCustomEvent.mock.calls[0]![0].content).toMatchObject({
      type: "html",
      title: "Page",
      body: "<b>v3</b>",
    });
  });

  it("refuses edits with no earlier version", async () => {
    const { provider } = setup();
    await expect(
      provider.sendArtifact("!r:hs", "$root", {
        identifier: "page",
        edits: [{ old_str: "a", new_str: "b" }],
      }),
    ).rejects.toThrow(/not_found/);
  });

  it("moves bodies over 48 KB to the media repo with a sha256", async () => {
    const { provider, sendCustomEvent, upload } = setup();
    await provider.sendArtifact("!r:hs", "$root", {
      identifier: "big",
      type: "markdown",
      title: "Big",
      content: "x".repeat(60_000),
    });
    expect(upload).toHaveBeenCalled();
    const content = sendCustomEvent.mock.calls[0]![0].content;
    expect(content.body).toBeUndefined();
    expect(content).toMatchObject({ url: "mxc://hs/big", size: 60_000 });
    expect(content.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("measures the inline limit as encoded JSON", async () => {
    const { provider, upload } = setup();
    // 30 KB of raw text, 60 KB once every newline is escaped.
    await provider.sendArtifact("!r:hs", "$root", { identifier: "lines", type: "code", content: "\n".repeat(30_000) });
    expect(upload).toHaveBeenCalled();
  });

  it("refuses an artifact outside a thread", async () => {
    const { provider } = setup();
    await expect(
      provider.sendArtifact("!r:hs", "", { identifier: "page", type: "html", content: "x" }),
    ).rejects.toThrow(/unsupported/);
  });

  it("refuses to edit media whose bytes do not match the pinned sha256", async () => {
    const { provider, download } = setup([
      { sender: me, content: { identifier: "big", type: "markdown", title: "Big", url: "mxc://hs/big", sha256: "0".repeat(64) } },
    ]);
    download.mockResolvedValue({ data: new TextEncoder().encode("swapped") });
    await expect(
      provider.sendArtifact("!r:hs", "$root", { identifier: "big", edits: [{ old_str: "a", new_str: "b" }] }),
    ).rejects.toThrow(/media_mismatch/);
  });
});

