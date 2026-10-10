import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { TurnLivenessIndicator } from "@/components/agents/turn-liveness";

const meta = {
  title: "Agents/Status",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Badges: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <AgentStatusBadge working />
      <AgentStatusBadge working={false} />
    </div>
  ),
};

export const TurnLiveness: Story = {
  render: () => (
    <p className="flex items-center gap-2 text-body2 text-text-secondary">
      Coder · Payments is working <TurnLivenessIndicator />
    </p>
  ),
};
