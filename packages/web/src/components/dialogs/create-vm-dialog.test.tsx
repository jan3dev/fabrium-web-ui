import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  CAN_NOTHING,
  INSTANCE_TYPES,
  MARKETING,
  PAYMENTS,
  PROFILE,
  PROJECTS,
  PROJECT_AGENT,
  VM_GONE,
} from "../../../test/vm-fixtures";
import { FabriumApiError } from "../../client/fabrium-api";
import type { CreateVmRequest } from "../../model/types";
import { CreateVmDialog } from "./create-vm-dialog";

type Props = ComponentProps<typeof CreateVmDialog>;

/** A profile, seen by a VM creator: it may get a VM. */
const FOR_VM_CREATOR = { ...PROFILE, can: { ...PROFILE.can, create_vm: true } };
/** A project agent whose VM is gone, seen by an admin. */
const PROJECT_NO_VM = {
  ...PROJECT_AGENT,
  vm: { name: "kilo" },
  can: { ...PROJECT_AGENT.can, create_vm: true },
};
const NOTE =
  "Every member with a role can run agents on this VM, with its Haven API key and its GitHub token. Use credentials made for the project, not for one person.";
const REASON = "This agent is in a project, so its VM must be in a project too.";

function setup({
  onSubmit = vi.fn(async (_req: CreateVmRequest) => {}),
  ...over
}: Partial<Props> = {}) {
  const onOpenChange = vi.fn();
  const props: Props = {
    open: true,
    onOpenChange,
    agent: FOR_VM_CREATOR,
    types: INSTANCE_TYPES,
    typesError: null,
    projects: PROJECTS,
    projectsError: null,
    canManageProjects: true,
    onCreateProject: vi.fn(async (name: string) => ({ id: "p9", name, in_use: false })),
    onSubmit,
    ...over,
  };
  const view = render(<CreateVmDialog {...props} />);
  return {
    onSubmit: vi.mocked(onSubmit),
    onOpenChange,
    user: userEvent.setup(),
    rerender: (next: Partial<Props>) => view.rerender(<CreateVmDialog {...props} {...next} />),
  };
}

const create = () => screen.getByRole("button", { name: "Create VM" });
const field = (label: string) => screen.getByLabelText(label);
const projectField = () => screen.getByRole("combobox", { name: "Project" });

describe("<CreateVmDialog>", () => {
  it("sends the agent id, the name, the type, the hours, and the key", async () => {
    const { user, onSubmit } = setup();
    expect(screen.getByRole("dialog", { name: "Create a VM for scout" })).toBeInTheDocument();
    expect(field("Instance type")).toHaveValue("t3a.medium");
    expect(field("Auto-stop after (hours)")).toHaveValue(12);

    await user.type(field("VM name"), "lima");
    await user.selectOptions(field("Instance type"), "c6a.large");
    await user.clear(field("Auto-stop after (hours)"));
    await user.type(field("Auto-stop after (hours)"), "24");
    await user.type(field("Haven API key"), "hk-1");
    await user.type(field("GitHub token"), "gh-1");
    await user.click(create());

    expect(onSubmit.mock.calls).toStrictEqual([
      [
        {
          agent: FOR_VM_CREATOR.id,
          name: "lima",
          instance_type: "c6a.large",
          auto_stop_hours: 24,
          haven_api_key: "hk-1",
          github_token: "gh-1",
        },
      ],
    ]);
  });

  it("the VM name is fixed for an agent that has a vm", async () => {
    const { user, onSubmit } = setup({ agent: VM_GONE });
    expect(field("VM name")).toHaveValue("kilo");
    expect(field("VM name")).toHaveAttribute("readonly");
    expect(field("VM name")).toHaveAccessibleDescription(
      "This agent belongs to the VM kilo. The other agents of that VM start with it.",
    );

    await user.type(field("Haven API key"), "hk-1");
    await user.click(create());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ agent: VM_GONE.id, name: "kilo" });
  });

  it("refuses a bad VM name without a request", async () => {
    const { user, onSubmit } = setup();
    await user.type(field("VM name"), "Lima");
    await user.type(field("Haven API key"), "hk-1");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Use lowercase letters, digits, or hyphens, and start with a letter or a digit. At most 63 characters.",
    );
    expect(field("VM name")).toHaveAttribute("aria-invalid", "true");
    expect(create()).toBeDisabled();
    await user.click(create());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("needs the Haven API key", async () => {
    const { user } = setup();
    await user.type(field("VM name"), "lima");
    expect(create()).toBeDisabled();
    await user.type(field("Haven API key"), "   ");
    expect(create()).toBeDisabled();
    await user.type(field("Haven API key"), "hk-1");
    expect(create()).toBeEnabled();
  });

  it("leaves github_token out when it is empty, and trims what it sends", async () => {
    const { user, onSubmit } = setup();
    await user.type(field("VM name"), " lima ");
    await user.type(field("Haven API key"), " hk-1 ");
    await user.type(field("GitHub token"), " ");
    await user.click(create());

    expect(onSubmit.mock.calls).toStrictEqual([
      [
        {
          agent: FOR_VM_CREATOR.id,
          name: "lima",
          instance_type: "t3a.medium",
          auto_stop_hours: 12,
          haven_api_key: "hk-1",
        },
      ],
    ]);
  });

  it("takes both secrets in password inputs without autocomplete", () => {
    setup();
    for (const label of ["Haven API key", "GitHub token"]) {
      expect(field(label)).toHaveAttribute("type", "password");
      expect(field(label)).toHaveAttribute("autocomplete", "off");
    }
  });

  it("the fields are empty after cancel and open", async () => {
    const { user, onOpenChange, rerender } = setup();
    await user.type(field("VM name"), "lima");
    await user.type(field("Haven API key"), "hk-1");
    await user.type(field("GitHub token"), "gh-1");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender({ open: true });
    expect(field("Haven API key")).toHaveValue("");
    expect(field("GitHub token")).toHaveValue("");
    expect(field("VM name")).toHaveValue("");
  });

  it("the submit button is disabled while the request runs", async () => {
    let finish!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user, onOpenChange } = setup({ onSubmit });
    await user.type(field("VM name"), "lima");
    await user.type(field("Haven API key"), "hk-1");
    await user.click(create());

    expect(create()).toBeDisabled();
    expect(field("Haven API key")).toBeDisabled();
    await user.click(create());
    await user.keyboard("{Escape}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    finish();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("shows the step of a failed admission", async () => {
    const onSubmit = vi
      .fn<(req: CreateVmRequest) => Promise<void>>()
      .mockRejectedValueOnce(new FabriumApiError(502, "matrix timeout", "join"));
    const { user, onOpenChange } = setup({ onSubmit });
    await user.type(field("VM name"), "lima");
    await user.type(field("Haven API key"), "hk-1");
    await user.click(create());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("matrix timeout");
    expect(alert).toHaveTextContent("Failed at step: join. Select Create VM to retry from that step.");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(field("Haven API key")).toHaveValue("hk-1");
  });

  it("disables Create VM when a refresh takes away can.create_vm", async () => {
    const { user, rerender, onSubmit } = setup();
    await user.type(field("VM name"), "lima");
    await user.type(field("Haven API key"), "hk-1");
    expect(create()).toBeEnabled();

    // Another user created the VM in the meantime: the agent has a live VM now.
    rerender({
      agent: {
        ...FOR_VM_CREATOR,
        vm: { name: "lima", id: "i-0123456789abcdef0", state: "pending" },
        can: { ...CAN_NOTHING, edit: true, delete: true, delete_needs_vm: true },
      },
    });
    expect(create()).toBeDisabled();
    await user.click(create());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows why the instance types did not load, and keeps Create VM disabled", async () => {
    const { user } = setup({ types: null, typesError: "control plane unreachable" });
    await user.type(field("VM name"), "lima");
    await user.type(field("Haven API key"), "hk-1");
    expect(screen.getByRole("alert")).toHaveTextContent("control plane unreachable");
    expect(create()).toBeDisabled();
  });

  it("shows a loading line while the instance types load", () => {
    setup({ types: null });
    expect(within(screen.getByRole("dialog")).getByText("Loading instance types…")).toBeInTheDocument();
    expect(create()).toBeDisabled();
  });

  it("starts on the project of the agent", () => {
    setup({ agent: PROJECT_NO_VM });
    expect(projectField()).toHaveTextContent("Payments");
  });

  it("disables No project for a project agent, with the reason", async () => {
    const { user } = setup({ agent: PROJECT_NO_VM });
    expect(projectField()).toHaveAccessibleDescription(REASON);
    await user.click(projectField());
    expect(screen.getByRole("option", { name: "No project" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("allows No project for a personal agent", async () => {
    const { user } = setup();
    expect(projectField()).toHaveTextContent("No project");
    expect(screen.queryByText(REASON)).toBeNull();
    await user.click(projectField());
    expect(screen.getByRole("option", { name: "No project" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("shows the credentials note only while a project is selected", async () => {
    const { user, rerender } = setup({ agent: PROJECT_NO_VM });
    expect(screen.getByRole("status")).toHaveTextContent(NOTE);

    rerender({ open: false });
    rerender({ open: true, agent: FOR_VM_CREATOR });
    expect(screen.queryByText(NOTE)).toBeNull();
    await user.click(projectField());
    await user.click(screen.getByRole("option", { name: "Payments" }));
    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });

  it("sends project_id, and no project_id for a personal VM", async () => {
    const { user, onSubmit, rerender } = setup({ agent: PROJECT_NO_VM });
    await user.type(field("Haven API key"), "hk-1");
    await user.click(create());
    expect(onSubmit.mock.calls).toStrictEqual([
      [expect.objectContaining({ name: "kilo", project_id: PAYMENTS.id })],
    ]);

    rerender({ open: false });
    rerender({ open: true, agent: FOR_VM_CREATOR });
    await user.type(field("VM name"), "lima");
    await user.type(field("Haven API key"), "hk-1");
    await user.click(create());
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0]).not.toHaveProperty("project_id");
  });

  it("keeps Create VM off while the project is gone", async () => {
    const { user } = setup({ agent: PROJECT_NO_VM, projects: [MARKETING] });
    await user.type(field("Haven API key"), "hk-1");
    expect(projectField()).toHaveAccessibleDescription(
      `${REASON} That project no longer exists. Pick another one.`,
    );
    expect(create()).toBeDisabled();
  });

  it("shows the 409 of the rule of the project VM and stays open", async () => {
    const onSubmit = vi
      .fn<(req: CreateVmRequest) => Promise<void>>()
      .mockRejectedValueOnce(new FabriumApiError(409, "a project agent needs a project vm"));
    const { user, onOpenChange } = setup({ onSubmit });
    await user.type(field("VM name"), "lima");
    await user.type(field("Haven API key"), "hk-1");
    await user.click(create());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A project agent runs only on a project VM.",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
