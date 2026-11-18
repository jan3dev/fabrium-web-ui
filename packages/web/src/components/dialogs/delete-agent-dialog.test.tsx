import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { CAN_NOTHING, PROFILE, makeAgent } from "../../../test/vm-fixtures";
import { FabriumApiError } from "../../client/fabrium-api";
import { DeleteAgentDialog } from "./delete-agent-dialog";

type Props = ComponentProps<typeof DeleteAgentDialog>;

const LAST = makeAgent();
const SIBLING = makeAgent({ can: { ...CAN_NOTHING, edit: true, delete: true } });

function setup({ onConfirm = vi.fn(async (_withVm: boolean) => {}), ...over }: Partial<Props> = {}) {
  const onOpenChange = vi.fn();
  const props: Props = { open: true, onOpenChange, agent: SIBLING, onConfirm, ...over };
  const view = render(<DeleteAgentDialog {...props} />);
  return {
    onConfirm: vi.mocked(onConfirm),
    onOpenChange,
    user: userEvent.setup(),
    rerender: (next: Partial<Props>) => view.rerender(<DeleteAgentDialog {...props} {...next} />),
  };
}

describe("<DeleteAgentDialog>", () => {
  it.each([
    [
      "profile",
      PROFILE,
      "Delete scout?",
      "This deletes the profile. It has no VM and no Matrix user.",
      "Delete agent",
    ],
    [
      "last agent of a live VM",
      LAST,
      "Delete echo?",
      "echo is the last agent of the VM lima. This deletes the agent and the VM. The files on the VM are lost.",
      "Delete agent and VM",
    ],
    [
      "agent with siblings",
      SIBLING,
      "Delete echo?",
      "The agent leaves its rooms. Its messages stay.",
      "Delete agent",
    ],
  ])("shows the text for a %s", (_, agent, title, text, confirm) => {
    setup({ agent });
    const dialog = screen.getByRole("alertdialog", { name: title });
    expect(dialog).toHaveAccessibleDescription(text);
    expect(screen.getByRole("button", { name: confirm })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("confirms with withVm only for the last agent of a live VM", async () => {
    const first = setup({ agent: LAST });
    await first.user.click(screen.getByRole("button", { name: "Delete agent and VM" }));
    expect(first.onConfirm.mock.calls).toEqual([[true]]);
    await waitFor(() => expect(first.onOpenChange).toHaveBeenCalledWith(false));
    first.rerender({ open: false });

    const second = setup({ agent: SIBLING });
    await second.user.click(screen.getByRole("button", { name: "Delete agent" }));
    expect(second.onConfirm.mock.calls).toEqual([[false]]);
  });

  it("shows the error of a 409 and stays open", async () => {
    const onConfirm = vi
      .fn<(withVm: boolean) => Promise<void>>()
      .mockRejectedValueOnce(new FabriumApiError(409, "last agent of the vm"));
    const { user, onOpenChange } = setup({ onConfirm });
    await user.click(screen.getByRole("button", { name: "Delete agent" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("last agent of the vm");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("follows a refreshed agent and keeps the error, so the retry has the right text", async () => {
    const onConfirm = vi
      .fn<(withVm: boolean) => Promise<void>>()
      .mockRejectedValueOnce(new FabriumApiError(409, "last agent of the vm"))
      .mockResolvedValue(undefined);
    const { user, rerender } = setup({ onConfirm });
    await user.click(screen.getByRole("button", { name: "Delete agent" }));
    await screen.findByRole("alert");

    rerender({ agent: LAST });
    expect(screen.getByRole("alert")).toHaveTextContent("last agent of the vm");
    expect(screen.getByRole("alertdialog")).toHaveAccessibleDescription(
      /echo is the last agent of the VM lima/,
    );
    await user.click(screen.getByRole("button", { name: "Delete agent and VM" }));
    expect(onConfirm.mock.calls).toEqual([[false], [true]]);
  });

  it("the submit button is disabled while the request runs", async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user, onOpenChange } = setup({ onConfirm });
    await user.click(screen.getByRole("button", { name: "Delete agent" }));

    expect(screen.getByRole("button", { name: "Delete agent" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Delete agent" }));
    await user.keyboard("{Escape}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    finish();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("Cancel closes without a request", async () => {
    const { user, onConfirm, onOpenChange } = setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
