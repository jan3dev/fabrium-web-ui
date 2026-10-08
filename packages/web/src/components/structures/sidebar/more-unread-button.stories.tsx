import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { MoreUnreadButton } from "@/components/structures/sidebar/more-unread-button";

const meta = {
  title: "Structures/Sidebar/MoreUnreadButton",
  component: MoreUnreadButton,
  args: { count: 3, emphasis: "default", onClick: fn(), position: "bottom" },
  decorators: [(Story) => <div className="relative h-32 w-64 rounded-card border">{Story()}</div>],
} satisfies Meta<typeof MoreUnreadButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Below: Story = {};

export const AboveWithMentions: Story = { args: { position: "top", emphasis: "primary" } };
