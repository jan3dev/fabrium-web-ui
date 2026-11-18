import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { CAN_NOTHING, PROFILE, makeAgent } from "../../../test/vm-fixtures";
import { FabriumApiError } from "../../client/fabrium-api";
import { DeleteAgentDialog } from "./delete-agent-dialog";

const sibling = makeAgent({ can: { ...CAN_NOTHING, edit: true, delete: true } });

const meta = {
  title: "Dialogs/DeleteAgent",
  component: DeleteAgentDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    agent: sibling,
    onConfirm: async () => {},
  },
} satisfies Meta<typeof DeleteAgentDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The VM keeps other agents: only this one goes. */
export const AgentWithSiblings: Story = {};

/** The last agent of a live VM: the VM goes too. */
export const LastAgentOfVm: Story = { args: { agent: makeAgent() } };

export const Profile: Story = { args: { agent: PROFILE } };

/** The list was stale: the daemon refuses, and the dialog stays open with the reason. */
export const Refused: Story = {
  args: {
    onConfirm: async () => {
      throw new FabriumApiError(409, "last agent of the vm");
    },
  },
  async play() {
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Delete agent" }),
    );
  },
};
