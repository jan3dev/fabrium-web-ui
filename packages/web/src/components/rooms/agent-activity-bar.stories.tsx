import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentActivityBarView } from "./agent-activity-bar";

const coder = { id: "@coder:h.example", kind: "agent", displayName: "Coder · Payments", avatarUrl: null } as const;
const qa = { id: "@qa:h.example", kind: "agent", displayName: "QA · Payments", avatarUrl: null } as const;

const meta = {
  title: "Rooms/AgentActivityBar",
  component: AgentActivityBarView,
  parameters: { layout: "padded" },
} satisfies Meta<typeof AgentActivityBarView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InThread: Story = {
  args: { rows: [{ key: "t1", agent: coder, threadRootId: "$root", activity: "Running pnpm test auth" }] },
};

export const InRoom: Story = {
  args: {
    rows: [
      { key: "t1", agent: coder, threadRootId: "$a", activity: "Editing auth.ts" },
      { key: "t2", agent: qa, threadRootId: "$b", activity: "Working" },
    ],
    stopping: new Set(["t2"]),
    onOpenThread: () => {},
  },
};

export const StopFailed: Story = {
  args: { rows: [{ key: "t1", agent: coder, threadRootId: "$root", activity: "Working" }], error: "M_FORBIDDEN" },
};
