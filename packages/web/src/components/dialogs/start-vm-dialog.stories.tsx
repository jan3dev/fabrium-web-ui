import type { Meta, StoryObj } from "@storybook/react-vite";
import { makeVm } from "../../../test/vm-fixtures";
import { StartVmDialog } from "./start-vm-dialog";

const kilo = makeVm({ name: "kilo", state: "stopped", public_ip: null });

const meta = {
  title: "Dialogs/StartVm",
  component: StartVmDialog,
  args: { vm: kilo, onCancel: () => {}, onConfirm: () => {} },
} satisfies Meta<typeof StartVmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The VM has no auto-stop value, so the field starts at 12. */
export const Default: Story = {};

/** The field starts from the value the VM has. */
export const CurrentValue: Story = {
  args: { vm: { ...kilo, auto_stop_hours: 36 } },
};
