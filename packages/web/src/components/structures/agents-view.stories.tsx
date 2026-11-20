import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  INSTANCE_AGENT,
  PROFILE,
  PROJECT_AGENT,
  VM_GONE,
  makeAgent,
} from "../../../test/vm-fixtures";
import { AgentsView } from "./agents-view";

const meta = {
  title: "Structures/AgentsView",
  component: AgentsView,
  parameters: { layout: "padded" },
  args: {
    agents: [makeAgent(), PROJECT_AGENT, PROFILE, VM_GONE, INSTANCE_AGENT],
    error: null,
    noAccess: false,
    onNew: () => {},
    onAction: () => {},
    onRetry: () => {},
    canManageProjects: false,
    onManageProjects: () => {},
  },
  decorators: [
    (Story) => (
      <div className="h-[34rem] overflow-hidden rounded-card border border-border bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AgentsView>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * One row of each kind: an agent on a VM, a project agent (Project in the Owner column),
 * a profile (its owner may not create a VM, so Create VM is disabled with the reason),
 * an agent whose VM is gone, and an instance agent.
 */
export const AllKinds: Story = {};

/** An admin: the page offers Manage projects. */
export const ManageProjects: Story = { args: { canManageProjects: true } };

export const Loading: Story = { args: { agents: null } };

export const Empty: Story = { args: { agents: [] } };

export const NoAccess: Story = { args: { agents: null, noAccess: true } };

export const LoadError: Story = {
  args: { agents: null, error: "control plane unreachable" },
};

export const RefreshError: Story = {
  args: { error: "control plane unreachable" },
};
