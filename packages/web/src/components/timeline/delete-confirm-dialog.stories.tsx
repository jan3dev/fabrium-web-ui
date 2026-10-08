import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { DeleteConfirmDialog } from "@/components/timeline/delete-confirm-dialog";

const meta = {
  title: "Timeline/DeleteConfirmDialog",
  component: DeleteConfirmDialog,
  args: { open: true, onOpenChange: fn(), onConfirm: fn() },
} satisfies Meta<typeof DeleteConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
