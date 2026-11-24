import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LayersList } from "./layers-list";

const meta = {
  title: "Artifacts/LayersList",
  component: LayersList,
  args: {
    layers: [
      { id: "f2", name: "Title", depth: 0, locked: false },
      { id: "f3", name: "div · Pro $20", depth: 0, locked: false },
      { id: "f4", name: "h2 · Pro", depth: 1, locked: false },
      { id: "f5", name: "p · $20 a month", depth: 1, locked: false },
      { id: "f6", name: "Footer", depth: 0, locked: true },
    ],
    selected: ["f4"],
    onSelect: () => {},
  },
  render: function Selectable(args) {
    const [selected, setSelected] = useState(args.selected);
    return (
      <div className="w-64 p-3">
        <LayersList {...args} selected={selected} onSelect={setSelected} />
      </div>
    );
  },
} satisfies Meta<typeof LayersList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { layers: [], selected: [] } };
