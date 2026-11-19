import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { MARKETING, PAYMENTS, PROJECTS } from "../../../test/vm-fixtures";
import { FabriumApiError } from "../../client/fabrium-api";
import { ManageProjectsDialog } from "./manage-projects-dialog";

type Props = ComponentProps<typeof ManageProjectsDialog>;

const IN_USE = "Something belongs to this project. Move it out first.";
const RULE = "A project name has 1 to 64 characters, with no control characters.";

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    onOpenChange: vi.fn(),
    projects: PROJECTS,
    error: null,
    onRename: vi.fn(async () => {}),
    onDelete: vi.fn(async () => {}),
    ...over,
  };
  render(<ManageProjectsDialog {...props} />);
  return {
    onOpenChange: vi.mocked(props.onOpenChange),
    onRename: vi.mocked(props.onRename),
    onDelete: vi.mocked(props.onDelete),
    user: userEvent.setup(),
  };
}

const button = (name: string) => screen.getByRole("button", { name });
const dialog = () => screen.getByRole("dialog", { name: "Manage projects" });

async function startRename(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(button(`Rename ${name}`));
  return screen.getByRole("textbox", { name: `Name of ${name}` });
}

describe("<ManageProjectsDialog>", () => {
  it("lists the projects with Rename and Delete", () => {
    setup();
    expect(dialog()).toHaveAccessibleDescription(
      "Rename a project, or delete one that nothing belongs to.",
    );
    const items = within(dialog()).getAllByRole("listitem");
    expect(items.map((li) => within(li).getAllByRole("button").map((b) => b.textContent))).toEqual(
      [
        ["Rename", "Delete"],
        ["Rename", "Delete"],
      ],
    );
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Marketing"),
      expect.stringContaining("Payments"),
    ]);
    expect(button("Rename Marketing")).toBeEnabled();
    expect(button("Close")).toBeEnabled();
  });

  it("renames a project", async () => {
    const { user, onRename } = setup();
    const input = await startRename(user, "Payments");
    expect(input).toHaveValue("Payments");
    await user.clear(input);
    await user.type(input, "Billing");
    await user.click(button("Save"));
    expect(onRename.mock.calls).toEqual([[PAYMENTS.id, "Billing"]]);
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });

  it("sends a rename that changes only the case", async () => {
    const { user, onRename } = setup();
    const input = await startRename(user, "Payments");
    await user.clear(input);
    await user.type(input, "payments");
    await user.click(button("Save"));
    expect(onRename.mock.calls).toEqual([[PAYMENTS.id, "payments"]]);
  });

  it("refuses an invalid name without a request", async () => {
    const { user, onRename } = setup();
    const input = await startRename(user, "Payments");
    await user.clear(input);
    await user.type(input, "a".repeat(65));
    expect(button("Save")).toBeDisabled();
    expect(input).toHaveAccessibleDescription(RULE);
    await user.keyboard("{Enter}");
    expect(onRename).not.toHaveBeenCalled();
  });

  it("Enter in the rename field saves, and Escape cancels the rename and not the dialog", async () => {
    const { user, onRename, onOpenChange } = setup();
    let input = await startRename(user, "Payments");
    await user.type(input, "{Escape}");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
    await waitFor(() => expect(button("Rename Payments")).toHaveFocus());

    input = await startRename(user, "Payments");
    await user.clear(input);
    await user.type(input, "Billing{Enter}");
    expect(onRename.mock.calls).toEqual([[PAYMENTS.id, "Billing"]]);
  });

  it("disables Delete for a project in use, with the reason", () => {
    setup();
    expect(button("Delete Payments")).toBeDisabled();
    expect(button("Delete Payments")).toHaveAccessibleDescription(IN_USE);
    expect(button("Delete Marketing")).toBeEnabled();
    expect(button("Delete Marketing")).not.toHaveAccessibleDescription();
  });

  it("deletes a project that nothing uses", async () => {
    const { user, onDelete } = setup();
    await user.click(button("Delete Marketing"));
    expect(onDelete.mock.calls).toEqual([[MARKETING.id]]);
  });

  it("shows the 409 of a rename or a delete and stays open", async () => {
    const onRename = vi.fn(async () => {
      throw new FabriumApiError(409, "name in use");
    });
    const onDelete = vi.fn(async () => {
      throw new FabriumApiError(409, "project in use");
    });
    const { user, onOpenChange } = setup({ onRename, onDelete });
    const input = await startRename(user, "Payments");
    await user.clear(input);
    await user.type(input, "Marketing{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A project with this name already exists.",
    );
    expect(input).toHaveValue("Marketing");

    await user.click(button("Cancel"));
    await user.click(button("Delete Marketing"));
    expect(await screen.findByRole("alert")).toHaveTextContent(IN_USE);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("disables the row buttons while a request runs", async () => {
    let finish!: () => void;
    const onDelete = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user } = setup({ onDelete });
    await user.click(button("Delete Marketing"));
    for (const name of ["Rename Marketing", "Delete Marketing", "Rename Payments"]) {
      expect(button(name)).toBeDisabled();
    }
    finish();
    await waitFor(() => expect(button("Rename Marketing")).toBeEnabled());
  });

  it("shows the empty text", () => {
    setup({ projects: [] });
    expect(
      screen.getByText("No projects yet. Create one from the Project field of an agent."),
    ).toBeInTheDocument();
  });

  it("shows the load error", () => {
    setup({ projects: null, error: "control plane unreachable" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load the projects. control plane unreachable",
    );
  });

  it("Close closes the dialog", async () => {
    const { user, onOpenChange } = setup();
    await user.click(button("Close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
