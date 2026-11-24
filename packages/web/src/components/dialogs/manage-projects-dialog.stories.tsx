import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { MARKETING, PROJECTS } from "../../../test/vm-fixtures";
import { ManageProjectsDialog } from "./manage-projects-dialog";

const meta = {
  title: "Dialogs/ManageProjects",
  component: ManageProjectsDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    projects: PROJECTS,
    error: null,
    onRename: async () => {},
    onDelete: async () => {},
  },
} satisfies Meta<typeof ManageProjectsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const body = () => within(document.body);

/** Payments is in use: its Delete is disabled, with the reason. */
export const List: Story = {};

export const Renaming: Story = {
  async play() {
    await userEvent.click(await body().findByRole("button", { name: "Rename Payments" }));
  },
};

/** Every project is in use. */
export const InUse: Story = { args: { projects: PROJECTS.map((p) => ({ ...p, in_use: true })) } };

/** The control plane answered that something entered Marketing since the list loaded. */
export const DeleteError: Story = {
  args: {
    projects: [MARKETING],
    onDelete: async () => {
      throw new Error("project in use");
    },
  },
  async play() {
    await userEvent.click(await body().findByRole("button", { name: "Delete Marketing" }));
  },
};

export const LoadError: Story = { args: { projects: null, error: "control plane unreachable" } };

export const Empty: Story = { args: { projects: [] } };
