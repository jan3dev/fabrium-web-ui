import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MARKETING, PAYMENTS, PROJECTS } from "../../../test/vm-fixtures";
import { FabriumApiError } from "../../client/fabrium-api";
import type { Project } from "../../model/types";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { ProjectSelector, projectGone } from "./project-selector";

type Props = ComponentProps<typeof ProjectSelector>;

const GONE = "That project no longer exists. Pick another one.";
const RULE = "A project name has 1 to 64 characters, with no control characters.";

/** The selector inside a dialog, with the state of its value, and a create that adds to the list. */
function Harness({
  initial,
  projects: start,
  onCreate,
  ...rest
}: Partial<Props> & { initial: string | null; onCreate: Props["onCreate"] }) {
  const [value, setValue] = useState(initial);
  const [projects, setProjects] = useState(start === undefined ? PROJECTS : start);
  return (
    <Dialog open>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Edit agent</DialogTitle>
        <ProjectSelector
          id="agent-project"
          projects={projects}
          loadError={null}
          value={value}
          canCreate
          {...rest}
          onChange={(next) => {
            rest.onChange?.(next);
            setValue(next);
          }}
          onCreate={async (name) => {
            const created = await onCreate(name);
            setProjects((list) => [...(list ?? []), created]);
            return created;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function setup({ initial = null, ...over }: Partial<Props> & { initial?: string | null } = {}) {
  const onChange = vi.fn<(id: string | null) => void>();
  const onCreate = vi.fn(async (name: string): Promise<Project> => ({ id: "p9", name, in_use: false }));
  render(<Harness initial={initial} onChange={onChange} onCreate={onCreate} {...over} />);
  return { onChange, onCreate: vi.mocked(over.onCreate ?? onCreate), user: userEvent.setup() };
}

const trigger = () => screen.getByRole("combobox", { name: "Project" });
const search = () => screen.getByRole("combobox", { name: "Search or create a project" });
const options = () => screen.queryAllByRole("option").map((o) => o.textContent);

describe("<ProjectSelector>", () => {
  it("lists No project, then the projects, in the order given", async () => {
    const { user } = setup();
    await user.click(trigger());
    expect(options()).toEqual(["No project", "Marketing", "Payments"]);
  });

  it("shows the selected name on the trigger", () => {
    setup({ initial: PAYMENTS.id });
    expect(trigger()).toHaveTextContent("Payments");
  });

  it("shows the name it was given while the list loads", () => {
    const { unmount } = render(
      <Harness initial={PAYMENTS.id} projects={null} fallbackName="Payments" onCreate={vi.fn()} />,
    );
    expect(trigger()).toHaveTextContent("Payments");
    expect(trigger()).toBeDisabled();
    unmount();
    render(<Harness initial={PAYMENTS.id} projects={null} onCreate={vi.fn()} />);
    expect(trigger()).toHaveTextContent("Loading projects…");
  });

  it("filters as the user types, ignoring case", async () => {
    // Without can.manage: "pay" is a name that no project has, which offers Create.
    const { user } = setup({ canCreate: false });
    await user.click(trigger());
    await user.type(search(), "pay");
    expect(options()).toEqual(["Payments"]);
  });

  it("offers Create project for a name that no project has", async () => {
    const { user } = setup();
    await user.click(trigger());
    await user.type(search(), "Billing");
    expect(options()).toEqual(['Create project "Billing"']);
  });

  it("creates the project and picks it", async () => {
    const { user, onCreate, onChange } = setup();
    await user.click(trigger());
    await user.type(search(), "Billing");
    await user.click(screen.getByRole("option", { name: 'Create project "Billing"' }));

    expect(onCreate).toHaveBeenCalledWith("Billing");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("p9"));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger()).toHaveTextContent("Billing");
  });

  it("trims the typed name", async () => {
    const { user, onCreate } = setup();
    await user.click(trigger());
    await user.type(search(), "  Billing  ");
    await user.click(screen.getByRole("option", { name: 'Create project "Billing"' }));
    expect(onCreate).toHaveBeenCalledWith("Billing");
  });

  it("offers the existing project, not Create, for a name that differs only in case", async () => {
    const { user } = setup();
    await user.click(trigger());
    await user.type(search(), "payments");
    expect(options()).toEqual(["Payments"]);
    expect(screen.queryByText(/Create project/)).toBeNull();
  });

  it("still offers Create for a name that differs only in a non-ASCII case", async () => {
    const eclair = { id: "0e1c2a3b4c5d6e7f8091a2b3c4d5e6f7", name: "Éclair", in_use: false };
    const { user } = setup({ projects: [eclair] });
    await user.click(trigger());
    await user.type(search(), "éclair");
    expect(options()).toEqual(["Éclair", 'Create project "éclair"']);
  });

  it("offers no Create to a member without can.manage", async () => {
    const { user } = setup({ canCreate: false });
    await user.click(trigger());
    await user.type(search(), "Billing");
    expect(options()).toEqual([]);
    expect(screen.getByText("No projects match")).toBeInTheDocument();
  });

  it("offers no Create for an invalid name", async () => {
    const { user } = setup();
    await user.click(trigger());
    await user.type(search(), "a".repeat(65));
    expect(screen.getByText(RULE)).toBeInTheDocument();
    expect(screen.queryByText(/Create project/)).toBeNull();
  });

  it("a keyboard-only user creates a project", async () => {
    const { user, onCreate, onChange } = setup();
    trigger().focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(search()).toHaveFocus());
    await user.keyboard("Billing");
    await user.keyboard("{Enter}");

    expect(onCreate).toHaveBeenCalledWith("Billing");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("p9"));
    await waitFor(() => expect(trigger()).toHaveFocus());
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens with ArrowDown and picks with the arrows and Enter", async () => {
    const { user, onChange } = setup();
    trigger().focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(search()).toHaveFocus());
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith(MARKETING.id);
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("Escape closes the list and leaves the dialog open", async () => {
    const { user } = setup();
    await user.click(trigger());
    await waitFor(() => expect(search()).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Edit agent" })).toBeInTheDocument();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("shows the reason of a failed create and keeps the list open", async () => {
    const onCreate = vi.fn(async (): Promise<Project> => {
      throw new FabriumApiError(409, "name in use");
    });
    const { user } = setup({ onCreate });
    await user.click(trigger());
    await user.type(search(), "Billing");
    await user.click(screen.getByRole("option", { name: 'Create project "Billing"' }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A project with this name already exists.",
    );
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(search()).toHaveValue("Billing");
  });

  it("No project is disabled with noneDisabled", async () => {
    const { user, onChange } = setup({ initial: PAYMENTS.id, noneDisabled: true });
    await user.click(trigger());
    const none = screen.getByRole("option", { name: "No project" });
    expect(none).toHaveAttribute("aria-disabled", "true");
    // The keyboard skips it: Enter picks the first project that can be picked.
    fireEvent.click(none);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: "Marketing" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("shows the error for a value that the list lacks", () => {
    setup({ initial: "gone" });
    expect(screen.getByRole("alert")).toHaveTextContent(GONE);
    expect(trigger()).toHaveAccessibleDescription(GONE);
    expect(projectGone(PROJECTS, "gone")).toBe(true);
    expect(projectGone(PROJECTS, PAYMENTS.id)).toBe(false);
    expect(projectGone(PROJECTS, null)).toBe(false);
    expect(projectGone(null, "gone")).toBe(false);
  });

  it("shows the load error and disables the trigger", () => {
    setup({ projects: null, loadError: "boom" });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load the projects. boom");
    expect(trigger()).toBeDisabled();
  });

  it("renders the list inside the dialog, where the scroll lock of the dialog lets the wheel through", async () => {
    const { user } = setup();
    await user.click(trigger());
    const dialog = screen.getByRole("dialog", { name: "Edit agent" });
    expect(dialog).toContainElement(screen.getByRole("listbox"));
    expect(dialog).toContainElement(search());
  });

  it("works outside a dialog", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ProjectSelector
        id="project"
        projects={PROJECTS}
        loadError={null}
        value={null}
        onChange={onChange}
        canCreate={false}
        onCreate={vi.fn()}
      />,
    );
    await user.click(trigger());
    expect(screen.queryByRole("dialog", { name: "Edit agent" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "Payments" }));
    expect(onChange).toHaveBeenCalledWith(PAYMENTS.id);
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("ties the hint to the trigger", () => {
    setup({ hint: "This agent is in a project, so its VM must be in a project too." });
    expect(trigger()).toHaveAccessibleDescription(
      "This agent is in a project, so its VM must be in a project too.",
    );
  });
});
