import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { makeVm } from "../../../test/vm-fixtures";
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
    agent_id: null,
  }),
  makeVm({ id: "i-0123456789abcdef3", name: "papa", state: "stopping" }),
  makeVm({
    id: "i-0123456789abcdef4",
    name: "tango",
    instance_type: "c6a.large",
    sev_snp: true,
    setup: "expired",
    agent_id: "@tango.echo:example.org",
  }),
  makeVm({
    id: "i-0123456789abcdef5",
    name: "victor",
    state: "shutting-down",
    public_ip: null,
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
    onNew: () => {},
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

/** One VM for each EC2 state, a Confidential type, and an expired setup. */
export const AllStates: Story = {};

export const ActionInFlight: Story = {
  args: { busyIds: new Set([lima.id]) },
};

export const ConfirmDelete: Story = {
  async play({ canvasElement }) {
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: "Delete lima" }),
    );
  },
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
