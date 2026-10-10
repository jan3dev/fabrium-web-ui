import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThreadMessageSkeleton } from "@/components/structures/thread-pane-skeleton";

const meta = {
  title: "Structures/ThreadMessageSkeleton",
  component: ThreadMessageSkeleton,
  decorators: [(Story) => <div className="w-96">{Story()}</div>],
} satisfies Meta<typeof ThreadMessageSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Parent: Story = { args: { isHead: true } };

export const Reply: Story = {};
