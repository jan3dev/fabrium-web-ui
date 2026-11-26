import type { Meta, StoryObj } from "@storybook/react-vite";
import { WhiteboardToolbar } from "./whiteboard-toolbar";

const meta = {
  title: "Artifacts/WhiteboardToolbar",
  component: WhiteboardToolbar,
  args: {
    selected: 0,
    edge: null,
    canDelete: false,
    onAdd: () => {},
    onUpload: () => {},
    onColor: () => {},
    onEdge: () => {},
    onReverse: () => {},
    onLabel: () => {},
    onConnect: () => {},
    onGroup: () => {},
    onDelete: () => {},
    zoom: null,
    scale: 0.64,
    onZoom: () => {},
    onRequest: () => {},
    onArea: () => {},
  },
} satisfies Meta<typeof WhiteboardToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NothingSelected: Story = {};
export const TwoSelected: Story = { args: { selected: 2, canDelete: true } };
/** A connection selected: its arrowheads, line style, direction and label. */
export const ConnectionSelected: Story = {
  args: { edge: { from: "a", to: "b", style: "dashed", color: "blue" }, canDelete: true },
};
/** Without edit rights: the zoom and the agent's actions. */
export const ReadOnly: Story = { args: { onAdd: undefined, onUpload: undefined } };
/** An agent viewing: the zoom only. */
export const Agent: Story = { args: { onAdd: undefined, onUpload: undefined, onRequest: undefined, onArea: undefined } };
