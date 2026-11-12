import { describe, expect, it } from "vitest";
import { makeMatrixEvent } from "../../test/factories";
import { decodePreview, PreviewContentKey } from "./fabrium-preview";

const event = (preview: unknown, type = "m.room.message") =>
  makeMatrixEvent({
    eventId: "$p",
    roomId: "!r:h",
    sender: "@coder:h",
    type,
    content: { msgtype: "m.notice", body: "Preview: Todo app", [PreviewContentKey]: preview },
  });

describe("decodePreview", () => {
  it("decodes a started preview", () => {
    expect(
      decodePreview(event({ name: "todo-app", title: "Todo app", command: "npm run dev", action: "started" })),
    ).toEqual({ name: "todo-app", title: "Todo app", command: "npm run dev", kind: "web", action: "started" });
  });

  it("decodes an Expo app, and reads an unknown kind as web", () => {
    expect(decodePreview(event({ name: "todo", kind: "expo", action: "started" }))?.kind).toBe("expo");
    expect(decodePreview(event({ name: "todo", kind: "ios", action: "started" }))?.kind).toBe("web");
  });

  it("falls back to the name as title", () => {
    expect(decodePreview(event({ name: "todo-app", action: "stopped" }))).toEqual({
      name: "todo-app",
      title: "todo-app",
      command: "",
      kind: "web",
      action: "stopped",
    });
  });

  it("rejects bad names, unknown actions and other event types", () => {
    expect(decodePreview(event({ name: "Todo App", action: "started" }))).toBeNull();
    expect(decodePreview(event({ name: "-x", action: "started" }))).toBeNull();
    expect(decodePreview(event({ name: "a".repeat(41), action: "started" }))).toBeNull();
    expect(decodePreview(event({ name: "todo", action: "crashed" }))).toBeNull();
    expect(decodePreview(event("todo"))).toBeNull();
    expect(decodePreview(event({ name: "todo", action: "started" }, "m.room.notice"))).toBeNull();
  });
});
