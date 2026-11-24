import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CreateType } from "@/lib/artifacts/hint";
import { CreateChip, CreateExamples, CreateMenu } from "./create-menu";

const meta = {
  title: "Rooms/CreateMenu",
  component: CreateMenu,
  parameters: { layout: "padded" },
  args: { value: null, onPick: () => {} },
  render: function Picking(args) {
    const [value, setValue] = useState<CreateType | null>(args.value);
    return (
      <div className="flex max-w-xl flex-col items-start rounded-card border border-border p-3">
        {value ? <CreateChip type={value} onRemove={() => setValue(null)} /> : null}
        {value ? <CreateExamples type={value} onPick={() => setValue(null)} /> : null}
        <CreateMenu {...args} value={value} onPick={setValue} />
      </div>
    );
  },
} satisfies Meta<typeof CreateMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Picked: Story = { args: { value: "slides" } };
