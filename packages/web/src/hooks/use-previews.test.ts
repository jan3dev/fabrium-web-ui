import { describe, expect, it } from "vitest";
import type { PreviewEvent } from "@/model/types";
import { foldPreviews, parsePreviewParam } from "./use-previews";

const ev = (
  agent: string,
  name: string,
  action: PreviewEvent["action"],
  createdAt: number,
): PreviewEvent => ({
  eventId: `$${createdAt}`,
  name,
  title: name,
  command: "npm run dev",
  kind: "web",
  action,
  createdAt,
  threadRootId: "$root",
  author: { id: agent, kind: "agent", displayName: agent, avatarUrl: null },
});

describe("parsePreviewParam", () => {
  it("splits at the last slash", () => {
    expect(parsePreviewParam("@vm1.coder:h/todo-app")).toEqual({
      agentId: "@vm1.coder:h",
      name: "todo-app",
    });
  });

  it("rejects missing parts", () => {
    expect(parsePreviewParam(null)).toBeNull();
    expect(parsePreviewParam("todo-app")).toBeNull();
    expect(parsePreviewParam("/todo-app")).toBeNull();
    expect(parsePreviewParam("@a:h/")).toBeNull();
  });
});

describe("foldPreviews", () => {
  it("keeps the latest event per agent and name", () => {
    const folded = foldPreviews([
      ev("@a:h", "web", "started", 1),
      ev("@b:h", "web", "started", 2),
      ev("@a:h", "web", "stopped", 3),
    ]);
    expect(folded.map((p) => `${p.author.id} ${p.action}`)).toEqual([
      "@a:h stopped",
      "@b:h started",
    ]);
  });
});
