import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Styles } from "@/lib/artifacts/styles";
import { StyleInspector } from "./style-inspector";

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
};

const meta = {
  title: "Artifacts/StyleInspector",
  component: StyleInspector,
  parameters: { layout: "fullscreen" },
  args: { selector: "section.plans > div.card:nth-of-type(2)", values: computed, onChange: () => {} },
  render: function Editable(args) {
    const [values, setValues] = useState(args.values);
    return (
      <div className="flex h-screen justify-end">
        <StyleInspector {...args} values={values} onChange={(prop, value) => setValues((v) => ({ ...v, [prop]: value }))} />
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
