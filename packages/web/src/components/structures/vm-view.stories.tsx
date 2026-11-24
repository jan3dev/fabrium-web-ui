import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { PAYMENTS, makeVm } from "../../../test/vm-fixtures";
import { VmView } from "./vm-view";

const lima = makeVm();
const vms = [
  lima,
  makeVm({
    id: "i-0123456789abcdef1",
    name: "kilo",
    state: "stopped",
    public_ip: null,
  }),
  makeVm({
    id: "i-0123456789abcdef2",
    name: "oscar",
    state: "pending",
    setup: "pending",
    public_ip: null,
    agents: [],
  }),
  makeVm({ id: "i-0123456789abcdef3", name: "papa", state: "stopping" }),
  makeVm({
    id: "i-0123456789abcdef4",
    name: "tango",
    instance_type: "c6a.large",
    sev_snp: true,
    setup: "expired",
    agents: [
      { id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "echo", agent_id: "@tango.echo:example.org" },
      { id: "1b2c3d4e5f60718293a4b5c6d7e8f90a", name: "reviewer", agent_id: "@tango.reviewer:example.org" },
    ],
  }),
  makeVm({
    id: "i-0123456789abcdef5",
    name: "victor",
    state: "shutting-down",
    public_ip: null,
  }),
  // A project VM: Project in the Owner column, and the name of its project.
  makeVm({
    id: "i-0123456789abcdef6",
    name: "sierra",
    project_id: PAYMENTS.id,
    project: PAYMENTS.name,
  }),
];

const meta = {
  title: "Structures/VmView",
  component: VmView,
  parameters: { layout: "padded" },
  args: {
    vms,
    error: null,
    noAccess: false,
    busyIds: new Set<string>(),
    onAction: () => {},
    onSetAutoStop: () => {},
    onRetry: () => {},
  },
  decorators: [
    (Story) => (
      <div className="h-[34rem] overflow-hidden rounded-card border border-border bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof VmView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One VM for each EC2 state, a Confidential type, an expired setup, two agents, and none. */
export const AllStates: Story = {};

export const ActionInFlight: Story = {
  args: { busyIds: new Set([lima.id]) },
};

/** Opens the actions menu of a VM and chooses an action. The menu is in a portal. */
async function choose(vmName: string, label: string) {
  const body = within(document.body);
  await userEvent.click(await body.findByRole("button", { name: `Actions for ${vmName}` }));
  await userEvent.click(await body.findByRole("menuitem", { name: label }));
}

export const ConfirmDelete: Story = {
  play: () => choose("lima", "Delete"),
};

export const ConfirmStart: Story = {
  play: () => choose("kilo", "Start"),
};

export const Loading: Story = { args: { vms: null } };

export const Empty: Story = { args: { vms: [] } };

export const NoAccess: Story = { args: { vms: null, noAccess: true } };

export const LoadError: Story = {
  args: { vms: null, error: "control plane unreachable" },
};

export const RefreshError: Story = {
  args: { error: "control plane unreachable" },
};
