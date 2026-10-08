import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AgentTurn, ToolTranscriptItem } from "@/model/agent-activity";
import { TurnBlock } from "./turn-block";

const tool = (over: Partial<ToolTranscriptItem>): ToolTranscriptItem => ({
  type: "tool",
  id: "tc1",
  title: "Edit auth.ts",
  toolKind: "edit",
  status: "completed",
  rawInput: { file_path: "/repo/auth.ts" },
  content: null,
  diffs: [],
  locations: [],
  startedAt: 0,
  lastActivityAt: 0,
  ...over,
});

const turn = (over: Partial<AgentTurn>): AgentTurn => ({
  id: "t1",
  sessionId: "s1",
  agent: { id: "@coder:h.example", kind: "agent", displayName: "Coder · Payments", avatarUrl: null },
  threadRootId: "$root",
  items: [tool({})],
  startedAt: 1_000,
  endedAt: 43_000,
  ...over,
});

describe("<TurnBlock />", () => {
  it("sums up an ended turn and starts collapsed", () => {
    render(<TurnBlock turn={turn({ items: [tool({ id: "a" }), tool({ id: "b", toolKind: "read" })] })} />);
    const block = screen.getByTestId("agent-turn");
    expect(block).toHaveTextContent("Coder · Payments used 2 tools");
    expect(block).toHaveTextContent("42s");
    expect(block).not.toHaveAttribute("open");
    expect(screen.queryByTestId("transcript-tool-item")).toBeNull();
  });

  it("is open while running and shows liveness", () => {
    render(<TurnBlock turn={turn({ endedAt: null, items: [tool({ status: "in_progress" })] })} />);
    expect(screen.getByTestId("agent-turn")).toHaveAttribute("open");
    expect(screen.getByTestId("agent-turn")).toHaveTextContent("is working · 1 tool");
    expect(screen.getByTestId("turn-liveness-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("transcript-tool-item")).toHaveTextContent("Editing");
  });

  it("collapses when the turn ends", () => {
    const { rerender } = render(<TurnBlock turn={turn({ endedAt: null })} />);
    expect(screen.getByTestId("agent-turn")).toHaveAttribute("open");
    rerender(<TurnBlock turn={turn({})} />);
    expect(screen.getByTestId("agent-turn")).not.toHaveAttribute("open");
  });

  it("expands a tool to the diff its update delivered", async () => {
    const user = userEvent.setup();
    render(
      <TurnBlock
        turn={turn({
          endedAt: null,
          items: [tool({ diffs: [{ path: "/repo/auth.ts", oldText: "a\n", newText: "b\n" }] })],
        })}
      />,
    );
    const item = screen.getByTestId("transcript-tool-item");
    expect(item).toHaveTextContent("+1-1");
    await user.click(within(item).getByText("Edited"));
    expect(within(item).getByText("b")).toBeInTheDocument();
  });
});
