import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { VmActionsMenu } from "./vm-actions-menu";

const meta = {
  title: "Structures/VmActionsMenu",
  component: VmActionsMenu,
  parameters: { layout: "centered" },
  args: {
    vm: { name: "lima", state: "running", can: { set_project: true } },
    busy: false,
    onSelect: () => {},
  },
} satisfies Meta<typeof VmActionsMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The menu is in a portal: open it from the body. */
async function open({ args }: { args: { vm: { name: string } } }) {
  await userEvent.click(
    await within(document.body).findByRole("button", { name: `Actions for ${args.vm.name}` }),
  );
}

export const Running: Story = { play: open };

export const Stopped: Story = {
  args: { vm: { name: "kilo", state: "stopped", can: { set_project: true } } },
  play: open,
};

/** An action of the VM is in flight: the trigger is disabled. */
export const Busy: Story = { args: { busy: true } };
