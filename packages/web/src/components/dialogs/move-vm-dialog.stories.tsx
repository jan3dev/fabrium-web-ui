import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { PROJECTS, PROJECT_VM, makeVm } from "../../../test/vm-fixtures";
import { FabriumApiError } from "../../client/fabrium-api";
import { MoveVmDialog } from "./move-vm-dialog";

const meta = {
  title: "Dialogs/MoveVm",
  component: MoveVmDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    vm: makeVm(),
    projects: PROJECTS,
    projectsError: null,
    canManageProjects: true,
    onCreateProject: async (name) => ({ id: "0f0e0d0c0b0a09080706050403020100", name, in_use: false }),
    people: [
      { user_id: "@ann:example.org", name: "Ann" },
      { user_id: "@luis:example.org", name: "Luis" },
    ],
    onSubmit: async () => {},
  },
} satisfies Meta<typeof MoveVmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const body = () => within(document.body);

async function pick(name: string) {
  await userEvent.click(await body().findByRole("combobox", { name: "Project" }));
  await userEvent.click(await body().findByRole("option", { name }));
}

/** A personal VM goes into Payments: the note on its shared keys shows. */
export const Personal: Story = {
  async play() {
    await pick("Payments");
  },
};

/** A project VM, seen by an admin. */
export const Project: Story = { args: { vm: PROJECT_VM } };

/** An admin takes a project VM out: its creator is not a person, so the Owner field asks. */
export const TakeOut: Story = {
  args: { vm: PROJECT_VM },
  async play() {
    await pick("No project");
  },
};

/** The VM still has project agents. */
export const RequestError: Story = {
  args: {
    vm: { ...PROJECT_VM, creator: "@ann:example.org" },
    onSubmit: async () => {
      throw new FabriumApiError(409, "the vm has project agents");
    },
  },
  async play() {
    await pick("No project");
    await userEvent.click(body().getByRole("button", { name: "Move VM" }));
  },
};
