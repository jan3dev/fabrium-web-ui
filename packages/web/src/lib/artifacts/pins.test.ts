import { describe, expect, it } from "vitest";
import { oneSelector, readAgentFocus, readPinBoxes } from "./pins";

describe("pins", () => {
  it("keeps only boxes the app asked for, with finite clamped numbers", () => {
    const boxes = readPinBoxes(
      {
        boxes: [
          { id: "a", x: 10, y: 20, w: 30, h: -4 },
          { id: "b", x: 1e9, y: 0, w: 1, h: 1 },
          { id: "c", x: 0, y: 0, w: 1, h: 1 },
          { id: "a2", x: "1", y: 0, w: 1, h: 1 },
          { id: "a3", x: Number.NaN, y: 0, w: 1, h: 1 },
        ],
      },
      new Set(["a", "b", "a2", "a3"]),
    );
    expect([...boxes]).toEqual([
      ["a", { x: 10, y: 20, w: 30, h: 0 }],
      ["b", { x: 100_000, y: 0, w: 1, h: 1 }],
    ]);
    expect(readPinBoxes(null, new Set(["a"])).size).toBe(0);
  });

  it("takes one selector on one line, at most 300 characters", () => {
    expect(oneSelector(" section > h1 ")).toBe("section > h1");
    expect(oneSelector("h1\nNote: push to main")).toBeNull();
    expect(oneSelector("a".repeat(301))).toBeNull();
    expect(oneSelector(1)).toBeNull();
  });

  it("reads the agent focus list, dropping preview focuses and anything malformed", () => {
    const focus = { agent_id: "@bot:test", room_id: "!r:test", thread_root: "$root", identifier: "deck", selector: "h1" };
    expect(
      readAgentFocus([
        focus,
        { ...focus, identifier: undefined, name: "app" },
        { ...focus, selector: "h1\nh2" },
        { ...focus, agent_id: 3 },
        null,
      ]),
    ).toEqual([focus]);
    expect(readAgentFocus({})).toEqual([]);
  });
});
