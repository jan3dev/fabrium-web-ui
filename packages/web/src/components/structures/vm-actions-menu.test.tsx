import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { VmState } from "../../model/types";
import { VmActionsMenu } from "./vm-actions-menu";

const trigger = (name = "lima") =>
  screen.getByRole("button", { name: `Actions for ${name}` });
const labels = () => screen.getAllByRole("menuitem").map((item) => item.textContent);

/** The tests of the state table: a caller who may not move the VM to a project. */
const NO_PROJECT = { set_project: false };

function setup(state: VmState = "running", busy = false, can = NO_PROJECT) {
  const onSelect = vi.fn();
  const user = userEvent.setup();
  const view = render(
    <VmActionsMenu vm={{ name: "lima", state, can }} busy={busy} onSelect={onSelect} />,
  );
  return { onSelect, user, ...view };
}

describe("<VmActionsMenu>", () => {
  it.each<[VmState, string[]]>([
    ["stopped", ["Start", "Update credentials", "Delete"]],
    ["running", ["Stop", "Reboot", "Update credentials", "Delete"]],
    ["pending", ["Update credentials", "Delete"]],
    ["stopping", ["Update credentials", "Delete"]],
    ["shutting-down", ["Update credentials", "Delete"]],
  ])("offers the actions of the %s state", async (state, expected) => {
    const { user } = setup(state);
    await user.click(trigger());
    expect(labels()).toEqual(expected);
  });

  it("falls back to Update credentials and Delete for a state it does not know", async () => {
    const { user } = setup("terminated" as VmState);
    await user.click(trigger());
    expect(labels()).toEqual(["Update credentials", "Delete"]);
  });

  it("puts Delete last, after a separator, in the danger tone", async () => {
    const { user } = setup("running");
    await user.click(trigger());
    const items = screen.getAllByRole("menuitem");
    const last = items.at(-1);
    expect(last).toHaveTextContent("Delete");
    expect(last).toHaveAttribute("data-variant", "destructive");
    expect(screen.getByRole("separator").nextElementSibling).toBe(last);
    for (const item of items.slice(0, -1)) {
      expect(item).not.toHaveAttribute("data-variant", "destructive");
    }
  });

  it("names the trigger after the VM", async () => {
    const user = userEvent.setup();
    render(
      <>
        <VmActionsMenu vm={{ name: "lima", state: "running", can: NO_PROJECT }} busy={false} onSelect={() => {}} />
        <VmActionsMenu vm={{ name: "kilo", state: "stopped", can: NO_PROJECT }} busy={false} onSelect={() => {}} />
      </>,
    );
    expect(trigger("lima")).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger("lima")).toHaveAttribute("aria-expanded", "false");
    expect(trigger("kilo")).not.toBe(trigger("lima"));

    await user.click(trigger("lima"));
    expect(trigger("lima")).toHaveAttribute("aria-expanded", "true");
  });

  it("calls onSelect with the action, and closes", async () => {
    const { onSelect, user } = setup("running");
    await user.click(trigger());
    await user.click(screen.getByRole("menuitem", { name: "Reboot" }));
    expect(onSelect).toHaveBeenCalledWith("reboot");
    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("is operable with the keyboard", async () => {
    const { onSelect, user } = setup("running");
    await user.tab();
    expect(trigger()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    // Stop is first and has the focus: one step down is Reboot.
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith("reboot");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it.each<VmState>(["stopped", "running", "pending", "stopping", "shutting-down"])(
    "offers Move to project in %s with can.set_project",
    async (state) => {
      const { user } = setup(state, false, { set_project: true });
      await user.click(trigger());
      expect(labels()).toContain("Move to project");
    },
  );

  it("hides Move to project without can.set_project", async () => {
    const { user } = setup("running");
    await user.click(trigger());
    expect(labels()).not.toContain("Move to project");
  });

  it("has Move to project after Update credentials, and Delete last", async () => {
    const { user, onSelect } = setup("stopped", false, { set_project: true });
    await user.click(trigger());
    expect(labels()).toEqual(["Start", "Update credentials", "Move to project", "Delete"]);
    expect(screen.getByRole("separator").nextElementSibling).toHaveTextContent("Delete");
    await user.click(screen.getByRole("menuitem", { name: "Move to project" }));
    expect(onSelect).toHaveBeenCalledWith("project");
  });

  it("disables the trigger while busy", () => {
    render(
      <>
        <VmActionsMenu vm={{ name: "lima", state: "running", can: NO_PROJECT }} busy onSelect={() => {}} />
        <VmActionsMenu vm={{ name: "kilo", state: "stopped", can: NO_PROJECT }} busy={false} onSelect={() => {}} />
      </>,
    );
    expect(trigger("lima")).toBeDisabled();
    expect(trigger("kilo")).toBeEnabled();
  });

  it("does not select while busy after it was open", async () => {
    const { onSelect, user, rerender } = setup("running");
    await user.click(trigger());
    rerender(
      <VmActionsMenu vm={{ name: "lima", state: "running", can: NO_PROJECT }} busy onSelect={onSelect} />,
    );
    await user.click(screen.getByRole("menuitem", { name: "Stop" }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
