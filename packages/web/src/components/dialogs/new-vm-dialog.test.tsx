import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { AGENTS, INSTANCE_TYPES } from "../../../test/vm-fixtures";
import { FabriumApiError } from "../../client/fabrium-api";
import type { CreateVmRequest } from "../../model/types";
import { NewVmDialog } from "./new-vm-dialog";

type Props = ComponentProps<typeof NewVmDialog>;

const OPTIONS = { instanceTypes: INSTANCE_TYPES, agents: AGENTS };

function setup({
  onSubmit = vi.fn(async (_req: CreateVmRequest) => {}),
  ...over
}: Partial<Props> = {}) {
  const onOpenChange = vi.fn();
  const props: Props = {
    open: true,
    onOpenChange,
    options: OPTIONS,
    optionsError: null,
    onSubmit,
    ...over,
  };
  const view = render(<NewVmDialog {...props} />);
  return {
    onSubmit: vi.mocked(onSubmit),
    onOpenChange,
    user: userEvent.setup(),
    rerender: (next: Partial<Props>) =>
      view.rerender(<NewVmDialog {...props} {...next} />),
  };
}

const create = () => screen.getByRole("button", { name: /^creat/i });
const optionTexts = (select: HTMLElement) =>
  within(select)
    .getAllByRole("option")
    .map((o) => o.textContent);

describe("<NewVmDialog>", () => {
  it("starts in New mode with VM name, agent name, persona, and project", () => {
    setup();
    for (const label of [/^vm name/i, /^agent name/i, /persona/i, /project/i]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText("Agent")).toBeNull();
  });

  it("lists free agents only in Existing mode, and hides the name fields", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Existing agent" }));

    expect(optionTexts(screen.getByLabelText("Agent"))).toEqual([
      "Select an agent",
      "@nova.echo:example.org",
      "@orion.scout:example.org",
    ]);
    expect(screen.queryByLabelText(/^vm name/i)).toBeNull();
    expect(screen.queryByLabelText(/^agent name/i)).toBeNull();
  });

  it("preselects the default instance type and marks SEV-SNP types as Confidential", () => {
    setup();
    const select = screen.getByLabelText("Instance type");
    expect(select).toHaveValue("t3a.medium");
    expect(optionTexts(select)).toEqual([
      "t3a.medium · 2 vCPU · 4 GiB",
      "t3a.large · 2 vCPU · 8 GiB",
      "c6a.large · 2 vCPU · 4 GiB · Confidential",
    ]);
  });

  it("keeps Create disabled until the required fields are set", async () => {
    const { user } = setup();
    expect(create()).toBeDisabled();
    await user.type(screen.getByLabelText(/^vm name/i), "lima");
    await user.type(screen.getByLabelText(/^agent name/i), "echo");
    expect(create()).toBeDisabled();
    await user.type(screen.getByLabelText(/haven api key/i), "hk-1");
    expect(create()).toBeEnabled();

    await user.clear(screen.getByLabelText(/^vm name/i));
    expect(create()).toBeDisabled();
  });

  it("needs an agent and the key in Existing mode", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Existing agent" }));
    await user.type(screen.getByLabelText(/haven api key/i), "hk-1");
    expect(create()).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Agent"), "nova");
    expect(create()).toBeEnabled();
    expect(screen.getByText("The VM is named nova.")).toBeInTheDocument();
  });

  it("sends the new-agent request", async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByLabelText(/^vm name/i), "lima");
    await user.type(screen.getByLabelText(/^agent name/i), "echo");
    await user.type(screen.getByLabelText(/persona/i), "Reviewer");
    await user.type(screen.getByLabelText(/project/i), "Fabrium");
    await user.type(screen.getByLabelText(/haven api key/i), "hk-1");
    await user.type(screen.getByLabelText(/github token/i), "gh-1");
    await user.click(create());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]).toStrictEqual([
      {
        name: "lima",
        instance_type: "t3a.medium",
        agent: { mode: "new", name: "echo", persona: "Reviewer", project: "Fabrium" },
        haven_api_key: "hk-1",
        github_token: "gh-1",
      },
    ]);
  });

  it("leaves out the optional fields that are empty, and trims what it sends", async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByLabelText(/^vm name/i), " lima ");
    await user.type(screen.getByLabelText(/^agent name/i), " echo ");
    await user.type(screen.getByLabelText(/persona/i), "   ");
    await user.type(screen.getByLabelText(/haven api key/i), " hk-1 ");
    await user.type(screen.getByLabelText(/github token/i), " ");
    await user.selectOptions(screen.getByLabelText("Instance type"), "c6a.large");
    await user.click(create());

    expect(onSubmit.mock.calls[0]).toStrictEqual([
      {
        name: "lima",
        instance_type: "c6a.large",
        agent: { mode: "new", name: "echo" },
        haven_api_key: "hk-1",
      },
    ]);
  });

  it("sends the existing-agent request, named after its workstation", async () => {
    const { user, onSubmit } = setup();
    await user.click(screen.getByRole("button", { name: "Existing agent" }));
    await user.selectOptions(screen.getByLabelText("Agent"), "orion");
    await user.type(screen.getByLabelText(/haven api key/i), "hk-1");
    await user.click(create());

    expect(onSubmit.mock.calls[0]).toStrictEqual([
      {
        name: "orion",
        instance_type: "t3a.medium",
        agent: { mode: "existing", name: "orion" },
        haven_api_key: "hk-1",
      },
    ]);
  });

  it("takes both secrets in password inputs", () => {
    setup();
    expect(screen.getByLabelText(/haven api key/i)).toHaveAttribute("type", "password");
    expect(screen.getByLabelText(/github token/i)).toHaveAttribute("type", "password");
  });

  it("stays open and disabled while creating", async () => {
    let finish!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user, onOpenChange } = setup({ onSubmit });
    await user.type(screen.getByLabelText(/^vm name/i), "lima");
    await user.type(screen.getByLabelText(/^agent name/i), "echo");
    await user.type(screen.getByLabelText(/haven api key/i), "hk-1");
    await user.click(create());

    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    expect(screen.getByLabelText(/^vm name/i)).toBeDisabled();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Creating…" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    finish();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("closes on request when nothing is being created", async () => {
    const { user, onOpenChange } = setup();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows a failure inline with its step, keeps the values, and sends the same body on retry", async () => {
    const onSubmit = vi
      .fn<(req: CreateVmRequest) => Promise<void>>()
      .mockRejectedValueOnce(
        new FabriumApiError(502, "could not register the agent", "register_appservice"),
      )
      .mockResolvedValue(undefined);
    const { user, onOpenChange } = setup({ onSubmit });
    await user.type(screen.getByLabelText(/^vm name/i), "lima");
    await user.type(screen.getByLabelText(/^agent name/i), "echo");
    await user.type(screen.getByLabelText(/haven api key/i), "hk-1");
    await user.click(create());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("could not register the agent");
    expect(alert).toHaveTextContent("register_appservice");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^vm name/i)).toHaveValue("lima");
    expect(screen.getByLabelText(/haven api key/i)).toHaveValue("hk-1");

    await user.click(create());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1]).toStrictEqual(onSubmit.mock.calls[0]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears both secrets after a successful create, even when the parent keeps the dialog open", async () => {
    const { user, onOpenChange } = setup();
    await user.type(screen.getByLabelText(/^vm name/i), "lima");
    await user.type(screen.getByLabelText(/^agent name/i), "echo");
    await user.type(screen.getByLabelText(/haven api key/i), "hk-1");
    await user.type(screen.getByLabelText(/github token/i), "gh-1");
    await user.click(create());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.getByLabelText(/haven api key/i)).toHaveValue("");
    expect(screen.getByLabelText(/github token/i)).toHaveValue("");
    expect(screen.getByLabelText(/^vm name/i)).toHaveValue("");
  });

  it("clears both secrets when the dialog is closed and opened again", async () => {
    const { user, rerender } = setup();
    await user.type(screen.getByLabelText(/haven api key/i), "hk-1");
    await user.type(screen.getByLabelText(/github token/i), "gh-1");

    rerender({ open: false });
    rerender({ open: true });
    expect(screen.getByLabelText(/haven api key/i)).toHaveValue("");
    expect(screen.getByLabelText(/github token/i)).toHaveValue("");
  });

  it("says so, and keeps Create disabled, when no agent is free", async () => {
    const taken = AGENTS.map((a) => ({ ...a, free: false }));
    const { user } = setup({ options: { instanceTypes: INSTANCE_TYPES, agents: taken } });
    await user.click(screen.getByRole("button", { name: "Existing agent" }));
    await user.type(screen.getByLabelText(/haven api key/i), "hk-1");

    expect(screen.getByText("No agent is free. Create a new agent instead.")).toBeInTheDocument();
    expect(create()).toBeDisabled();
  });

  it("shows why the options did not load, and keeps Create disabled", async () => {
    const { user } = setup({ options: null, optionsError: "control plane unreachable" });
    await user.type(screen.getByLabelText(/^vm name/i), "lima");
    await user.type(screen.getByLabelText(/^agent name/i), "echo");
    await user.type(screen.getByLabelText(/haven api key/i), "hk-1");

    expect(screen.getByRole("alert")).toHaveTextContent("control plane unreachable");
    expect(create()).toBeDisabled();
  });

  it("shows a loading line, and keeps Create disabled, while the options load", async () => {
    const { user } = setup({ options: null });
    await user.type(screen.getByLabelText(/^vm name/i), "lima");
    await user.type(screen.getByLabelText(/^agent name/i), "echo");
    await user.type(screen.getByLabelText(/haven api key/i), "hk-1");

    expect(screen.getByText("Loading options…")).toBeInTheDocument();
    expect(create()).toBeDisabled();
  });
});
