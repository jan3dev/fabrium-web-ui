import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { readFrames } from "@/lib/artifacts/frames";
import { buildArtifactSrcdoc } from "@/lib/artifacts/srcdoc";
import { PresenterScreen } from "./presenter-view";

const DECK = `<!doctype html><html><head><style>section{display:flex;align-items:center;justify-content:center;font:600 120px system-ui;background:rgb(240,244,255)}</style></head>
<body data-transition="fade">
<section><h1>Launch plan</h1><aside data-notes>Welcome everyone.
Introduce the team before the agenda.</aside></section>
<section data-skip><h1>Backup slide</h1></section>
<section><h1>Why now</h1><aside data-notes>Three numbers, then pause.</aside></section>
<section><h1>Questions</h1></section>
</body></html>`;
const CHANNEL = "story-presenter";
const SRCDOC = buildArtifactSrcdoc("slides", DECK, CHANNEL);
const FRAMES = readFrames("slides", DECK);

const meta = {
  title: "Artifacts/PresenterScreen",
  component: PresenterScreen,
  parameters: { layout: "fullscreen" },
  args: {
    title: "Launch deck",
    srcdoc: SRCDOC,
    channel: CHANNEL,
    frames: FRAMES,
    index: 0,
    now: Date.UTC(2026, 10, 17, 9, 41),
    elapsed: 754_000,
    onGo: () => {},
    onResetTimer: () => {},
  },
  render: function Driven(args) {
    const [index, setIndex] = useState(args.index);
    return <PresenterScreen {...args} index={index} onGo={setIndex} />;
  },
} satisfies Meta<typeof PresenterScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstSlide: Story = {};

/** The last slide: no next slide, no notes. */
export const LastSlide: Story = { args: { index: 3 } };
