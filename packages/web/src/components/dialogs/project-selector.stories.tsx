import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ComponentProps, useState } from "react";
import { userEvent, within } from "storybook/test";
import { PAYMENTS, PROJECTS } from "../../../test/vm-fixtures";
import { ProjectSelector, ProjectVmNote } from "./project-selector";

type Props = ComponentProps<typeof ProjectSelector>;

/** The selector with the state of its value, as a dialog holds it. */
function Stateful(props: Props) {
  const [value, setValue] = useState(props.value);
  return (
    <div className="flex w-96 flex-col gap-4">
      <ProjectSelector {...props} value={value} onChange={setValue} />
      {value ? <ProjectVmNote /> : null}
    </div>
  );
}

const meta = {
  title: "Dialogs/ProjectSelector",
  component: ProjectSelector,
  render: (args) => <Stateful {...args} />,
  args: {
    id: "story-project",
    projects: PROJECTS,
    loadError: null,
    value: null,
    onChange: () => {},
    canCreate: false,
    onCreate: async (name) => ({ id: "0f0e0d0c0b0a09080706050403020100", name, in_use: false }),
  },
} satisfies Meta<typeof ProjectSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

const body = () => within(document.body);

export const Closed: Story = { args: { value: PAYMENTS.id } };

export const Open: Story = {
  async play() {
    await userEvent.click(await body().findByRole("combobox", { name: "Project" }));
  },
};

/** A member who manages projects types a name that no project has. */
export const CanCreate: Story = {
  args: { canCreate: true },
  async play() {
    await userEvent.click(await body().findByRole("combobox", { name: "Project" }));
    await userEvent.type(
      await body().findByRole("combobox", { name: "Search or create a project" }),
      "Billing",
    );
  },
};

/** Create VM for a project agent: its VM must be in a project too. */
export const NoneDisabled: Story = {
  args: {
    value: PAYMENTS.id,
    noneDisabled: true,
    hint: "This agent is in a project, so its VM must be in a project too.",
  },
  async play() {
    await userEvent.click(await body().findByRole("combobox", { name: "Project" }));
  },
};

/** Another admin deleted the selected project. */
export const Gone: Story = { args: { value: "ffffffffffffffffffffffffffffffff" } };

export const LoadError: Story = {
  args: { projects: null, loadError: "control plane unreachable" },
};
