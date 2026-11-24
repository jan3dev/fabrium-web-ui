import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import {
  MARKETING,
  PAYMENTS,
  PROFILE,
  PROJECTS,
  PROJECT_AGENT,
  makeAgent,
} from "../../../test/vm-fixtures";
import { FabriumApiError } from "../../client/fabrium-api";
import { AgentDialog } from "./agent-dialog";

const meta = {
  title: "Dialogs/Agent",
  component: AgentDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    agent: null,
    vms: [
      { name: "lima", state: "running", project_id: null },
      { name: "kilo", state: "running", project_id: PAYMENTS.id },
    ],
    models: { models: [{ id: "glm-5-3" }, { id: "qwen-3" }], default: "glm-5-3" },
    modelsError: null,
    members: [
      { userId: "@ann:example.org", name: "Ann" },
      { userId: "@luis:example.org", name: "Luis" },
    ],
    projects: PROJECTS,
    projectsError: null,
    canManageProjects: true,
    onCreateProject: async (name) => ({ id: "0f0e0d0c0b0a09080706050403020100", name, in_use: false }),
    onSubmit: async () => {},
  },
} satisfies Meta<typeof AgentDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const body = () => within(document.body);

export const NewAgent: Story = {};

/** A VM is selected: the note on its shared credentials shows. */
export const NewAgentOnVm: Story = {
  async play() {
    await userEvent.type(await body().findByLabelText("Name"), "scout");
    await userEvent.selectOptions(body().getByLabelText("VM"), "lima");
  },
};

export const BadName: Story = {
  async play() {
    await userEvent.type(await body().findByLabelText("Name"), "Reviewer");
  },
};

/** An agent on a live VM, seen by the VM owner: the restart note and the Owner field. */
export const EditOnVm: Story = { args: { agent: makeAgent() } };

/** A profile of an agents manager: the VM field, and no Owner field. */
export const EditProfile: Story = { args: { agent: PROFILE } };

/** The Haven list does not answer: an edit still saves the other fields. */
export const ModelsError: Story = {
  args: {
    agent: makeAgent(),
    models: null,
    modelsError: "the Haven model list does not answer",
  },
};

/** The fields and the buttons are disabled until the answer. */
export const Submitting: Story = {
  args: { onSubmit: () => new Promise(() => {}) },
  async play() {
    await userEvent.type(await body().findByLabelText("Name"), "scout");
    await userEvent.click(body().getByRole("button", { name: "Create agent" }));
  },
};

export const RequestError: Story = {
  args: {
    onSubmit: async () => {
      throw new FabriumApiError(409, "name in use");
    },
  },
  async play() {
    await userEvent.type(await body().findByLabelText("Name"), "scout");
    await userEvent.click(body().getByRole("button", { name: "Create agent" }));
  },
};

/** A new agent in a project: the VM list has only project VMs. */
export const NewProjectAgent: Story = {
  async play() {
    await userEvent.type(await body().findByLabelText("Name"), "scout");
    await userEvent.click(body().getByRole("combobox", { name: "Project" }));
    await userEvent.click(await body().findByRole("option", { name: "Payments" }));
  },
};

/** An admin takes a project agent out of its project: the Owner field asks who owns it. */
export const TakeOut: Story = {
  args: { agent: PROJECT_AGENT },
  async play() {
    await userEvent.click(await body().findByRole("combobox", { name: "Project" }));
    await userEvent.click(await body().findByRole("option", { name: "No project" }));
  },
};

/** Another admin deleted the project of the agent: Save stays off. */
export const ProjectGone: Story = { args: { agent: PROJECT_AGENT, projects: [MARKETING] } };
