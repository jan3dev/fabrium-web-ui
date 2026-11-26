import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Point } from "@/lib/artifacts/refs";
import { DrawToggle, SketchOverlay } from "./sketch-overlay";

const QUEUED: Point[] = [
  [300, 200],
  [700, 180],
  [760, 420],
  [320, 440],
  [300, 210],
];

const meta = {
  title: "Artifacts/SketchOverlay",
  component: SketchOverlay,
  parameters: { layout: "padded" },
  args: {
    // A 1920x1080 slide drawn at 30% on the stage.
    box: { x: 24, y: 24, w: 576, h: 324 },
    width: 1920,
    height: 1080,
    marks: [QUEUED],
    drawing: false,
    onStroke: () => {},
  },
  render: function Drawing(args) {
    const [on, setOn] = useState(args.drawing);
    const [marks, setMarks] = useState(args.marks);
    return (
      <div className="flex flex-col items-start gap-2">
        <DrawToggle on={on} onChange={setOn} />
        <div className="relative h-[372px] w-[624px] rounded-card border border-border bg-surface-secondary">
          <div
            className="absolute rounded-utility bg-surface-primary"
            style={{ left: args.box!.x, top: args.box!.y, width: args.box!.w, height: args.box!.h }}
          />
          <SketchOverlay {...args} drawing={on} marks={marks} onStroke={(p) => setMarks([...marks, p])} />
        </div>
      </div>
    );
  },
} satisfies Meta<typeof SketchOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One queued markup; Draw is off. */
export const Queued: Story = {};
/** Draw is on: drag on the slide to add a markup. */
export const Drawing: Story = { args: { drawing: true, marks: [] } };
