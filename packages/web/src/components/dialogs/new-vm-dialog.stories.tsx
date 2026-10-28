import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { AGENTS, INSTANCE_TYPES } from "../../../test/vm-fixtures";
import { FabriumApiError } from "../../client/fabrium-api";
import { NewVmDialog } from "./new-vm-dialog";

const meta = {
  title: "Dialogs/NewVm",
  component: NewVmDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    options: { instanceTypes: INSTANCE_TYPES, agents: AGENTS },
    optionsError: null,
    onSubmit: async () => {},
  },
} satisfies Meta<typeof NewVmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const body = () => within(document.body);

async function fillNewAgent() {
  await userEvent.type(await body().findByLabelText(/^vm name/i), "lima");
  await userEvent.type(body().getByLabelText(/^agent name/i), "echo");
  await userEvent.type(body().getByLabelText(/haven api key/i), "hk-example");
}

async function chooseExisting() {
  await userEvent.click(await body().findByRole("button", { name: "Existing agent" }));
}

export const NewAgent: Story = {};

/** The required fields are set, so Create is enabled. */
export const NewAgentReady: Story = { play: fillNewAgent };

export const ExistingAgent: Story = {
  async play() {
    await chooseExisting();
    await userEvent.selectOptions(body().getByLabelText("Agent"), "nova");
  },
};

/** The dialog stays open and its fields are disabled while the VM is created. */
export const Creating: Story = {
  args: { onSubmit: () => new Promise(() => {}) },
  async play() {
    await fillNewAgent();
    await userEvent.click(body().getByRole("button", { name: "Create VM" }));
  },
};

/** A failed admission step shows its name. A retry continues from it. */
export const AdmissionError: Story = {
  args: {
    onSubmit: async () => {
      throw new FabriumApiError(
        502,
        "Could not register the agent identity.",
        "register_appservice",
      );
    },
  },
  async play() {
    await fillNewAgent();
    await userEvent.click(body().getByRole("button", { name: "Create VM" }));
  },
};

export const LoadingOptions: Story = { args: { options: null } };

export const OptionsError: Story = {
  args: { options: null, optionsError: "control plane unreachable" },
};

export const NoFreeAgent: Story = {
  args: {
    options: {
      instanceTypes: INSTANCE_TYPES,
      agents: AGENTS.map((agent) => ({ ...agent, free: false })),
    },
  },
  play: chooseExisting,
};
