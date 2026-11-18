import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { makeVm } from "../../../test/vm-fixtures";
import { FabriumApiError } from "../../client/fabrium-api";
import type { VmCredentials } from "../../model/types";
import { UpdateCredentialsDialog } from "./update-credentials-dialog";

type Props = ComponentProps<typeof UpdateCredentialsDialog>;

function setup({
  onSubmit = vi.fn(async (_creds: VmCredentials) => {}),
  ...over
}: Partial<Props> = {}) {
  const onOpenChange = vi.fn();
  const props: Props = { open: true, onOpenChange, vm: makeVm(), onSubmit, ...over };
  const view = render(<UpdateCredentialsDialog {...props} />);
  return {
    onSubmit: vi.mocked(onSubmit),
    onOpenChange,
    user: userEvent.setup(),
    rerender: (next: Partial<Props>) =>
      view.rerender(<UpdateCredentialsDialog {...props} {...next} />),
  };
}

const replace = () => screen.getByRole("button", { name: "Replace VM" });
const field = (label: string) => screen.getByLabelText(label);

describe("<UpdateCredentialsDialog>", () => {
  it("shows the warning", () => {
    setup();
    expect(
      screen.getByRole("dialog", { name: "Update the credentials of lima" }),
    ).toHaveAccessibleDescription(
      "This deletes the VM and creates it again with the same name. The files on the VM are lost. Every agent of the VM stops until the new VM is ready.",
    );
  });

  it("needs the Haven API key", async () => {
    const { user } = setup();
    expect(replace()).toBeDisabled();
    await user.type(field("GitHub token"), "gh-1");
    expect(replace()).toBeDisabled();
    await user.type(field("Haven API key"), "hk-1");
    expect(replace()).toBeEnabled();
  });

  it("sends both credentials, and no GitHub token when it is empty", async () => {
    const { user, onSubmit, onOpenChange } = setup();
    await user.type(field("Haven API key"), " hk-1 ");
    await user.click(replace());
    expect(onSubmit.mock.calls).toStrictEqual([[{ haven_api_key: "hk-1" }]]);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
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
    await user.type(field("Haven API key"), "hk-1");
    await user.type(field("GitHub token"), "gh-1");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender({ open: true });
    expect(field("Haven API key")).toHaveValue("");
    expect(field("GitHub token")).toHaveValue("");
  });

  it("the submit button is disabled while the request runs", async () => {
    let finish!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user, onOpenChange } = setup({ onSubmit });
    await user.type(field("Haven API key"), "hk-1");
    await user.click(replace());

    expect(replace()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.click(replace());
    await user.keyboard("{Escape}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    finish();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("shows the error of a failed request and stays open", async () => {
    const onSubmit = vi
      .fn<(creds: VmCredentials) => Promise<void>>()
      .mockRejectedValueOnce(new FabriumApiError(409, "the vm has no bundle"));
    const { user, onOpenChange } = setup({ onSubmit });
    await user.type(field("Haven API key"), "hk-1");
    await user.click(replace());

    expect(await screen.findByRole("alert")).toHaveTextContent("the vm has no bundle");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(replace()).toBeEnabled();
  });
});
