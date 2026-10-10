import { describe, expect, it } from "vitest";
import type { ToolTranscriptItem } from "@/model/agent-activity";
import { buildToolSummary } from "./tool-summary";

const tool = (over: Partial<ToolTranscriptItem>): ToolTranscriptItem => ({
  type: "tool",
  id: "t",
  title: "Tool",
  toolKind: "other",
  status: "completed",
  rawInput: null,
  content: null,
  diffs: [],
  locations: [],
  startedAt: 0,
  lastActivityAt: 0,
  ...over,
});

describe("buildToolSummary", () => {
  it("names the verb by kind and status, and the object by its input", () => {
    expect(buildToolSummary(tool({ toolKind: "edit", rawInput: { file_path: "/repo/src/auth.ts" } }))).toMatchObject({
      verb: "Edited",
      object: "auth.ts",
      objectTitle: "/repo/src/auth.ts",
    });
    expect(buildToolSummary(tool({ toolKind: "execute", status: "in_progress", rawInput: { command: "pnpm test" } }))).toMatchObject({
      verb: "Running",
      object: "pnpm test",
      shellCommand: "pnpm test",
    });
  });

  it("falls back to the agent's title when the kind has no verb or nothing to name", () => {
    expect(buildToolSummary(tool({ toolKind: "other", title: "mcp__linear__search" })).verb).toBe("mcp__linear__search");
    expect(buildToolSummary(tool({ toolKind: "read", title: "Read file" }))).toMatchObject({ verb: "Read file", object: null });
  });

  it("diffs an old/new string pair from the input and counts the lines", () => {
    const s = buildToolSummary(
      tool({ toolKind: "edit", rawInput: { file_path: "a.ts", old_string: "a\nb\n", new_string: "a\nc\nd\n" } }),
    );
    expect(s.diffs).toEqual([{ path: "a.ts", oldText: "a\nb\n", newText: "a\nc\nd\n" }]);
    expect(s.stats).toEqual({ additions: 2, deletions: 1 });
  });
});
