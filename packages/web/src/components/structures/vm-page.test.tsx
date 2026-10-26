import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ComponentProps } from "react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mswServer } from "../../../test/setup";
import { signInForVmApi } from "../../../test/vm-api";
import { AGENTS, INSTANCE_TYPES, makeVm } from "../../../test/vm-fixtures";
import { MatrixClientPeg } from "../../client/peg";
import type { CreateVmRequest, Vm } from "../../model/types";
import { VmRoute } from "./vm-page";
import { VmView } from "./vm-view";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const API = "/_fabrium/v1";

const lima = makeVm();
const kilo = makeVm({
  id: "i-0123456789abcdef1",
  name: "kilo",
  state: "stopped",
  public_ip: null,
});
const oscar = makeVm({
  id: "i-0123456789abcdef2",
  name: "oscar",
  state: "pending",
  setup: "pending",
  public_ip: null,
  agent_id: null,
});
const papa = makeVm({
  id: "i-0123456789abcdef3",
  name: "papa",
  state: "stopping",
});
const tango = makeVm({
  id: "i-0123456789abcdef4",
  name: "tango",
  instance_type: "c6a.large",
  sev_snp: true,
  setup: "expired",
  agent_id: "@tango.echo:example.org",
});

const AFTER_ACTION = { start: "pending", stop: "stopping", reboot: "running" } as const;

/**
 * A fake control plane behind the browser API. `calls` records what reached
 * it, in order, and `created` holds the bodies of the creates.
 */
function serve(initial: Vm[]) {
  const cp = { vms: initial, calls: [] as string[], created: [] as CreateVmRequest[] };
  mswServer.use(
    http.get(`${API}/vms`, () => {
      cp.calls.push("GET /vms");
      return HttpResponse.json(cp.vms);
    }),
    http.get(`${API}/instance-types`, () => {
      cp.calls.push("GET /instance-types");
      return HttpResponse.json(INSTANCE_TYPES);
    }),
    http.get(`${API}/agents`, () => {
      cp.calls.push("GET /agents");
      return HttpResponse.json(AGENTS);
    }),
    http.post(`${API}/vms`, async ({ request }) => {
      const body = (await request.json()) as CreateVmRequest;
      cp.calls.push("POST /vms");
      cp.created.push(body);
      const vm = makeVm({
        id: "i-0123456789abcdef9",
        name: body.name,
        state: "pending",
        setup: "pending",
        public_ip: null,
        agent_id: `@${body.name}.${body.agent.name}:example.org`,
      });
      cp.vms = [...cp.vms, vm];
      return HttpResponse.json(vm, { status: 201 });
    }),
    http.post(`${API}/vms/:id/:verb`, ({ params }) => {
      const verb = params.verb as keyof typeof AFTER_ACTION;
      cp.calls.push(`POST ${params.id}/${verb}`);
      cp.vms = cp.vms.map((v) =>
        v.id === params.id ? { ...v, state: AFTER_ACTION[verb] } : v,
      );
      return HttpResponse.json(
        cp.vms.find((v) => v.id === params.id),
        { status: 202 },
      );
    }),
    http.delete(`${API}/vms/:id`, ({ params }) => {
      cp.calls.push(`DELETE ${params.id}`);
      cp.vms = cp.vms.map((v) =>
        v.id === params.id ? { ...v, state: "shutting-down" } : v,
      );
      return new HttpResponse(null, { status: 202 });
    }),
  );
  return cp;
}

function renderPage() {
  signInForVmApi();
  return render(<VmRoute />);
}

const rowOf = (name: string) =>
  screen.getByRole("rowheader", { name }).closest("tr") as HTMLElement;
const buttonsIn = (row: HTMLElement) =>
  within(row)
    .getAllByRole("button")
    .map((b) => b.textContent);

afterEach(() => {
  vi.clearAllMocks();
  MatrixClientPeg.reset();
});

describe("<VmRoute>", () => {
  it("lists name, agent, type, state, setup, IP, and launch date", async () => {
    serve([lima, oscar]);
    renderPage();
    expect(screen.getByText("Loading VMs…")).toBeInTheDocument();

    await screen.findByRole("rowheader", { name: "lima" });
    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent),
    ).toEqual(["Name", "Agent", "Type", "State", "IP", "Launched", "Actions"]);

    const running = within(rowOf("lima"));
    expect(running.getByText("@lima.echo:example.org")).toBeInTheDocument();
    expect(running.getByText("t3a.medium")).toBeInTheDocument();
    expect(running.getByText("running")).toBeInTheDocument();
    expect(running.getByText("Setup delivered")).toBeInTheDocument();
    expect(running.getByText("203.0.113.10")).toBeInTheDocument();
    const launched = rowOf("lima").querySelector("time");
    expect(launched).toHaveAttribute("datetime", "2026-10-26T19:00:00Z");
    expect(launched).toHaveTextContent("2026");

    const starting = within(rowOf("oscar"));
    expect(starting.getByText("pending")).toBeInTheDocument();
    expect(starting.getByText("Setup pending")).toBeInTheDocument();
    expect(starting.getAllByText("None")).toHaveLength(2); // no agent, no IP
  });

  it("marks only SEV-SNP types as Confidential, and flags an expired setup", async () => {
    serve([lima, tango]);
    renderPage();
    await screen.findByRole("rowheader", { name: "tango" });

    expect(within(rowOf("tango")).getByText("Confidential")).toBeInTheDocument();
    expect(
      within(rowOf("tango")).getByText(/Setup expired\. Delete this VM/),
    ).toBeInTheDocument();
    expect(within(rowOf("lima")).queryByText("Confidential")).toBeNull();
  });

  it.each([
    ["kilo", "stopped", ["Start", "Delete"]],
    ["lima", "running", ["Stop", "Reboot", "Delete"]],
    ["oscar", "pending", ["Delete"]],
    ["papa", "stopping", ["Delete"]],
  ])("offers actions by state: %s is %s", async (name, _state, buttons) => {
    serve([kilo, lima, oscar, papa]);
    renderPage();
    await screen.findByRole("rowheader", { name });
    expect(buttonsIn(rowOf(name))).toEqual(buttons);
  });

  it("runs an action, then shows the new state", async () => {
    const cp = serve([lima]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Stop lima" }));

    await waitFor(() =>
      expect(within(rowOf("lima")).getByText("stopping")).toBeInTheDocument(),
    );
    expect(cp.calls).toEqual(["GET /vms", `POST ${lima.id}/stop`, "GET /vms"]);
    expect(buttonsIn(rowOf("lima"))).toEqual(["Delete"]);
  });

  it("disables the buttons of a VM while its action runs", async () => {
    serve([lima]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mswServer.use(
      http.post(`${API}/vms/:id/reboot`, async () => {
        await gate;
        return HttpResponse.json(lima, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Reboot lima" }));
    for (const button of within(rowOf("lima")).getAllByRole("button")) {
      expect(button).toBeDisabled();
    }

    release();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reboot lima" })).toBeEnabled(),
    );
  });

  it("asks before deleting a VM", async () => {
    const cp = serve([lima]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Delete lima" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete lima?" });
    expect(cp.calls).toEqual(["GET /vms"]);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(cp.calls).toEqual(["GET /vms"]);

    await user.click(screen.getByRole("button", { name: "Delete lima" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() =>
      expect(within(rowOf("lima")).getByText("shutting-down")).toBeInTheDocument(),
    );
    expect(cp.calls).toEqual(["GET /vms", `DELETE ${lima.id}`, "GET /vms"]);
  });

  it("shows a toast when an action fails, then refreshes the list", async () => {
    const cp = serve([lima]);
    mswServer.use(
      http.post(`${API}/vms/:id/stop`, () =>
        HttpResponse.json({ error: "vm is stopped" }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Stop lima" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/stop lima.*vm is stopped/i),
      ),
    );
    await waitFor(() => expect(cp.calls).toEqual(["GET /vms", "GET /vms"]));
    expect(screen.getByRole("button", { name: "Stop lima" })).toBeEnabled();
  });

  it.each([403, 404])("shows the no-access state on %i", async (status) => {
    mswServer.use(
      http.get(`${API}/vms`, () =>
        HttpResponse.json({ error: "forbidden" }, { status }),
      ),
    );
    renderPage();

    expect(await screen.findByText("No access")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: /new vm/i })).toBeNull();
  });

  it.each([
    [
      "an error answer",
      () => HttpResponse.json({ error: "control plane unreachable" }, { status: 502 }),
      /control plane unreachable/,
    ],
    [
      "a 200 that is not JSON",
      () =>
        new HttpResponse("<!doctype html><html></html>", {
          headers: { "content-type": "text/html" },
        }),
      /unexpected response/i,
    ],
  ])("shows an error, and Retry loads again, after %s", async (_, failing, message) => {
    mswServer.use(http.get(`${API}/vms`, failing));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("table")).toBeNull();

    serve([lima]);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("rowheader", { name: "lima" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the empty state when there are no VMs", async () => {
    serve([]);
    renderPage();
    expect(await screen.findByText("No VMs yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  describe("New VM dialog", () => {
    /** Opens the dialog and waits until its options have loaded. */
    async function openDialog(user: ReturnType<typeof userEvent.setup>) {
      await user.click(await screen.findByRole("button", { name: "New VM" }));
      const dialog = await screen.findByRole("dialog", { name: "New VM" });
      return dialog;
    }
    const fill = async (
      user: ReturnType<typeof userEvent.setup>,
      dialog: HTMLElement,
    ) => {
      await user.type(within(dialog).getByLabelText(/^vm name/i), "kilo");
      await user.type(within(dialog).getByLabelText(/^agent name/i), "scout");
      await user.type(within(dialog).getByLabelText(/haven api key/i), "hk-1");
    };

    it("creates the VM, closes, and refreshes the list", async () => {
      const cp = serve([lima]);
      const user = userEvent.setup();
      renderPage();

      const dialog = await openDialog(user);
      await within(dialog).findByLabelText("Instance type");
      await fill(user, dialog);
      await user.click(within(dialog).getByRole("button", { name: "Create VM" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(await screen.findByRole("rowheader", { name: "kilo" })).toBeInTheDocument();
      expect(cp.created).toStrictEqual([
        {
          name: "kilo",
          instance_type: "t3a.medium",
          agent: { mode: "new", name: "scout" },
          haven_api_key: "hk-1",
        },
      ]);
      expect(cp.calls.slice(-2)).toEqual(["POST /vms", "GET /vms"]);
    });

    it("loads the instance types and agents each time it opens", async () => {
      const cp = serve([lima]);
      const user = userEvent.setup();
      renderPage();

      const dialog = await openDialog(user);
      await within(dialog).findByLabelText("Instance type");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await within(await openDialog(user)).findByLabelText("Instance type");

      expect(cp.calls.filter((c) => c === "GET /agents")).toHaveLength(2);
      expect(cp.calls.filter((c) => c === "GET /instance-types")).toHaveLength(2);
    });

    it("shows a failed create inline with its step, and stays open", async () => {
      serve([lima]);
      mswServer.use(
        http.post(`${API}/vms`, () =>
          HttpResponse.json(
            { error: "could not register the agent", step: "register_appservice" },
            { status: 502 },
          ),
        ),
      );
      const user = userEvent.setup();
      renderPage();

      const dialog = await openDialog(user);
      await within(dialog).findByLabelText("Instance type");
      await fill(user, dialog);
      await user.click(within(dialog).getByRole("button", { name: "Create VM" }));

      const alert = await within(dialog).findByRole("alert");
      expect(alert).toHaveTextContent("could not register the agent");
      expect(alert).toHaveTextContent("register_appservice");
      expect(screen.getByRole("dialog", { name: "New VM" })).toBeInTheDocument();
    });

    it("shows why the options did not load", async () => {
      serve([lima]);
      mswServer.use(
        http.get(`${API}/instance-types`, () =>
          HttpResponse.json({ error: "control plane unreachable" }, { status: 502 }),
        ),
      );
      const user = userEvent.setup();
      renderPage();

      const dialog = await openDialog(user);
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "control plane unreachable",
      );
      expect(within(dialog).getByRole("button", { name: "Create VM" })).toBeDisabled();
    });
  });
});

describe("<VmView>", () => {
  const view = (over: Partial<ComponentProps<typeof VmView>> = {}) => (
    <VmView
      vms={[lima]}
      error={null}
      noAccess={false}
      busyIds={new Set()}
      onAction={() => {}}
      onRetry={() => {}}
      {...over}
    />
  );

  it("closes the delete confirmation when the VM leaves the list", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(view({ onAction }));
    await user.click(screen.getByRole("button", { name: "Delete lima" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();

    rerender(view({ vms: [], onAction }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    // The same VM coming back must not bring the stale confirmation with it.
    rerender(view({ vms: [lima], onAction }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("disables only the buttons of a VM with an action in flight", () => {
    render(view({ vms: [lima, kilo], busyIds: new Set([lima.id]) }));
    for (const button of within(rowOf("lima")).getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
    for (const button of within(rowOf("kilo")).getAllByRole("button")) {
      expect(button).toBeEnabled();
    }
  });

  it("keeps the list and shows an error when a refresh fails", () => {
    render(view({ error: "control plane unreachable" }));
    expect(screen.getByRole("rowheader", { name: "lima" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("control plane unreachable");
  });

  it("shows a launch time it cannot parse as it is", () => {
    render(view({ vms: [makeVm({ launched_at: "yesterday" })] }));
    expect(screen.getByText("yesterday")).toBeInTheDocument();
  });

  it("offers New VM only when it can open the dialog", async () => {
    const onNew = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(view());
    expect(screen.queryByRole("button", { name: "New VM" })).toBeNull();

    rerender(view({ onNew }));
    await user.click(screen.getByRole("button", { name: "New VM" }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});
