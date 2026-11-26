import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatrixClient } from "matrix-js-sdk";
import { MatrixClientPeg } from "@/client/peg";
import { injectStateEvent, makeFakeClient, makeMatrixEvent, makeRoom, mkMatrixEvent } from "../../test/factories";
import {
  ArtifactEventType,
  decodeArtifactVersion,
  mayAuthorArtifact,
  sendArtifactVersion,
} from "./fabrium-artifact";

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
      basedOn: undefined,
      summary: undefined,
    });
    const sha256 = "a".repeat(64);
    expect(decodeArtifactVersion(event({ identifier: "big", type: "markdown", url: "mxc://h/x", sha256 }))).toMatchObject({
      title: "big",
      mxc: "mxc://h/x",
      sha256,
    });
  });

  it("decodes the slides, design and design-system kinds", () => {
    for (const type of ["slides", "design", "design-system"])
      expect(decodeArtifactVersion(event({ identifier: "p", type, body: "x" }))?.kind).toBe(type);
  });

  it("rejects unknown types and media without a hash", () => {
    expect(decodeArtifactVersion(event({ identifier: "p", type: "mermaid", body: "x" }))).toBeNull();
    expect(decodeArtifactVersion(event({ identifier: "p", type: "html", url: "mxc://h/x" }))).toBeNull();
  });
});

describe("based_on and summary", () => {
  it("keeps an event ID and one clamped line, drops anything else", () => {
    const d = decodeArtifactVersion(
      event({ identifier: "p", type: "html", body: "x", based_on: "$v1:h", summary: `Moved\nslide 3  ${"x".repeat(300)}` }),
    )!;
    expect(d.basedOn).toBe("$v1:h");
    expect(d.summary).toMatch(/^Moved slide 3 x+$/);
    expect(d.summary).toHaveLength(120);
    const bad = decodeArtifactVersion(event({ identifier: "p", type: "html", body: "x", based_on: "v1", summary: 3 }))!;
    expect([bad.basedOn, bad.summary]).toEqual([undefined, undefined]);
  });
});

describe("mayAuthorArtifact", () => {
  afterEach(() => MatrixClientPeg.reset());
  const member = (roomId: string, userId: string, membership = "join") =>
    mkMatrixEvent({ roomId, sender: userId, type: "m.room.member", stateKey: userId, content: { membership } });

  function setup(events: Record<string, number> = {}) {
    const client = makeFakeClient({ userId: "@me:h" });
    const room = makeRoom("!r:h", { client, myUserId: "@me:h", powerLevels: { "@admin:h": 90 } });
    const space = makeRoom("!space:h", { client, myUserId: "@me:h" });
    space.updateMyMembership("join");
    (client as unknown as { addRoom(r: unknown): void }).addRoom(room);
    (client as unknown as { addRoom(r: unknown): void }).addRoom(space);
    MatrixClientPeg.injectClientForTest(client);
    for (const id of ["@me:h", "@admin:h", "@guest:h", "@agent:h"]) injectStateEvent(room, member("!r:h", id));
    injectStateEvent(room, member("!r:h", "@left:h", "leave"));
    for (const id of ["@me:h", "@admin:h"]) injectStateEvent(space, member("!space:h", id));
    injectStateEvent(
      room,
      mkMatrixEvent({ roomId: "!r:h", sender: "@admin:h", type: "m.space.parent", stateKey: "!space:h", content: { via: ["h"] } }),
    );
    injectStateEvent(
      room,
      mkMatrixEvent({
        roomId: "!r:h",
        sender: "@admin:h",
        type: "m.room.power_levels",
        stateKey: "",
        content: { users: { "@admin:h": 90 }, events_default: 0, events },
      }),
    );
    return room;
  }

  it("allows joined members at the event's power level, never guests", () => {
    const room = setup();
    expect(mayAuthorArtifact(room, "@me:h", false)).toBe(true);
    expect(mayAuthorArtifact(room, "@left:h", false)).toBe(false);
    expect(mayAuthorArtifact(room, "@nobody:h", false)).toBe(false);
    // A member outside the project space is a guest; an agent is not judged by the space.
    expect(mayAuthorArtifact(room, "@guest:h", false)).toBe(false);
    expect(mayAuthorArtifact(room, "@agent:h", true)).toBe(true);
    expect(mayAuthorArtifact(null, "@me:h", false)).toBe(false);
  });

  it("follows the power level the room requires for the event type", () => {
    const room = setup({ [ArtifactEventType]: 50 });
    expect(mayAuthorArtifact(room, "@me:h", false)).toBe(false);
    expect(mayAuthorArtifact(room, "@admin:h", false)).toBe(true);
  });
});

describe("sendArtifactVersion", () => {
  const client = (calls: unknown[]) =>
    ({
      sendEvent: vi.fn(async (...args: unknown[]) => {
        calls.push(args);
        return { event_id: "$new" };
      }),
      uploadContent: vi.fn(async () => ({ content_uri: "mxc://h/big" })),
    }) as unknown as MatrixClient;

  it("sends a small body inline, in the thread, with based_on and summary", async () => {
    const calls: unknown[] = [];
    const id = await sendArtifactVersion(client(calls), "!r:h", "$root", {
      identifier: "deck",
      kind: "slides",
      title: "Deck",
      text: "<section></section>",
      basedOn: "$v1",
      summary: "Moved slide 3",
    });
    expect(id).toBe("$new");
    expect(calls[0]).toEqual([
      "!r:h",
      "$root",
      ArtifactEventType,
      {
        identifier: "deck",
        type: "slides",
        title: "Deck",
        body: "<section></section>",
        based_on: "$v1",
        summary: "Moved slide 3",
        "m.relates_to": { rel_type: "m.thread", event_id: "$root" },
      },
    ]);
  });

  it("uploads a large body with its hash, and refuses one over 512 KB", async () => {
    const calls: unknown[] = [];
    const c = client(calls);
    await sendArtifactVersion(c, "!r:h", "$root", { identifier: "d", kind: "html", title: "D", text: "x".repeat(60_000) });
    expect((calls[0] as unknown[])[3]).toMatchObject({ url: "mxc://h/big", size: 60_000, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect((calls[0] as Record<string, unknown>[])[3]!.body).toBeUndefined();
    await expect(
      sendArtifactVersion(c, "!r:h", "$root", { identifier: "d", kind: "html", title: "D", text: "x".repeat(600_000) }),
    ).rejects.toThrow("The limit is 512 KB");
  });
});
