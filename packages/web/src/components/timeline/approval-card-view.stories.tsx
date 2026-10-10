import type { Meta, StoryObj } from "@storybook/react-vite";
import { ApprovalCardView } from "./approval-card-view";

const meta = {
  title: "Timeline/ApprovalCardView",
  component: ApprovalCardView,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ApprovalCardView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    agentName: "Coder · Payments",
    title: "bash",
    subtitle: "pnpm run test",
    detail: JSON.stringify({ command: "pnpm run test" }, null, 2),
    options: [],
  },
};

export const LongTitle: Story = {
  args: {
    title: "bash(pnpm run test --reporter=verbose --config=vitest.config.ts --environment=jsdom --workspace=/Users/ori/Code/z/zooid-clients/packages/web)",
    options: [],
  },
};

export const LongOptionLabels: Story = {
  args: {
    agentName: "Coder · Payments",
    title: "bash",
    subtitle: "pnpm run test --reporter=verbose --config=vitest.config.ts",
    options: [
      { optionId: "1", name: "Allow pnpm run test --reporter=verbose --config=vitest.config.ts --environment=jsdom", kind: "allow_once" },
      { optionId: "2", name: "Reject and explain why the test configuration is invalid for this environment", kind: "reject_once" },
    ],
  },
};

export const Resolved: Story = {
  args: {
    agentName: "Coder · Payments",
    title: "bash(pnpm run test --reporter=verbose --config=vitest.config.ts --environment=jsdom)",
    options: [],
    resolution: { decision: "allow", respondedBy: "Beno", respondedAt: Date.now() - 5 * 60_000 },
  },
};

export const Denied: Story = {
  args: {
    agentName: "Coder · Payments",
    title: "Edit auth.ts",
    subtitle: "/repo/src/auth.ts",
    options: [],
    resolution: { decision: "cancel", respondedBy: "Beno", respondedAt: Date.now() - 60 * 60_000 },
  },
};

export const Expired: Story = {
  args: { agentName: "Coder · Payments", title: "Run command", subtitle: "rm -rf dist", options: [], expired: true },
};

export const AgentViewer: Story = {
  args: {
    agentName: "Coder · Payments",
    title: "Run command",
    subtitle: "pnpm deploy",
    options: [],
    blockedReason: "Only humans can answer an approval.",
  },
};

// Regression: a resolved approval whose subtitle is a long command with
// unbreakable file-path tokens. The subtitle must wrap rather than run off the
// edge of the card.
export const ResolvedLongCommand: Story = {
  args: {
    title: "Run command",
    subtitle:
      "git -C /Users/ori/Code/z/zooid-clients diff --stat /Users/ori/Code/z/zooid-clients/packages/web/src/components/structures/timeline-panel.diff.stories.tsx",
    options: [],
    resolution: { decision: "allow", respondedBy: "Beno" },
  },
};
