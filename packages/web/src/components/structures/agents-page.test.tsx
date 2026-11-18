import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { mswServer } from "../../../test/setup";
import { signInForVmApi } from "../../../test/vm-api";
import {
  CAN_NOTHING,
  INSTANCE_AGENT,
  PROFILE,
  VM_GONE,
  makeAgent,
} from "../../../test/vm-fixtures";
import { MatrixClientPeg } from "../../client/peg";
import type { Agent, AgentList } from "../../model/types";
import { AgentsRoute } from "./agents-page";

const API = "/_fabrium/v1";

/** A fake browser API: `GET /agents` answers `list`; `calls` records each request, with its body. */
function serve(agents: Agent[], vms: AgentList["vms"] = [{ name: "lima", state: "running" }]) {
  const api = { list: { agents, vms } as AgentList, calls: [] as string[] };
  const record = async (request: Request, line: string) => {
    const body = await request.text();
    api.calls.push(body ? `${line} ${body}` : line);
  };
  mswServer.use(
    http.get(`${API}/agents`, () => {
      api.calls.push("GET /agents");
      return HttpResponse.json(api.list);
    }),
    http.get(`${API}/models`, () =>
      HttpResponse.json({ models: [{ id: "glm-5-3" }], default: "glm-5-3" }),
    ),
    http.post(`${API}/agents`, async ({ request }) => {
      await record(request, "POST /agents");
      const created = makeAgent({ ...PROFILE, id: "0f1e2d3c4b5a69788796a5b4c3d2e1f0", name: "nova" });
      api.list = { ...api.list, agents: [...api.list.agents, created] };
      return HttpResponse.json(created, { status: 201 });
    }),
    http.put(`${API}/agents/:id`, async ({ params, request }) => {
      await record(request, `PUT ${params.id}`);
      return HttpResponse.json(api.list.agents.find((a) => a.id === params.id));
    }),
  );
  return api;
}

function renderPage() {
  signInForVmApi();
  return render(<AgentsRoute />);
}

/** The row of the agent named `name`: its header cell holds the name and the Matrix ID. */
const rowOf = (name: string) =>
  screen.getByRole("rowheader", { name: new RegExp(`^${name}`) }).closest("tr") as HTMLElement;
const buttonsIn = (row: HTMLElement) =>
  within(row)
    .queryAllByRole("button")
    .map((b) => b.textContent);

afterEach(() => MatrixClientPeg.reset());

describe("<AgentsRoute>", () => {
  it("shows a row for an agent on a VM", async () => {
    serve([makeAgent()]);
    renderPage();
    expect(screen.getByText("Loading agents…")).toBeInTheDocument();
    await screen.findByRole("rowheader", { name: /^echo/ });

    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name",
      "Owner",
      "Tag",
      "Project",
      "Model",
      "VM",
      "Actions",
    ]);
    const row = within(rowOf("echo"));
    for (const text of [
      "@lima.echo:example.org",
      "@ann:example.org",
      "Reviewer",
      "Payments",
      "glm-5-3",
      "lima",
      "running",
    ]) {
      expect(row.getByText(text)).toBeInTheDocument();
    }
  });

  it("shows No VM for a profile", async () => {
    serve([PROFILE]);
    renderPage();
    await screen.findByRole("rowheader", { name: /^scout/ });
    expect(within(rowOf("scout")).getByText("No VM")).toBeInTheDocument();
  });

  it("shows the VM name and No VM running for an agent whose VM is gone", async () => {
    serve([VM_GONE]);
    renderPage();
    await screen.findByRole("rowheader", { name: /^review/ });
    const row = within(rowOf("review"));
    expect(row.getByText("kilo")).toBeInTheDocument();
    expect(row.getByText("No VM running")).toBeInTheDocument();
  });

  it("shows the instance badge and no action for an instance agent", async () => {
    serve([INSTANCE_AGENT]);
    renderPage();
    await screen.findByRole("rowheader", { name: /^zooid/ });
    expect(within(rowOf("zooid")).getByText("Runs on the instance")).toBeInTheDocument();
    expect(buttonsIn(rowOf("zooid"))).toEqual([]);
  });

  it("shows only the actions that can allows", async () => {
    serve([
      makeAgent({ can: { ...CAN_NOTHING, edit: true } }),
      makeAgent({ id: "8c3f5a0d2e6b7f4a1d9c3b5e7a9f1d3c", name: "quiet", can: CAN_NOTHING }),
      makeAgent({ id: "9d4a6b1e3f7c8a5b2e0d4c6f8b0a2e4d", name: "full" }),
    ]);
    renderPage();
    await screen.findByRole("rowheader", { name: /^echo/ });
    expect(buttonsIn(rowOf("echo"))).toEqual(["Edit"]);
    expect(buttonsIn(rowOf("quiet"))).toEqual([]);
    expect(buttonsIn(rowOf("full"))).toEqual(["Edit", "Delete"]);
  });

  it("shows Create VM disabled with the reason for an agents-manager", async () => {
    serve([PROFILE]);
    renderPage();
    await screen.findByRole("rowheader", { name: /^scout/ });
    const create = within(rowOf("scout")).getByRole("button", { name: "Create VM for scout" });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute("title", "Only a VM creator or an admin can create a VM.");
    expect(buttonsIn(rowOf("scout"))).toEqual(["Edit", "Create VM", "Delete"]);
  });

  it("shows Create VM enabled when can.create_vm is set", async () => {
    serve([VM_GONE]);
    renderPage();
    await screen.findByRole("rowheader", { name: /^review/ });
    const create = within(rowOf("review")).getByRole("button", { name: "Create VM for review" });
    expect(create).toBeEnabled();
    expect(create).not.toHaveAttribute("title");
  });

  it("shows no Create VM for an agent with a live VM", async () => {
    serve([makeAgent({ can: { ...CAN_NOTHING, edit: true, create_vm: true } })]);
    renderPage();
    await screen.findByRole("rowheader", { name: /^echo/ });
    expect(within(rowOf("echo")).queryByRole("button", { name: /create vm/i })).toBeNull();
  });

  it("creates a profile from New agent, closes, and refreshes the list", async () => {
    const api = serve([makeAgent()]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("rowheader", { name: /^echo/ });

    await user.click(screen.getByRole("button", { name: "New agent" }));
    const dialog = await screen.findByRole("dialog", { name: "New agent" });
    await waitFor(() => expect(within(dialog).getByLabelText("Model")).toHaveValue("glm-5-3"));
    await user.type(within(dialog).getByLabelText("Name"), "nova");
    await user.click(within(dialog).getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("rowheader", { name: /^nova/ })).toBeInTheDocument();
    expect(api.calls).toEqual([
      "GET /agents",
      'POST /agents {"name":"nova","model":"glm-5-3"}',
      "GET /agents",
    ]);
  });

  it("edits an agent with the fields that changed", async () => {
    const api = serve([makeAgent()]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Edit echo" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit agent" });
    await user.clear(within(dialog).getByLabelText("Tag"));
    await user.type(within(dialog).getByLabelText("Tag"), "Lead");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls).toEqual([
      "GET /agents",
      `PUT ${makeAgent().id} {"tag":"Lead"}`,
      "GET /agents",
    ]);
  });

  it("shows the empty state", async () => {
    serve([], []);
    renderPage();
    expect(await screen.findByText("No agents yet")).toBeInTheDocument();
    expect(screen.getByText("Create a profile first. It gets a VM later.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New agent" })).toBeInTheDocument();
  });

  it.each([403, 404])("shows the no-access notice on a %i", async (status) => {
    mswServer.use(
      http.get(`${API}/agents`, () => HttpResponse.json({ error: "forbidden" }, { status })),
    );
    renderPage();
    expect(await screen.findByText("No access")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "New agent" })).toBeNull();
  });

  it("shows the error and a retry on a 502", async () => {
    mswServer.use(
      http.get(`${API}/agents`, () =>
        HttpResponse.json({ error: "control plane unreachable" }, { status: 502 }),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(/control plane unreachable/);
    expect(screen.queryByRole("table")).toBeNull();

    serve([makeAgent()]);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("rowheader", { name: /^echo/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
