import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type Board, readBoard } from "@/lib/artifacts/whiteboard";
import { AnnotationForm } from "./artifact-refs";
import { WhiteboardBoard } from "./whiteboard-board";

const BOARD: Board = readBoard(
  JSON.stringify({
    nodes: [
      { id: "s1", type: "section", x: 0, y: 0, w: 520, h: 300, text: "Problems" },
      { id: "a", type: "note", x: 32, y: 64, w: 200, h: 140, text: "Sign-up takes too long" },
      { id: "b", type: "note", x: 280, y: 64, w: 200, h: 140, text: "Nobody reads the welcome email", color: "pink" },
      { id: "c", type: "shape", shape: "diamond", x: 640, y: 80, w: 180, h: 140, text: "Ship it?", color: "purple" },
      { id: "d", type: "shape", shape: "oval", x: 900, y: 90, w: 180, h: 120, text: "Launch", color: "green" },
      { id: "e", type: "text", x: 640, y: 280, w: 420, h: 48, text: "Every string is text, never markup <b>like this</b>" },
      { id: "f", type: "image", x: 32, y: 360, w: 240, h: 160, text: "A missing image" },
      ...(["yellow", "orange", "red", "pink", "purple", "blue", "green", "gray"] as const).map((color, i) => ({
        id: `c${i}`,
        type: "note",
        x: 320 + i * 100,
        y: 380,
        w: 88,
        h: 88,
        text: color,
        color,
      })),
    ],
    edges: [
      { from: "a", to: "c", label: "fix first" },
      { from: "c", to: "d", arrow: "both", style: "dashed", color: "green" },
      { from: "b", to: "e", arrow: "none", style: "dotted", color: "red", label: "maybe" },
    ],
  }),
)!;

const meta = {
  title: "Artifacts/WhiteboardBoard",
  component: WhiteboardBoard,
  args: { board: BOARD, assets: [], mode: "edit", onEdit: () => {}, onRequest: () => {}, onAskArea: () => {} },
  render: function Editable(args) {
    const [board, setBoard] = useState(args.board);
    return (
      <div className="h-[600px] w-full">
        <WhiteboardBoard {...args} board={board} onEdit={(change) => setBoard(change)} />
      </div>
    );
  },
} satisfies Meta<typeof WhiteboardBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Editing: Story = {};
/** Without edit rights: pan, zoom and the agent's actions. */
export const ReadOnly: Story = { args: { mode: "view" } };
/** A phone: view, pan, zoom and retype. */
export const Phone: Story = { args: { mode: "retype", onAskArea: undefined } };
export const Empty: Story = { args: { board: { nodes: [], edges: [] } } };
/** Comment mode: markers on a node and a connection, and the note box open on a node. */
export const Commenting: Story = {
  args: {
    mode: "view",
    comments: {
      markers: [
        { id: "m1", target: { node: "b" }, author: "Ana", onSelect: () => {} },
        { id: "m2", target: { from: "a", to: "c" }, author: "Bo", onSelect: () => {} },
      ],
      draft: {
        target: { node: "d" },
        form: (
          <AnnotationForm
            target={{ kind: "text", where: "whiteboard node d", text: 'Shape "Launch" (id d)' }}
            note=""
            onNoteChange={() => {}}
            onAdd={() => {}}
            onCancel={() => {}}
          />
        ),
        onClose: () => {},
      },
      onPick: () => {},
    },
  },
};
