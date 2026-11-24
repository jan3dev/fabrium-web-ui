import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Board } from "@/lib/artifacts/whiteboard";
import { WhiteboardBoard } from "./whiteboard-board";

const BOARD: Board = { nodes: [{ id: "a", type: "note", x: 0, y: 0, w: 200, h: 120, text: "Idea" }], edges: [] };

it("still takes the pointer after an add that was refused", () => {
  // `onEdit` drops the change, as the panel does at the node limit: the new node never arrives.
  render(<WhiteboardBoard board={BOARD} assets={[]} mode="edit" onEdit={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.pointerDown(screen.getByRole("group", { name: "Idea" }), { button: 0 });
  expect(screen.getByRole("group", { name: "Idea, selected" })).toBeTruthy();
});

it("keeps a selected connection by its ends when the board changes under it", () => {
  const note = (id: string, x: number) => ({ id, type: "note" as const, x, y: 0, w: 100, h: 100, text: id.toUpperCase() });
  const nodes = [note("a", 0), note("b", 200), note("c", 400)];
  const [ab, bc] = [{ from: "a", to: "b" }, { from: "b", to: "c" }];
  const onEdit = vi.fn<(change: (board: Board) => Board, summary: string) => void>();
  const { rerender } = render(<WhiteboardBoard board={{ nodes, edges: [ab, bc] }} assets={[]} mode="edit" onEdit={onEdit} />);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Connection from B to C" }), { button: 0 });
  // An undo or a new version: the same connections in another order.
  const swapped = { nodes, edges: [bc, ab] };
  rerender(<WhiteboardBoard board={swapped} assets={[]} mode="edit" onEdit={onEdit} />);
  expect(screen.getByRole("button", { name: "Connection from B to C" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(screen.getByTestId("whiteboard"), { key: "Delete" });
  expect(onEdit.mock.calls[0]![0](swapped).edges).toEqual([ab]);
});

it("drops a drag whose release never reached the board", () => {
  const onEdit = vi.fn();
  render(<WhiteboardBoard board={BOARD} assets={[]} mode="edit" onEdit={onEdit} />);
  const board = screen.getByTestId("whiteboard");
  fireEvent.pointerDown(screen.getByRole("group", { name: "Idea" }), { button: 0, buttons: 1, clientX: 10, clientY: 10 });
  // Back over the board with no button down: nothing moves, and the next release commits nothing.
  fireEvent.pointerMove(board, { buttons: 0, clientX: 200, clientY: 10 });
  fireEvent.pointerUp(board);
  expect(onEdit).not.toHaveBeenCalled();
});
