import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { INSTANCE_TYPES, PROFILE, VM_GONE } from "../../../test/vm-fixtures";
import { FabriumApiError } from "../../client/fabrium-api";
import { CreateVmDialog } from "./create-vm-dialog";

const meta = {
  title: "Dialogs/CreateVm",
  component: CreateVmDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    agent: PROFILE,
    types: INSTANCE_TYPES,
    typesError: null,
    onSubmit: async () => {},
  },
} satisfies Meta<typeof CreateVmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const body = () => within(document.body);

async function fill() {
  await userEvent.type(await body().findByLabelText("VM name"), "lima");
  await userEvent.type(body().getByLabelText("Haven API key"), "hk-example");
}

/** A profile: the user names its first VM. */
export const ForProfile: Story = {};

/** An agent whose VM is gone: the VM name is fixed. */
export const FixedName: Story = { args: { agent: VM_GONE } };

export const BadName: Story = {
  async play() {
    await userEvent.type(await body().findByLabelText("VM name"), "Lima");
  },
};

/** The fields and the buttons are disabled until the answer. */
export const Creating: Story = {
  args: { onSubmit: () => new Promise(() => {}) },
  async play() {
    await fill();
    await userEvent.click(body().getByRole("button", { name: "Create VM" }));
  },
};

/** A failed admission step shows its name. A retry continues from it. */
export const AdmissionError: Story = {
  args: {
    onSubmit: async () => {
      throw new FabriumApiError(502, "matrix timeout", "join");
    },
  },
  async play() {
    await fill();
    await userEvent.click(body().getByRole("button", { name: "Create VM" }));
  },
};

export const LoadingTypes: Story = { args: { types: null } };

export const TypesError: Story = {
  args: { types: null, typesError: "control plane unreachable" },
};
