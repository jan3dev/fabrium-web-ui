import { describe, expect, it } from "vitest";
import type { DecodedZooidEvent } from "@/events/zooid-events";
import { toTranscriptItems } from "./from-zooid";

const at = (ts: number, decoded: DecodedZooidEvent) => ({ ts, decoded });
const call = (id: string, extra: Partial<Extract<DecodedZooidEvent, { kind: "tool_call" }>> = {}) =>
  ({ kind: "tool_call", sessionId: "s1", toolCallId: id, title: `Tool ${id}`, toolKind: "execute", ...extra }) as const;
const update = (id: string, extra: Partial<Extract<DecodedZooidEvent, { kind: "tool_call_update" }>>) =>
  ({ kind: "tool_call_update", sessionId: "s1", toolCallId: id, status: "in_progress", ...extra }) as const;

describe("toTranscriptItems", () => {
  it("folds updates into their tool call: newest status and output, merged input", () => {
    const items = toTranscriptItems([
      at(1, call("a", { rawInput: { url: "https://x.test" } })),
      at(2, update("a", { status: "in_progress", rawInput: { timeout: 5 } })),
      at(3, update("a", { status: "completed", content: "done", diffs: [{ path: "f", oldText: "", newText: "x" }] })),
    ]);
    expect(items).toEqual([
      expect.objectContaining({
        type: "tool",
        id: "a",
        status: "completed",
        rawInput: { url: "https://x.test", timeout: 5 },
        content: "done",
        diffs: [{ path: "f", oldText: "", newText: "x" }],
        startedAt: 1,
        lastActivityAt: 3,
      }),
    ]);
  });

  it("keeps tool order and skips updates whose call is not loaded", () => {
    const items = toTranscriptItems([at(1, update("ghost", {})), at(2, call("a")), at(3, call("b"))]);
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("keeps one plan per turn: the newest entries in the first plan's place", () => {
    const plan = (content: string): DecodedZooidEvent => ({
      kind: "plan",
      sessionId: "s1",
      entries: [{ content, status: "pending" }],
    });
    const items = toTranscriptItems([at(1, plan("v1")), at(2, call("a")), at(3, plan("v2"))]);
    expect(items.map((i) => i.type)).toEqual(["plan", "tool"]);
    expect(items[0]).toMatchObject({ entries: [{ content: "v2" }], updatedAt: 3 });
  });

  it("takes a tool's input from its approval request when no event carried one", () => {
    const items = toTranscriptItems([at(1, call("a"))], new Map([["a", { command: "rm -rf dist" }]]));
    expect(items[0]).toMatchObject({ rawInput: { command: "rm -rf dist" } });
  });
});
