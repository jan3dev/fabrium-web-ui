import type { Meta, StoryObj } from "@storybook/react-vite";
import { buildArtifactSrcdoc } from "@/lib/artifacts/srcdoc";
import { FrameCard, FrameThumb } from "./frame-card";

const DECK = `<!doctype html><html><head><style>section{display:flex;align-items:center;justify-content:center;font:600 140px system-ui;background:rgb(240,244,255)}</style></head>
<body><section><h1>Launch plan</h1></section><section><h1>Why now</h1></section></body></html>`;
const CHANNEL = "story-card";
const SRCDOC = buildArtifactSrcdoc("slides", DECK, CHANNEL);
const SLIDE = { name: "Why now", width: 1920, height: 1080, skip: false };

const meta = {
  title: "Artifacts/FrameCard",
  component: FrameCard,
  args: { srcdoc: SRCDOC, channel: CHANNEL, index: 1, frame: SLIDE, width: 236, live: true, active: false, onSelect: () => {} },
  render: (args) => (
    <div className="w-64">
      <FrameCard {...args} />
    </div>
  ),
} satisfies Meta<typeof FrameCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = {};

export const Active: Story = { args: { active: true } };

export const Skipped: Story = { args: { frame: { ...SLIDE, skip: true } } };

/** Off screen or past the twelve live frames: number only. */
export const NotLive: Story = { args: { live: false } };

export const Phone: Story = {
  render: () => (
    <FrameThumb
      srcdoc={buildArtifactSrcdoc("design", '<section data-width="390" data-height="844"><h1>Phone</h1></section>', CHANNEL)}
      channel={CHANNEL}
      index={0}
      frame={{ width: 390, height: 844 }}
      width={236}
    />
  ),
};
