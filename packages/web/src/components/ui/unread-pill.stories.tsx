import type { Meta, StoryObj } from "@storybook/react-vite";
import { UnreadPill } from "@/components/ui/unread-pill";

const meta = {
  title: "UI/UnreadPill",
  component: UnreadPill,
  parameters: { layout: "centered" },
  args: { direction: "down", label: "3 unread", onClick: () => {} },
} satisfies Meta<typeof UnreadPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Mention: Story = { args: { direction: "up", emphasis: "primary", label: "2 unread" } };
