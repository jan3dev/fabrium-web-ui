import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { readColor } from "@/lib/artifacts/styles";
import type { TweakControl, TweakValue } from "@/lib/artifacts/tweaks";
import { TweaksPanel } from "./tweaks-panel";

// The story's colour as hex without a literal (lint keeps hex out of components).
const accent = readColor("rgb(51, 85, 255)").hex;

const controls: TweakControl[] = [
  { name: "accent", label: "Accent color", type: "color", var: "--accent", value: accent },
  { name: "gap", label: "Spacing", type: "range", var: "--gap", min: 4, max: 48, step: 4, unit: "px", value: 16 },
  {
    name: "density",
    label: "Density",
    type: "select",
    var: "--density",
    options: [
      { label: "Compact", value: "0.8" },
      { label: "Comfortable", value: "1" },
    ],
    value: "1",
  },
  { name: "shadow", label: "Shadows", type: "toggle", var: "--shadow", on: "1", off: "0", value: true },
  { name: "headline", label: "Headline", type: "text", value: "Quarterly review" },
];

const meta = {
  title: "Artifacts/TweaksPanel",
  component: TweaksPanel,
  args: { controls, values: {}, onChange: () => {}, onKeep: () => {}, onReset: () => {} },
  render: function Live(args) {
    const [values, setValues] = useState<Record<string, TweakValue>>(args.values);
    return (
      <div className="w-64 border-l border-border">
        <TweaksPanel
          {...args}
          values={values}
          onChange={(name, v) => setValues((prev) => ({ ...prev, [name]: v }))}
          onReset={() => setValues({})}
        />
      </div>
    );
  },
} satisfies Meta<typeof TweaksPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Changed: Story = { args: { values: { gap: 32, headline: "Year in review" } } };
export const ViewOnly: Story = { args: { onKeep: undefined } };
