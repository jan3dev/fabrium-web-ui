import { describe, expect, it } from "vitest";
import type { ActorSummary, TimelineMessage } from "@/model/types";
import { artifactComments, sourceHas } from "./comments";
import type { ArtifactRef } from "./refs";

const ana: ActorSummary = { id: "@ana:test", kind: "human", displayName: "Ana", avatarUrl: null };
const humans = new Set(["@ana:test", "@bo:test"]);
const isHuman = (id: string) => humans.has(id);

const ref = (selector: string, extra: Partial<ArtifactRef> = {}): ArtifactRef => ({
  identifier: "deck",
  title: "Deck",
  version: 1,
  event_id: "$v1",
  target: { kind: "element", selector, html: "<h1></h1>", text: "" },
  note: "",
  ...extra,
});

function message(id: string, refs: ArtifactRef[], reactions: TimelineMessage["reactions"] = []): TimelineMessage {
  return {
    id,
    kind: "message",
    createdAt: 1,
    author: ana,
    body: "see this",
    threadRootId: "$root",
    replyToId: null,
    artifactRefs: refs,
    edited: false,
    pending: false,
    failed: false,
    redacted: false,
    reactions,
  };
}

const tick = (actorIds: string[], emoji = "✓") => ({ emoji, count: actorIds.length, reactedByMe: false, actorIds });

describe("artifact comments", () => {
  it("lists every reference to the artifact, one per message and index", () => {
    const list = artifactComments(
      [
        message("$a", [ref("h1"), ref("p", { identifier: "other" })]),
        message("$b", [ref("h2"), ref("h3", { preview: { agent: "@bot:test", path: "/" } })]),
        { ...message("$c", [ref("h4")]), redacted: true },
        { ...message("$d", []), artifactRefs: undefined },
      ],
      "deck",
      isHuman,
    );
    expect(list.map((c) => [c.id, c.ref.target.kind === "element" && c.ref.target.selector])).toEqual([
      ["$a:0", "h1"],
      ["$b:0", "h2"],
    ]);
    expect(list[0]).toMatchObject({ messageId: "$a", text: "see this", author: ana });
  });

  it("is resolved by a check reaction from a human, never from an agent", () => {
    const open = artifactComments(
      [
        message("$a", [ref("h1")], [tick(["@bot:test"])]),
        message("$b", [ref("h1")], [tick(["@bot:test", "@bo:test"], "✅")]),
        message("$c", [ref("h1")], [tick(["@ana:test"], "👍")]),
      ],
      "deck",
      isHuman,
    );
    expect(open.map((c) => c.id)).toEqual(["$a:0", "$c:0"]);
  });

  it("is resolved when a later version no longer has its target, not by the version it was made on", () => {
    const latest = { eventId: "$v2", has: sourceHas("slides", "<section><h1>Hi</h1></section>") };
    const list = artifactComments(
      [message("$a", [ref("section > h1"), ref("section > h2"), ref("h2", { event_id: "$v2" })])],
      "deck",
      isHuman,
      latest,
    );
    expect(list.map((c) => c.id)).toEqual(["$a:0", "$a:2"]);
  });

  it("checks selectors only against DOM sources, and an invalid selector never resolves", () => {
    expect(sourceHas("html", "<p class='a'>x</p>")("p.a")).toBe(true);
    expect(sourceHas("html", "<p>x</p>")("p.b")).toBe(false);
    expect(sourceHas("html", "<p>x</p>")("p[")).toBe(true);
    expect(sourceHas("react", "export default () => null")("p.b")).toBe(true);
    expect(sourceHas("design-system", "{}")("p.b")).toBe(true);
  });
});
