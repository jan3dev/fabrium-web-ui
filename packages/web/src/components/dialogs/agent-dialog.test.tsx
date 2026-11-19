import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { CAN_NOTHING, PROFILE, VM_GONE, makeAgent } from "../../../test/vm-fixtures";
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
    await user.type(screen.getByLabelText("Project"), "Payments");
    await user.click(button("Create agent"));

    expect(onSubmit.mock.calls).toStrictEqual([
      [{ name: "scout", model: "glm-5-3", tag: "Reviewer", project: "Payments", vm: "lima" }],
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
      "A change of the description or the model restarts every agent of the VM lima. A turn in progress is lost.";
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

  it("Cancel closes the dialog", async () => {
    const { user, onOpenChange } = setup();
    await user.click(button("Cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
