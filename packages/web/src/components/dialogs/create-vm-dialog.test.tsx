import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { INSTANCE_TYPES, PROFILE, VM_GONE } from "../../../test/vm-fixtures";
import { FabriumApiError } from "../../client/fabrium-api";
import type { CreateVmRequest } from "../../model/types";
import { CreateVmDialog } from "./create-vm-dialog";

type Props = ComponentProps<typeof CreateVmDialog>;

function setup({
  onSubmit = vi.fn(async (_req: CreateVmRequest) => {}),
  ...over
}: Partial<Props> = {}) {
  const onOpenChange = vi.fn();
  const props: Props = {
    open: true,
    onOpenChange,
    agent: PROFILE,
    types: INSTANCE_TYPES,
    typesError: null,
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
          agent: PROFILE.id,
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
          agent: PROFILE.id,
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
});
