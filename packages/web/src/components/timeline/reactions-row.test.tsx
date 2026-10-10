import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TimelineReaction } from "@/model/types";
import { ReactionsRow } from "./reactions-row";

vi.mock("./reaction-picker-emoji", () => ({
  default: ({ onPick }: { onPick: (emoji: string) => void }) => (
    <button type="button" data-testid="stub-emoji" onClick={() => onPick("🚀")}>
      stub
    </button>
  ),
}));

const roomId = "!r:h.example";
const thumbs: TimelineReaction = { emoji: "👍", count: 3, reactedByMe: false, actorIds: ["@a:h", "@b:h", "@c:h"] };
const party: TimelineReaction = { emoji: "🎉", count: 1, reactedByMe: true, myEventId: "$mine", actorIds: ["@me:h"] };

describe("<ReactionsRow>", () => {
  it("renders nothing without reactions", () => {
    const { container } = render(<ReactionsRow roomId={roomId} reactions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a pill per emoji with its count, pressed when it is mine", () => {
    render(<ReactionsRow roomId={roomId} reactions={[thumbs, party]} />);
    expect(screen.getByRole("button", { name: "👍 3" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "🎉 1" })).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles the clicked emoji", async () => {
    const onToggle = vi.fn();
    render(<ReactionsRow roomId={roomId} reactions={[party]} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: "🎉 1" }));
    expect(onToggle).toHaveBeenCalledWith("🎉");
  });

  it("adds a reaction from the picker", async () => {
    const onToggle = vi.fn();
    render(<ReactionsRow roomId={roomId} reactions={[thumbs]} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: /add reaction/i }));
    await userEvent.click(await screen.findByTestId("stub-emoji"));
    expect(onToggle).toHaveBeenCalledWith("🚀");
  });
});
