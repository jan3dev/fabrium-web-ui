import { act, fireEvent, render, screen } from "@testing-library/react";
import type { MatrixClient } from "matrix-js-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixClientPeg } from "@/client/peg";
import { useArtifactDraft } from "@/hooks/use-artifact-draft";
import { setFrameNotes } from "@/lib/artifacts/edit";
import type { ArtifactVersion } from "@/model/types";
import { SpeakerNotesField } from "./speaker-notes-field";

const DECK = "<body><section><h1>One</h1></section></body>";
const v1: ArtifactVersion = {
  eventId: "$v1",
  headEventId: "$v1",
  identifier: "deck",
  kind: "slides",
  title: "Deck",
  body: DECK,
  version: 1,
  createdAt: 0,
  author: { id: "@agent:h", kind: "agent", displayName: "Coder", avatarUrl: null },
  threadRootId: "$root",
};

/** The panel's wiring in small: the draft in the parent, the notes field as its child. */
function Panel() {
  const edits = useArtifactDraft("!r:h", "$root", v1, DECK);
  return <SpeakerNotesField value="" onCommit={(n) => edits.apply((t) => setFrameNotes(t, 0, n), "Edited the notes")} />;
}

describe("SpeakerNotesField", () => {
  let sent: Record<string, unknown>[];
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    MatrixClientPeg.injectClientForTest({
      getUserId: () => "@me:h",
      stopClient: () => {},
      sendEvent: async (_r: string, _t: string, _type: string, content: Record<string, unknown>) => {
        sent.push(content);
        return { event_id: "$v2" };
      },
    } as unknown as MatrixClient);
  });
  afterEach(() => {
    vi.useRealTimers();
    MatrixClientPeg.reset();
  });

  it("sends notes typed just before the panel closes, at once, not on a timer left behind", async () => {
    const { unmount } = render(<Panel />);
    fireEvent.change(screen.getByLabelText("Speaker notes"), { target: { value: "Say hi" } });
    await act(async () => {
      unmount();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toContain("<aside data-notes=\"\">Say hi</aside>");
  });

  it("commits on its own once typing stops", async () => {
    const onCommit = vi.fn();
    render(<SpeakerNotesField value="Old" onCommit={onCommit} />);
    fireEvent.change(screen.getByLabelText("Speaker notes"), { target: { value: "New" } });
    await act(async () => void (await vi.advanceTimersByTimeAsync(600)));
    expect(onCommit).toHaveBeenCalledWith("New");
  });

  it("follows notes changed from outside (undo, a moved slide) instead of writing its old text back", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(<SpeakerNotesField value="Mine" onCommit={onCommit} />);
    rerender(<SpeakerNotesField value="Other slide" onCommit={onCommit} />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Speaker notes")).toHaveProperty("value", "Other slide");
  });

  it("keeps a trailing space across its own idle commit, and commits once", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(<SpeakerNotesField value="" onCommit={onCommit} />);
    const field = screen.getByLabelText("Speaker notes");
    fireEvent.change(field, { target: { value: "Say " } });
    await act(async () => void (await vi.advanceTimersByTimeAsync(600)));
    expect(onCommit).toHaveBeenCalledWith("Say ");
    rerender(<SpeakerNotesField value="Say" onCommit={onCommit} />);
    expect(field).toHaveProperty("value", "Say ");
    fireEvent.blur(field);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
