import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PREVIEW_STYLE_PROPS, type Styles } from "@/lib/artifacts/styles";
import { LayersList } from "./layers-list";
import { FrameProperties, StyleInspector } from "./style-inspector";

// Computed values, as a frame reports them.
const computed: Styles = {
  "background-color": "rgb(20, 20, 19)",
  color: "rgb(250, 249, 245)",
  opacity: "1",
  "border-radius": "12px",
  "border-style": "solid",
  "border-color": "rgb(61, 61, 58)",
  "border-width": "1px",
  "box-shadow": "rgba(0, 0, 0, 0.3) 0px 4px 8px 0px",
  filter: "none",
  "backdrop-filter": "none",
  rotate: "none",
  "mix-blend-mode": "normal",
  scale: "none",
  transform: "none",
  display: "flex",
  "flex-direction": "column",
  gap: "16px",
  padding: "24px",
  "font-family": "Inter, sans-serif",
  "font-size": "18px",
  "font-weight": "400",
  "line-height": "27px",
  "letter-spacing": "normal",
  "text-align": "start",
};

const PALETTE = [
  { name: "brand", value: "rgb(51, 85, 255)" },
  { name: "ink", value: "rgb(20, 20, 19)" },
  { name: "paper", value: "rgb(250, 249, 245)" },
];

const LAYERS = [
  { id: "f2", name: "Title", depth: 0, locked: false },
  { id: "f3", name: "div · Pro $20", depth: 0, locked: false },
  { id: "f4", name: "h2 · Pro", depth: 1, locked: false },
  { id: "f5", name: "Footer", depth: 0, locked: true },
];

const meta = {
  title: "Artifacts/StyleInspector",
  component: StyleInspector,
  parameters: { layout: "fullscreen" },
  args: { selector: "section.plans > div.card:nth-of-type(2)", values: computed, onChange: () => {} },
  render: function Editable(args) {
    const [values, setValues] = useState(args.values);
    return (
      <div className="flex h-screen justify-end">
        <StyleInspector {...args} values={values} onChange={(changes) => setValues((v) => ({ ...v, ...changes }))} />
      </div>
    );
  },
} satisfies Meta<typeof StyleInspector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Card: Story = {};
/** An element with no fill, border or effects: every control starts at its zero. */
export const Plain: Story = {
  args: {
    selector: "p",
    values: { ...computed, "background-color": "rgba(0, 0, 0, 0)", "border-style": "none", "border-width": "0px", "border-radius": "0px", "box-shadow": "none" },
  },
};
/** The preview bridge's properties only (an app preview). */
export const Preview: Story = { args: { props: PREVIEW_STYLE_PROPS } };
/** The canvas Properties panel: layers, position and size, the design system's colours, contrast. */
export const Properties: Story = {
  args: {
    title: "Properties",
    selector: "div · Pro $20",
    palette: PALETTE,
    fonts: ["Inter"],
    background: "rgb(255, 255, 255)",
    box: { x: 120, y: 80, w: 480, h: 320, free: true },
    layers: <LayersList layers={LAYERS} selected={["f3"]} onSelect={() => {}} />,
    note: null,
  },
};
/** A viewer without edit rights: the inspect view. */
export const Inspect: Story = { args: { ...Properties.args, readOnly: true, note: "You can inspect this artifact. Ask the agent to change it." } };
/** Nothing selected: the slide's own properties. */
export const NothingSelected: Story = {
  args: {
    title: "Properties",
    selector: null,
    layers: <LayersList layers={LAYERS} selected={[]} onSelect={() => {}} />,
    frame: (
      <FrameProperties
        kind="slides"
        name="Launch plan"
        width={1920}
        height={1080}
        transition="fade"
        background="rgb(255, 255, 255)"
        palette={PALETTE}
        onName={() => {}}
        onSize={() => {}}
        onDeckSize={() => {}}
        onTransition={() => {}}
        onBackground={() => {}}
      />
    ),
    note: null,
  },
};
