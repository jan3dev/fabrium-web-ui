import type { Meta, StoryObj } from "@storybook/react-vite";
import { CanvasToolbar } from "./canvas-toolbar";

const meta = {
  title: "Artifacts/CanvasToolbar",
  component: CanvasToolbar,
  args: { selected: 0, onInsert: () => {}, onAction: () => {}, onUpload: () => {} },
} satisfies Meta<typeof CanvasToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NothingSelected: Story = {};
export const TwoSelected: Story = { args: { selected: 2 } };

/** The toolbar collapses by the width of its container (the stage). */
const inWidth = (width: number): Story => ({
  args: { selected: 2 },
  decorators: [(S) => <div className="@container flex justify-center" style={{ width }}><S /></div>],
});
export const Medium = inWidth(560);
export const Narrow = inWidth(320);
