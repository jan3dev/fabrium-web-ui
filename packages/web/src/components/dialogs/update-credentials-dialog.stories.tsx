import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { makeVm } from "../../../test/vm-fixtures";
import { FabriumApiError } from "../../client/fabrium-api";
import { UpdateCredentialsDialog } from "./update-credentials-dialog";

const meta = {
  title: "Dialogs/UpdateCredentials",
  component: UpdateCredentialsDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    vm: makeVm(),
    onSubmit: async () => {},
  },
} satisfies Meta<typeof UpdateCredentialsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

async function fillAndReplace() {
  const body = within(document.body);
  await userEvent.type(await body.findByLabelText("Haven API key"), "hk-example");
  await userEvent.click(body.getByRole("button", { name: "Replace VM" }));
}

/** The warning: the VM is deleted and created again, and its agents stop until it is ready. */
export const Default: Story = {};

/** The fields and the buttons are disabled until the answer. */
export const Replacing: Story = {
  args: { onSubmit: () => new Promise(() => {}) },
  play: fillAndReplace,
};

export const Refused: Story = {
  args: {
    onSubmit: async () => {
      throw new FabriumApiError(409, "the vm has no bundle");
    },
  },
  play: fillAndReplace,
};
