import type { Meta, StoryObj } from "@storybook/react-vite";
import { DesignSystemChip } from "./design-system-chip";

const meta = {
  title: "Rooms/DesignSystemChip",
  component: DesignSystemChip,
  parameters: { layout: "padded" },
  args: { name: "Brand 2026" },
} satisfies Meta<typeof DesignSystemChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {};

export const None: Story = { args: { name: null } };

export const LongName: Story = {
  args: { name: "Quarterly investor relations deck system with a very long name" },
  decorators: [(Story) => <div className="w-48"><Story /></div>],
};
