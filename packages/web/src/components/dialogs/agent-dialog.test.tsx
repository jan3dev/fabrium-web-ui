import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  CAN_NOTHING,
  MARKETING,
  PAYMENTS,
  PROFILE,
  PROJECTS,
  PROJECT_AGENT,
  VM_GONE,
  makeAgent,
} from "../../../test/vm-fixtures";
import { FabriumApiError } from "../../client/fabrium-api";
import type { AgentInput } from "../../model/types";
import { AgentDialog } from "./agent-dialog";

type Props = ComponentProps<typeof AgentDialog>;

const MODELS = { models: [{ id: "glm-5-3" }, { id: "qwen-3" }], default: "glm-5-3" };
const MEMBERS = [
  { userId: "@ann:example.org", name: "Ann" },
  { userId: "@luis:example.org", name: "Luis" },
];

function setup({
  onSubmit = vi.fn(async (_input: AgentInput) => {}),
  ...over
}: Partial<Props> = {}) {
  const onOpenChange = vi.fn();
  const props: Props = {
    open: true,
    onOpenChange,
    agent: null,
    vms: [{ name: "lima", state: "running", project_id: null }],
    models: MODELS,
    modelsError: null,
    members: MEMBERS,
    projects: PROJECTS,
    projectsError: null,
    canManageProjects: true,
    onCreateProject: vi.fn(async (name: string) => ({ id: "p9", name, in_use: false })),
    onSubmit,
    ...over,
  };
  const view = render(<AgentDialog {...props} />);
  return {
    onSubmit: vi.mocked(onSubmit),
    onOpenChange,
    user: userEvent.setup(),
    rerender: (next: Partial<Props>) => view.rerender(<AgentDialog {...props} {...next} />),
  };
}

const button = (name: string) => screen.getByRole("button", { name });
const optionTexts = (select: HTMLElement) =>
  within(select)
    .getAllByRole("option")
    .map((o) => o.textContent);
const projectField = () => screen.getByRole("combobox", { name: "Project" });
async function pickProject(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(projectField());
  await user.click(await screen.findByRole("option", { name }));
}
const KILO = { name: "kilo", state: "running" as const, project_id: PAYMENTS.id };
const NO_PROJECT_VM = "A project agent runs only on a project VM. No project VM is available.";
const setDescription = (text: string) =>
  act(() => {
    fireEvent.change(screen.getByLabelText("Agent description"), { target: { value: text } });
  });

describe("<AgentDialog>", () => {
  it("creates a profile with the default model", async () => {
    const { user, onSubmit } = setup();
    expect(screen.getByRole("dialog", { name: "New agent" })).toBeInTheDocument();
    expect(screen.getByText("The instructions of the agent. They become its AGENTS.md.")).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toHaveValue("glm-5-3");
    expect(screen.getByLabelText("VM")).toHaveValue("");

    await user.type(screen.getByLabelText("Name"), "scout");
    await user.type(screen.getByLabelText("Agent description"), "You review code.");
    await user.click(button("Create agent"));

    expect(onSubmit.mock.calls).toStrictEqual([
      [{ name: "scout", description: "You review code.", model: "glm-5-3" }],
    ]);
  });

  it("starts on the default model once the list loads", () => {
    const { rerender } = setup({ models: null });
    rerender({ models: MODELS });
    expect(screen.getByLabelText("Model")).toHaveValue("glm-5-3");
  });

  it("creates an agent on a VM", async () => {
    const { user, onSubmit } = setup();
    const note = "Every agent of a VM uses its Haven API key and its GitHub token.";
    expect(optionTexts(screen.getByLabelText("VM"))).toEqual(["No VM", "lima"]);
    expect(screen.queryByText(note)).toBeNull();

    await user.type(screen.getByLabelText("Name"), "scout");
    await user.selectOptions(screen.getByLabelText("VM"), "lima");
    expect(screen.getByText(note)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Tag"), "Reviewer");
    await user.click(button("Create agent"));

    expect(onSubmit.mock.calls).toStrictEqual([
      [{ name: "scout", model: "glm-5-3", tag: "Reviewer", vm: "lima" }],
    ]);
  });

  it("keeps a chosen VM that leaves the list, so it sends what it shows", async () => {
    const { user, onSubmit, rerender } = setup();
    await user.type(screen.getByLabelText("Name"), "scout");
    await user.selectOptions(screen.getByLabelText("VM"), "lima");

    // A poll in which lima is no longer a VM the caller can use.
    rerender({ vms: [] });
    const select = screen.getByLabelText("VM");
    expect(select).toHaveValue("lima");
    expect(optionTexts(select)).toEqual(["No VM", "lima"]);
    await user.click(button("Create agent"));
    expect(onSubmit.mock.calls).toStrictEqual([
      [{ name: "scout", model: "glm-5-3", vm: (select as HTMLSelectElement).value }],
    ]);
  });

    it("refuses a bad name without a request", async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByLabelText("Name"), "Reviewer");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Use a lowercase letter first, then lowercase letters, digits, or hyphens. At most 32 characters.",
    );
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    await user.click(button("Create agent"));
    expect(onSubmit).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "reviewer");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(button("Create agent")).toBeEnabled();
  });

  it("refuses a description over 16384 bytes", async () => {
    const { user, onSubmit } = setup();
    const error = "The description is too long (max 16 KB).";
    await user.type(screen.getByLabelText("Name"), "scout");

    // 8193 characters of 2 bytes each: 16386 bytes, under the limit in characters.
    await setDescription("é".repeat(8193));
    expect(screen.getByRole("alert")).toHaveTextContent(error);
    expect(screen.getByLabelText("Agent description")).toHaveAttribute("aria-invalid", "true");
    await user.click(button("Create agent"));
    expect(onSubmit).not.toHaveBeenCalled();

    await setDescription("é".repeat(8192));
    expect(screen.queryByText(error)).toBeNull();
    await user.click(button("Create agent"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].description).toHaveLength(8192);
  });

  it("an edit sends only the fields that changed", async () => {
    const { user, onSubmit } = setup({ agent: makeAgent() });
    expect(screen.getByRole("dialog", { name: "Edit agent" })).toBeInTheDocument();
    expect(screen.getByLabelText("Agent description")).toHaveValue(makeAgent().description);
    expect(screen.getByLabelText("Model")).toHaveValue("glm-5-3");
    expect(button("Save")).toBeDisabled(); // nothing changed yet

    await user.clear(screen.getByLabelText("Tag"));
    await user.type(screen.getByLabelText("Tag"), "X");
    await user.click(button("Save"));

    expect(onSubmit.mock.calls).toStrictEqual([[{ tag: "X" }]]);
  });

  it("an empty tag is sent as an empty string", async () => {
    const { user, onSubmit } = setup({ agent: makeAgent() });
    await user.clear(screen.getByLabelText("Tag"));
    await user.click(button("Save"));
    expect(onSubmit.mock.calls).toStrictEqual([[{ tag: "" }]]);
  });

  it("an edit has no Name field and no VM field for an agent with a vm", () => {
    setup({ agent: makeAgent({ can: { ...CAN_NOTHING, edit: true, assign: true } }) });
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByLabelText("VM")).toBeNull();
  });

  it("an edit of a profile with can.assign has the VM field", async () => {
    const { user, onSubmit } = setup({ agent: PROFILE });
    expect(optionTexts(screen.getByLabelText("VM"))).toEqual(["No VM", "lima"]);
    await user.selectOptions(screen.getByLabelText("VM"), "lima");
    await user.click(button("Save"));
    expect(onSubmit.mock.calls).toStrictEqual([[{ vm: "lima" }]]);
  });

  it("an edit of a profile without can.assign has no VM field", () => {
    setup({ agent: { ...PROFILE, can: { ...PROFILE.can, assign: false } } });
    expect(screen.queryByLabelText("VM")).toBeNull();
  });

  it("the Owner field shows only with can.set_owner", async () => {
    const { user, onSubmit } = setup({ agent: makeAgent() });
    expect(screen.getByLabelText("Owner")).toHaveValue("@ann:example.org");
    await user.selectOptions(screen.getByLabelText("Owner"), "@luis:example.org");
    await user.click(button("Save"));
    expect(onSubmit.mock.calls).toStrictEqual([[{ owner: "@luis:example.org" }]]);
  });

  it("has no Owner field without can.set_owner", () => {
    setup({ agent: PROFILE });
    expect(screen.queryByLabelText("Owner")).toBeNull();
  });

  it("has no Owner field in New agent", () => {
    setup();
    expect(screen.queryByLabelText("Owner")).toBeNull();
  });

  it("keeps an owner who is no longer a person as an option", () => {
    setup({ agent: makeAgent({ owner: "@gone:example.org" }) });
    const owner = screen.getByLabelText("Owner");
    expect(owner).toHaveValue("@gone:example.org");
    expect(within(owner).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "@gone:example.org",
      "Ann (@ann:example.org)",
      "Luis (@luis:example.org)",
    ]);
  });

  it("shows the restart note only for an agent with a live VM", () => {
    const note =
      "A change of the description, the model, the owner, or the project restarts every agent of the VM lima. A turn in progress is lost.";
    const { rerender } = setup({ agent: makeAgent() });
    expect(screen.getByRole("dialog", { name: "Edit agent" })).toHaveAccessibleDescription(note);

    rerender({ open: false });
    rerender({ open: true, agent: VM_GONE });
    expect(screen.queryByText(/restarts every agent/)).toBeNull();

    rerender({ open: false });
    rerender({ open: true, agent: PROFILE });
    expect(screen.queryByText(/restarts every agent/)).toBeNull();
  });

  it("an edit can save while the model list failed", async () => {
    const { user, onSubmit } = setup({
      agent: makeAgent(),
      models: null,
      modelsError: "the Haven model list does not answer",
    });
    expect(screen.getByRole("alert")).toHaveTextContent("the Haven model list does not answer");
    expect(screen.getByLabelText("Model")).toHaveValue("glm-5-3");

    await user.type(screen.getByLabelText("Tag"), "-2");
    await user.click(button("Save"));
    expect(onSubmit.mock.calls).toStrictEqual([[{ tag: "Reviewer-2" }]]);
  });

  it("a new agent cannot be created while the model list failed", async () => {
    const { user } = setup({ models: null, modelsError: "the Haven model list does not answer" });
    await user.type(screen.getByLabelText("Name"), "scout");
    expect(button("Create agent")).toBeDisabled();
  });

  it("the submit button is disabled while the request runs", async () => {
    let finish!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user, onOpenChange } = setup({ onSubmit });
    await user.type(screen.getByLabelText("Name"), "scout");
    await user.click(button("Create agent"));

    expect(button("Create agent")).toBeDisabled();
    expect(button("Cancel")).toBeDisabled();
    await user.click(button("Create agent"));
    await user.keyboard("{Escape}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    finish();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("shows the error of a failed request and stays open", async () => {
    const onSubmit = vi
      .fn<(input: AgentInput) => Promise<void>>()
      .mockRejectedValueOnce(new FabriumApiError(409, "name in use"));
    const { user, onOpenChange } = setup({ onSubmit });
    await user.type(screen.getByLabelText("Name"), "scout");
    await user.click(button("Create agent"));

    expect(await screen.findByRole("alert")).toHaveTextContent("name in use");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toHaveValue("scout");
    expect(button("Create agent")).toBeEnabled();
  });

  it("shows the step of a failed assign", async () => {
    const onSubmit = vi
      .fn<(input: AgentInput) => Promise<void>>()
      .mockRejectedValueOnce(new FabriumApiError(502, "matrix timeout", "join"));
    const { user } = setup({ onSubmit });
    await user.type(screen.getByLabelText("Name"), "scout");
    await user.selectOptions(screen.getByLabelText("VM"), "lima");
    await user.click(button("Create agent"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("matrix timeout");
    expect(alert).toHaveTextContent("Failed at step: join.");
  });

  it("creates a project agent", async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByLabelText("Name"), "scout");
    await pickProject(user, "Payments");
    expect(projectField()).toHaveTextContent("Payments");
    await user.click(button("Create agent"));
    expect(onSubmit.mock.calls).toStrictEqual([
      [{ name: "scout", model: "glm-5-3", project_id: PAYMENTS.id }],
    ]);
  });

  it("the VM list of a project agent has only project VMs", async () => {
    const { user } = setup({ vms: [{ name: "lima", state: "running", project_id: null }, KILO] });
    expect(optionTexts(screen.getByLabelText("VM"))).toEqual(["No VM", "lima", "kilo"]);
    await pickProject(user, "Payments");
    expect(optionTexts(screen.getByLabelText("VM"))).toEqual(["No VM", "kilo"]);
  });

  it("clears a personal VM that the chosen project leaves out", async () => {
    const { user } = setup({ vms: [{ name: "lima", state: "running", project_id: null }, KILO] });
    await user.selectOptions(screen.getByLabelText("VM"), "lima");
    await pickProject(user, "Payments");
    expect(screen.getByLabelText("VM")).toHaveValue("");
  });

  it("shows the reason when a project agent has no project VM", async () => {
    const { user } = setup();
    expect(screen.queryByText(NO_PROJECT_VM)).toBeNull();
    await pickProject(user, "Payments");
    expect(optionTexts(screen.getByLabelText("VM"))).toEqual(["No VM"]);
    expect(screen.getByLabelText("VM")).toHaveAccessibleDescription(NO_PROJECT_VM);
  });

  it("an edit sends project_id only when it changed", async () => {
    const { user, onSubmit, rerender } = setup({ agent: makeAgent() });
    await user.clear(screen.getByLabelText("Tag"));
    await user.type(screen.getByLabelText("Tag"), "X");
    await user.click(button("Save"));
    expect(onSubmit.mock.calls).toStrictEqual([[{ tag: "X" }]]);

    rerender({ open: false });
    rerender({ open: true, agent: PROJECT_AGENT });
    expect(projectField()).toHaveTextContent("Payments");
    expect(button("Save")).toBeDisabled();
    await pickProject(user, "Marketing");
    await user.click(button("Save"));
    expect(onSubmit.mock.calls[1]).toStrictEqual([{ project_id: MARKETING.id }]);
  });

  it("an edit has the selector only with can.set_project", () => {
    setup({ agent: makeAgent({ can: { ...makeAgent().can, set_project: false } }) });
    expect(screen.queryByRole("combobox", { name: "Project" })).toBeNull();
  });

  it("hides the Owner field when a project is selected, and drops its change", async () => {
    const { user, onSubmit } = setup({ agent: makeAgent() });
    await user.selectOptions(screen.getByLabelText("Owner"), "@luis:example.org");
    await pickProject(user, "Payments");
    expect(screen.queryByLabelText("Owner")).toBeNull();
    await user.click(button("Save"));
    expect(onSubmit.mock.calls).toStrictEqual([[{ project_id: PAYMENTS.id }]]);
  });

  it("an admin who takes an agent out of a project picks the owner", async () => {
    const { user, onSubmit } = setup({ agent: PROJECT_AGENT });
    expect(screen.queryByLabelText("Owner")).toBeNull();
    await pickProject(user, "No project");

    const owner = screen.getByLabelText("Owner");
    expect(owner).toHaveValue("");
    expect(optionTexts(owner)).toEqual([
      "Choose an owner",
      "Ann (@ann:example.org)",
      "Luis (@luis:example.org)",
    ]);
    expect(owner).toHaveAccessibleDescription("The agent leaves the project. Choose who owns it.");
    expect(button("Save")).toBeDisabled();

    await user.selectOptions(owner, "@luis:example.org");
    await user.click(button("Save"));
    expect(onSubmit.mock.calls).toStrictEqual([
      [{ project_id: "", owner: "@luis:example.org" }],
    ]);
  });

  it("a take-out starts on the stored owner when it is a person", async () => {
    const { user, onSubmit } = setup({ agent: { ...PROJECT_AGENT, owner: "@ann:example.org" } });
    await pickProject(user, "No project");
    expect(screen.getByLabelText("Owner")).toHaveValue("@ann:example.org");
    await user.click(button("Save"));
    expect(onSubmit.mock.calls).toStrictEqual([[{ project_id: "", owner: "@ann:example.org" }]]);
  });

  it("shows the restart note for the owner and the project", () => {
    setup({ agent: PROJECT_AGENT });
    expect(screen.getByRole("dialog", { name: "Edit agent" })).toHaveAccessibleDescription(
      "A change of the description, the model, the owner, or the project restarts every agent of the VM kilo. A turn in progress is lost.",
    );
  });

  it("keeps Save off, and explains, when the project is gone", async () => {
    const { user } = setup({ agent: PROJECT_AGENT, projects: [MARKETING] });
    expect(projectField()).toHaveTextContent("Payments");
    expect(projectField()).toHaveAccessibleDescription(
      "That project no longer exists. Pick another one.",
    );
    await user.type(screen.getByLabelText("Tag"), "X");
    expect(button("Save")).toBeDisabled();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("an edit can save other fields while the projects failed to load", async () => {
    const { user, onSubmit } = setup({
      agent: makeAgent(),
      projects: null,
      projectsError: "control plane unreachable",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load the projects. control plane unreachable",
    );
    await user.type(screen.getByLabelText("Tag"), "-2");
    await user.click(button("Save"));
    expect(onSubmit.mock.calls).toStrictEqual([[{ tag: "Reviewer-2" }]]);
  });

  it("shows the 409 of the rule of the project VM and stays open", async () => {
    const onSubmit = vi
      .fn<(input: AgentInput) => Promise<void>>()
      .mockRejectedValueOnce(new FabriumApiError(409, "a project agent needs a project vm"));
    const { user, onOpenChange } = setup({ onSubmit, vms: [KILO] });
    await user.type(screen.getByLabelText("Name"), "scout");
    await pickProject(user, "Payments");
    await user.selectOptions(screen.getByLabelText("VM"), "kilo");
    await user.click(button("Create agent"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A project agent runs only on a project VM.",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("Cancel closes the dialog", async () => {
    const { user, onOpenChange } = setup();
    await user.click(button("Cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
