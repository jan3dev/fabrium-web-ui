import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import {
  INSTANCE_TYPES,
  PROFILE,
  PROJECTS,
  PROJECT_AGENT,
  VM_GONE,
} from "../../../test/vm-fixtures";
import { FabriumApiError } from "../../client/fabrium-api";
import { CreateVmDialog } from "./create-vm-dialog";

/** A profile, seen by a VM creator: it may get a VM. */
const forVmCreator = { ...PROFILE, can: { ...PROFILE.can, create_vm: true } };

const meta = {
  title: "Dialogs/CreateVm",
  component: CreateVmDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    agent: forVmCreator,
    types: INSTANCE_TYPES,
    typesError: null,
    projects: PROJECTS,
    projectsError: null,
    canManageProjects: true,
    onCreateProject: async (name) => ({ id: "0f0e0d0c0b0a09080706050403020100", name, in_use: false }),
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

/** A project agent: the VM starts in its project, No project is disabled, and the note shows. */
export const ForProjectAgent: Story = {
  args: {
    agent: { ...PROJECT_AGENT, vm: { name: "kilo" }, can: { ...PROJECT_AGENT.can, create_vm: true } },
  },
};
