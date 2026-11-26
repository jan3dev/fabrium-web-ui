import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PreviewEvent } from "@/model/types";
import { PreviewCard, PreviewStatusBadge } from "./preview-card";

const preview: PreviewEvent = {
  eventId: "$p1",
  name: "todo-app",
  title: "Todo app",
  command: "npm run dev",
  kind: "web",
  action: "started",
  createdAt: Date.UTC(2026, 10, 9, 9, 30),
  author: {
    id: "@vm1.coder:h.example",
    kind: "agent",
    displayName: "Coder · Web",
    avatarUrl: null,
  },
  threadRootId: "$root",
};

const meta = {
  title: "Previews/PreviewCard",
  component: PreviewCard,
  parameters: { layout: "padded" },
  args: { preview, onOpen: () => {} },
} satisfies Meta<typeof PreviewCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Started: Story = {};
export const Active: Story = { args: { active: true } };
export const Stopped: Story = {
  args: { preview: { ...preview, action: "stopped" } },
};
export const LongCommand: Story = {
  args: {
    preview: {
      ...preview,
      title: "Customer portal with billing and account settings",
      command: "pnpm --filter portal dev --host 0.0.0.0 --port $PORT",
    },
  },
};
export const StatusBadges: Story = {
  render: () => (
    <div className="flex gap-2">
      <PreviewStatusBadge status="starting" />
      <PreviewStatusBadge status="running" />
      <PreviewStatusBadge status="crashed" />
      <PreviewStatusBadge status="stopped" />
      <PreviewStatusBadge status="offline" />
    </div>
  ),
};
