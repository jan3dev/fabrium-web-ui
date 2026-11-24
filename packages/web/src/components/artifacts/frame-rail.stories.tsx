import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { readFrames } from "@/lib/artifacts/frames";
import { buildArtifactSrcdoc } from "@/lib/artifacts/srcdoc";
import { FrameControls, FrameRail } from "./frame-rail";

const NAMES = ["Launch plan", "Why now", "Pricing", "Rollout", "A very long slide name that does not fit the rail"];
const DECK = `<!doctype html><html><head><style>section{display:flex;align-items:center;justify-content:center;font:600 120px system-ui;background:rgb(240,244,255)}</style></head><body>${NAMES.map(
  (n, i) => `<section${i === 3 ? " data-skip" : ""}><h1>${n}</h1><aside data-notes>Notes for ${n}.</aside></section>`,
).join("")}</body></html>`;
const CHANNEL = "story-rail";
const SRCDOC = buildArtifactSrcdoc("slides", DECK, CHANNEL);
const FRAMES = readFrames("slides", DECK);

const meta = {
  title: "Artifacts/FrameRail",
  component: FrameRail,
  parameters: { layout: "fullscreen" },
  args: { label: "Slides", frames: FRAMES, srcdoc: SRCDOC, channel: CHANNEL, active: 1, onSelect: () => {} },
  render: function Selectable(args) {
    const [active, setActive] = useState(args.active);
    return (
      <div className="flex h-[32rem]">
        <FrameRail {...args} active={active} onSelect={setActive} />
      </div>
    );
  },
} satisfies Meta<typeof FrameRail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Slides: Story = {};

export const Grid: Story = { args: { grid: true } };

/** With edit rights: slide menus, drag to move, Add at the end; slide 2 changed by a person. */
export const Editable: Story = {
  args: {
    edit: { kind: "slides", onAction: () => {}, onMove: () => {} },
    changed: { indexes: [1], actor: "human" },
  },
};

const bar = (children: React.ReactNode) => <div className="flex items-center gap-1 p-2">{children}</div>;

export const SlideControls: Story = {
  render: function Controls() {
    const [zoom, setZoom] = useState<number | null>(null);
    const [grid, setGrid] = useState(false);
    return bar(
      <FrameControls zoom={zoom} onZoom={setZoom} grid={grid} onGrid={setGrid} onPresent={() => {}} notes />,
    );
  },
};

export const Presenting: Story = {
  render: () => bar(<FrameControls presenting onEnd={() => {}} />),
};

export const DesignControls: Story = {
  render: function Controls() {
    const [zoom, setZoom] = useState<number | null>(null);
    return bar(<FrameControls zoom={zoom} onZoom={setZoom} />);
  },
};
