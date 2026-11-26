import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MotionScenes, MotionTransport } from "./motion-controls";

const SCENES = [
  { name: "Intro", duration: 2000 },
  { name: "The numbers", duration: 4500 },
  { name: "A very long scene name that does not fit the rail", duration: 3000 },
];

const meta = {
  title: "Artifacts/MotionControls",
  component: MotionTransport,
  args: { scenes: SCENES, time: 3200, playing: false, loop: true, onPlay: () => {}, onSeek: () => {}, onLoop: () => {} },
  render: function Interactive(args) {
    const [time, setTime] = useState(args.time);
    const [playing, setPlaying] = useState(args.playing);
    const [loop, setLoop] = useState(args.loop);
    return (
      <MotionTransport {...args} time={time} playing={playing} loop={loop} onSeek={setTime} onPlay={() => setPlaying(!playing)} onLoop={setLoop} />
    );
  },
} satisfies Meta<typeof MotionTransport>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Transport: Story = {};
export const Playing: Story = { args: { playing: true, loop: false, time: 9100 } };

/** The scene list: a rail beside the stage, with edit rights the duration fields and reorder. */
export const Scenes: Story = {
  render: function Rail() {
    const [active, setActive] = useState(1);
    return (
      <div className="flex h-80 gap-8">
        <MotionScenes scenes={SCENES} active={active} onSelect={setActive} />
        <MotionScenes scenes={SCENES} active={active} onSelect={setActive} edit={{ onDuration: () => {}, onMove: () => {} }} />
      </div>
    );
  },
};

/** On a phone: a strip under the stage, no editing. */
export const SceneStrip: Story = {
  render: function Strip() {
    const [active, setActive] = useState(0);
    return (
      <div className="w-[390px]">
        <MotionScenes strip scenes={SCENES} active={active} onSelect={setActive} />
      </div>
    );
  },
};
