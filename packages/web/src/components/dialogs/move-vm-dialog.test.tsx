import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { MARKETING, PAYMENTS, PROJECTS, PROJECT_VM, makeVm } from "../../../test/vm-fixtures";
import { FabriumApiError } from "../../client/fabrium-api";
import type { VmOwnerInput } from "../../model/types";
import { MoveVmDialog } from "./move-vm-dialog";

type Props = ComponentProps<typeof MoveVmDialog>;

const PEOPLE = [
  { user_id: "@ann:example.org", name: "Ann" },
  { user_id: "@luis:example.org", name: "Luis" },
];
const NOTE =
  "Every member with a role can run agents on this VM, with its Haven API key and its GitHub token. Use credentials made for the project, not for one person.";

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    onOpenChange: vi.fn(),
    vm: makeVm(),
    projects: PROJECTS,
    projectsError: null,
    canManageProjects: true,
    onCreateProject: vi.fn(async (name: string) => ({ id: "p9", name, in_use: false })),
    people: PEOPLE,
    onSubmit: vi.fn(async (_input: VmOwnerInput) => {}),
    ...over,
  };
  const view = render(<MoveVmDialog {...props} />);
  return {
    onSubmit: vi.mocked(props.onSubmit),
    onOpenChange: vi.mocked(props.onOpenChange),
    user: userEvent.setup(),
    rerender: (next: Partial<Props>) => view.rerender(<MoveVmDialog {...props} {...next} />),
  };
}

const move = () => screen.getByRole("button", { name: "Move VM" });
const projectField = () => screen.getByRole("combobox", { name: "Project" });
async function pickProject(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(projectField());
  await user.click(await screen.findByRole("option", { name }));
}

describe("<MoveVmDialog>", () => {
  it("puts a personal VM into a project", async () => {
    const { user, onSubmit } = setup();
    expect(screen.getByRole("dialog", { name: "Move lima to a project" })).toBeInTheDocument();
    expect(projectField()).toHaveTextContent("No project");
    await pickProject(user, "Payments");
    await user.click(move());
    expect(onSubmit.mock.calls).toStrictEqual([[{ project_id: PAYMENTS.id }]]);
  });

  it("moves a project VM to another project", async () => {
    const { user, onSubmit } = setup({ vm: PROJECT_VM });
    expect(projectField()).toHaveTextContent("Payments");
    await pickProject(user, "Marketing");
    await user.click(move());
    expect(onSubmit.mock.calls).toStrictEqual([[{ project_id: MARKETING.id }]]);
  });

  it("keeps Move VM off until the project changes", async () => {
    const { user } = setup({ vm: PROJECT_VM });
    expect(move()).toBeDisabled();
    await pickProject(user, "Marketing");
    expect(move()).toBeEnabled();
    await pickProject(user, "Payments");
    expect(move()).toBeDisabled();
  });

  it("an admin takes a VM out and picks the owner", async () => {
    const { user, onSubmit } = setup({ vm: PROJECT_VM });
    expect(screen.queryByLabelText("Owner")).toBeNull();
    await pickProject(user, "No project");

    const owner = screen.getByLabelText("Owner");
    expect(owner).toHaveValue("");
    expect(within(owner).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Choose an owner",
      "Ann (@ann:example.org)",
      "Luis (@luis:example.org)",
    ]);
    expect(owner).toHaveAccessibleDescription("The VM leaves the project. Choose who owns it.");
    expect(move()).toBeDisabled();

    await user.selectOptions(owner, "@luis:example.org");
    await user.click(move());
    expect(onSubmit.mock.calls).toStrictEqual([
      [{ project_id: "", owner: "@luis:example.org" }],
    ]);
  });

  it("starts a take-out on the creator when it is a person", async () => {
    const { user, onSubmit } = setup({ vm: { ...PROJECT_VM, creator: "@ann:example.org" } });
    await pickProject(user, "No project");
    expect(screen.getByLabelText("Owner")).toHaveValue("@ann:example.org");
    await user.click(move());
    expect(onSubmit.mock.calls).toStrictEqual([[{ project_id: "", owner: "@ann:example.org" }]]);
  });

  it("shows the credentials note only while a project is selected", async () => {
    const { user } = setup();
    expect(screen.queryByText(NOTE)).toBeNull();
    await pickProject(user, "Payments");
    expect(screen.getByRole("status")).toHaveTextContent(NOTE);
  });

  it("shows the restart note only for a VM with agents", () => {
    const { rerender } = setup();
    expect(screen.getByRole("dialog", { name: "Move lima to a project" })).toHaveAccessibleDescription(
      "The agents of lima restart within about a minute. A turn in progress is lost.",
    );
    rerender({ open: false });
    rerender({ open: true, vm: makeVm({ agents: [] }) });
    expect(screen.queryByText(/restart within about a minute/)).toBeNull();
  });

  it("keeps Move VM off while the project is gone", async () => {
    const { user } = setup({ vm: { ...PROJECT_VM, project_id: "ffffffffffffffffffffffffffffffff" } });
    expect(projectField()).toHaveAccessibleDescription(
      "That project no longer exists. Pick another one.",
    );
    expect(move()).toBeDisabled();
    await pickProject(user, "Marketing");
    expect(move()).toBeEnabled();
  });

  it("shows the 409 of a VM with project agents and stays open", async () => {
    const onSubmit = vi
      .fn<(input: VmOwnerInput) => Promise<void>>()
      .mockRejectedValueOnce(new FabriumApiError(409, "the vm has project agents"));
    const { user, onOpenChange } = setup({ vm: { ...PROJECT_VM, creator: "@ann:example.org" }, onSubmit });
    await pickProject(user, "No project");
    await user.click(move());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This VM has project agents, so it must stay in a project.",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("Cancel closes the dialog", async () => {
    const { user, onOpenChange } = setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
