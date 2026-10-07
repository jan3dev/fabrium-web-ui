import { describe, expect, it } from "vitest";
import type {
  ActorSummary,
  TimelineEntry,
  TimelineMessage,
} from "@/model/types";
import {
  buildTimelineItems,
  didPrepend,
  MESSAGE_GROUPING_WINDOW_MS,
} from "./timeline-items";

const ana: ActorSummary = {
  id: "@ana:h",
  kind: "human",
  displayName: "Ana",
  avatarUrl: null,
};
const bo: ActorSummary = {
  id: "@bo:h",
  kind: "human",
  displayName: "Bo",
  avatarUrl: null,
};
const day1 = new Date(2026, 9, 6, 10).getTime();
const day2 = new Date(2026, 9, 7, 10).getTime();

function entry(
  id: string,
  author: ActorSummary,
  createdAt: number,
  extra: Partial<TimelineMessage> = {},
): TimelineEntry {
  return {
    message: {
      id,
      kind: "message",
      createdAt,
      author,
      body: id,
      threadRootId: null,
      replyToId: null,
      edited: false,
      pending: false,
      failed: false,
      redacted: false,
      reactions: [],
      ...extra,
    },
    thread: null,
  };
}

const shape = (items: ReturnType<typeof buildTimelineItems>) =>
  items.map((i) =>
    i.kind === "entry" ? `${i.key}${i.isContinuation ? "+" : ""}` : i.kind,
  );

describe("buildTimelineItems", () => {
  it("groups same-author messages inside the window", () => {
    const items = buildTimelineItems([
      entry("a1", ana, day1),
      entry("a2", ana, day1 + 60_000),
      entry("b1", bo, day1 + 120_000),
      entry("b2", bo, day1 + 120_000 + MESSAGE_GROUPING_WINDOW_MS + 1),
      entry("b3", bo, day1 + 120_000 + MESSAGE_GROUPING_WINDOW_MS + 2, {
        pending: true,
      }),
    ]);
    expect(shape(items)).toEqual(["a1", "a2+", "b1", "b2", "b3"]);
    expect(items[0]).toMatchObject({ isFollowedByContinuation: true });
  });

  it("dates only proven day boundaries until history is exhausted", () => {
    const entries = [entry("a", ana, day1), entry("b", ana, day2)];
    expect(shape(buildTimelineItems(entries))).toEqual([
      "a",
      "day-divider",
      "b",
    ]);
    expect(
      shape(
        buildTimelineItems(entries, { historyExhausted: true, leading: true }),
      ),
    ).toEqual(["leading", "day-divider", "a", "day-divider", "b"]);
  });

  it("puts the New divider above the first unread and breaks the group there", () => {
    const items = buildTimelineItems(
      [entry("a1", ana, day1), entry("a2", ana, day1 + 1000)],
      { firstUnreadId: "a2" },
    );
    expect(shape(items)).toEqual(["a1", "unread-divider", "a2"]);
  });
});

describe("didPrepend", () => {
  it("is true only when the old keys are an exact suffix", () => {
    expect(didPrepend(["c", "d"], ["a", "b", "c", "d"])).toBe(true);
    expect(didPrepend(["c", "d"], ["c", "d", "e"])).toBe(false);
    expect(didPrepend(["c", "d"], ["a", "c", "x"])).toBe(false);
    expect(didPrepend([], [])).toBe(false);
  });

  it("holds when older same-day rows load behind an unproven day start", () => {
    const before = buildTimelineItems([entry("b", ana, day2)]).map(
      (i) => i.key,
    );
    const after = buildTimelineItems([
      entry("a", ana, day1),
      entry("a2", ana, day2 - 1000),
      entry("b", ana, day2),
    ]).map((i) => i.key);
    expect(didPrepend(before, after)).toBe(true);
  });
});
