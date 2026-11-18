import { act, renderHook } from "@testing-library/react";
import type { MatrixClient } from "matrix-js-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixClientPeg } from "@/client/peg";
import type { ArtifactVersion } from "@/model/types";
import { DRAFT_IDLE_MS, useArtifactDraft } from "./use-artifact-draft";

const v1: ArtifactVersion = {
  eventId: "$v1",
  headEventId: "$v1",
  identifier: "deck",
  kind: "slides",
  title: "Deck",
  body: "A",
  version: 1,
  createdAt: 0,
  author: { id: "@agent:h", kind: "agent", displayName: "Coder", avatarUrl: null },
  threadRootId: "$root",
};

describe("useArtifactDraft", () => {
  let sent: Record<string, unknown>[];
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    MatrixClientPeg.injectClientForTest({
      getUserId: () => "@me:h",
      stopClient: () => {},
      sendEvent: async (_r: string, _t: string, _type: string, content: Record<string, unknown>) => {
        sent.push(content);
        return { event_id: `$mine${sent.length}` };
      },
    } as unknown as MatrixClient);
  });
  afterEach(() => {
    vi.useRealTimers();
    MatrixClientPeg.reset();
  });

  const flushTimers = () => act(async () => void (await vi.advanceTimersByTimeAsync(DRAFT_IDLE_MS)));

  it("collects edits into one version after idle, and undo past it sends the older content", async () => {
    const { result } = renderHook(() => useArtifactDraft("!r:h", "$root", v1, "A"));
    act(() => void result.current.apply((t) => `${t}B`, "Added B"));
    act(() => void result.current.apply((t) => `${t}C`, "Added C"));
    expect(result.current.text).toBe("ABC");
    expect(sent).toEqual([]);
    await flushTimers();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ body: "ABC", based_on: "$v1", summary: "Added C and 1 more change", type: "slides" });

    const key = { key: "z", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false };
    act(() => void result.current.onKey(key));
    expect(result.current.text).toBe("AB");
    await flushTimers();
    expect(sent[1]).toMatchObject({ body: "AB", based_on: "$mine1", summary: "Undid: Added C" });

    act(() => void result.current.onKey({ ...key, shiftKey: true }));
    expect(result.current.text).toBe("ABC");
  });

  it("sends nothing when the edits are undone before they go out", async () => {
    const { result } = renderHook(() => useArtifactDraft("!r:h", "$root", v1, "A"));
    act(() => void result.current.apply((t) => `${t}B`, "Added B"));
    act(() => void result.current.onKey({ key: "z", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }));
    await flushTimers();
    expect(sent).toEqual([]);
    // Ctrl+Y redoes; an unsent edit that is undone leaves the summary.
    act(() => void result.current.onKey({ key: "y", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }));
    expect(result.current.text).toBe("AB");
    act(() => void result.current.apply((t) => `${t}C`, "Added C"));
    act(() => void result.current.onKey({ key: "z", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }));
    await flushTimers();
    expect(sent).toEqual([expect.objectContaining({ body: "AB", summary: "Added B" })]);
  });

  it("flushes at once, and a version from someone else clears the history", async () => {
    const { result, rerender } = renderHook(({ v, t }) => useArtifactDraft("!r:h", "$root", v, t), {
      initialProps: { v: v1, t: "A" },
    });
    act(() => void result.current.apply((t) => `${t}B`, "Added B"));
    await act(async () => {
      result.current.flush();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sent).toHaveLength(1);
    rerender({ v: { ...v1, eventId: "$v3", headEventId: "$v3", version: 3 }, t: "agent text" });
    expect(result.current.text).toBeNull();
    act(() => void result.current.onKey({ key: "z", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }));
    expect(result.current.text).toBeNull();
  });
});
