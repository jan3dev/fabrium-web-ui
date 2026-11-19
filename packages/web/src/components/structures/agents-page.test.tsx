import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeRoom, mkMatrixEvent } from "../../../test/factories";
import { mswServer } from "../../../test/setup";
import { signInForVmApi } from "../../../test/vm-api";
import {
  CAN_NOTHING,
  INSTANCE_AGENT,
  INSTANCE_TYPES,
  PAYMENTS,
  PROFILE,
  PROJECTS,
  VM_GONE,
  makeAgent,
} from "../../../test/vm-fixtures";
import { MatrixClientPeg } from "../../client/peg";
import { WorkforceSpaceContext } from "../../hooks/use-workforce";
import type { Agent, AgentList, ProjectList } from "../../model/types";
import { AgentsRoute } from "./agents-page";

const API = "/_fabrium/v1";
const PEOPLE: AgentList["people"] = [
  { user_id: "@ana:example.org", name: "Ana" },
  { user_id: "@bob:example.org", name: "bob" },
];

/** A fake browser API: `GET /agents` answers `list`; `calls` records each request, with its body. */
function serve(
  agents: Agent[],
  vms: AgentList["vms"] = [{ name: "lima", state: "running", project_id: null }],
  people: AgentList["people"] = [],
) {
  const api = { list: { agents, vms, people } as AgentList, calls: [] as string[] };
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
    http.delete(`${API}/agents/:id`, ({ params, request }) => {
      api.calls.push(`DELETE ${params.id}${new URL(request.url).search}`);
      api.list = { ...api.list, agents: api.list.agents.filter((a) => a.id !== params.id) };
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${API}/instance-types`, () => HttpResponse.json(INSTANCE_TYPES)),
    http.post(`${API}/vms`, async ({ request }) => {
      await record(request, "POST /vms");
      return HttpResponse.json({ id: "i-0123456789abcdef9", name: "lima" }, { status: 201 });
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

/** `GET /projects`, for every test: it answers `projects.list` and counts its requests apart. */
const projects = { list: null as unknown as ProjectList, gets: 0 };
beforeEach(() => {
  projects.list = { projects: PROJECTS, can: { manage: true } };
  projects.gets = 0;
  mswServer.use(
    http.get(`${API}/projects`, () => {
      projects.gets++;
      return HttpResponse.json(projects.list);
    }),
  );
});

afterEach(() => MatrixClientPeg.reset());

const projectField = (dialog: HTMLElement) =>
  within(dialog).getByRole("combobox", { name: "Project" });

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
    const reason = "Only a VM creator or an admin can create a VM.";
    const create = within(rowOf("scout")).getByRole("button", { name: "Create VM for scout" });
    expect(create).toBeDisabled();
    // Visible text, not a tooltip: a disabled button gets no pointer, focus, or touch.
    expect(within(rowOf("scout")).getByText(reason)).toBeVisible();
    expect(create).toHaveAccessibleDescription(reason);
    expect(buttonsIn(rowOf("scout"))).toEqual(["Edit", "Create VM", "Delete"]);
  });

  it("shows Create VM enabled when can.create_vm is set", async () => {
    serve([VM_GONE]);
    renderPage();
    await screen.findByRole("rowheader", { name: /^review/ });
    const create = within(rowOf("review")).getByRole("button", { name: "Create VM for review" });
    expect(create).toBeEnabled();
    expect(create).not.toHaveAccessibleDescription();
    expect(screen.queryByText("Only a VM creator or an admin can create a VM.")).toBeNull();
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

  it("offers the people of the agents answer as owners", async () => {
    serve([makeAgent({ owner: "@ana:example.org" })], undefined, PEOPLE);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Edit echo" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit agent" });
    const owner = within(dialog).getByLabelText("Owner");
    expect(within(owner).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Ana (@ana:example.org)",
      "bob (@bob:example.org)",
    ]);
  });

  it("does not read the members of the space for the owner list", async () => {
    serve([makeAgent({ owner: "@ana:example.org" })], undefined, PEOPLE);
    const user = userEvent.setup();
    // The space has a joined member who is not a person: the page must not offer them.
    const { client } = signInForVmApi();
    const spaceId = "!space:example.org";
    const space = makeRoom(spaceId, { client, myUserId: "@ann:example.org" });
    space.currentState.setStateEvents([
      mkMatrixEvent({
        roomId: spaceId,
        sender: "@lima.echo:example.org",
        type: "m.room.member",
        stateKey: "@lima.echo:example.org",
        content: { membership: "join", displayname: "echo" },
      }),
    ]);
    (client as unknown as { addRoom(room: typeof space): void }).addRoom(space);
    render(
      <WorkforceSpaceContext.Provider value={spaceId}>
        <AgentsRoute />
      </WorkforceSpaceContext.Provider>,
    );

    await user.click(await screen.findByRole("button", { name: "Edit echo" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit agent" });
    const owner = within(dialog).getByLabelText("Owner");
    expect(within(owner).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Ana (@ana:example.org)",
      "bob (@bob:example.org)",
    ]);
  });

  it("creates a VM for an agent, closes, and refreshes the list", async () => {
    const api = serve([VM_GONE]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Create VM for review" }));
    const dialog = await screen.findByRole("dialog", { name: "Create a VM for review" });
    await within(dialog).findByLabelText("Instance type");
    await user.type(within(dialog).getByLabelText("Haven API key"), "hk-1");
    await user.click(within(dialog).getByRole("button", { name: "Create VM" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls).toEqual([
      "GET /agents",
      `POST /vms {"agent":"${VM_GONE.id}","name":"kilo","instance_type":"t3a.medium","auto_stop_hours":12,"haven_api_key":"hk-1"}`,
      "GET /agents",
    ]);
  });

  it("deletes an agent, closes, and refreshes the list", async () => {
    const api = serve([PROFILE]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Delete scout" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete scout?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete agent" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(await screen.findByText("No agents yet")).toBeInTheDocument();
    expect(api.calls).toEqual(["GET /agents", `DELETE ${PROFILE.id}`, "GET /agents"]);
  });

  it("refreshes the list after a failed delete", async () => {
    // Another user deleted the sibling: the list still says echo has one.
    const sibling = makeAgent({ can: { ...CAN_NOTHING, edit: true, delete: true } });
    const api = serve([sibling]);
    mswServer.use(
      http.delete(`${API}/agents/:id`, ({ request }) => {
        if (new URL(request.url).search === "?vm=1") return undefined; // the default handler
        api.calls.push("DELETE (409)");
        api.list = { ...api.list, agents: [makeAgent()] };
        return HttpResponse.json({ error: "last agent of the vm" }, { status: 409 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Delete echo" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete echo?" });
    expect(dialog).toHaveAccessibleDescription("The agent leaves its rooms. Its messages stay.");
    await user.click(within(dialog).getByRole("button", { name: "Delete agent" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("last agent of the vm");
    await waitFor(() => expect(api.calls).toEqual(["GET /agents", "DELETE (409)", "GET /agents"]));
    await waitFor(() =>
      expect(dialog).toHaveAccessibleDescription(
        "echo is the last agent of the VM lima. This deletes the agent and the VM. The files on the VM are lost.",
      ),
    );

    await user.click(within(dialog).getByRole("button", { name: "Delete agent and VM" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api.calls.slice(3)).toEqual([`DELETE ${sibling.id}?vm=1`, "GET /agents"]);
  });

  it("creates a project from the selector and sends its id", async () => {
    const api = serve([makeAgent()]);
    mswServer.use(
      http.post(`${API}/projects`, async ({ request }) => {
        api.calls.push(`POST /projects ${await request.text()}`);
        return HttpResponse.json({ id: "p9", name: "Billing", in_use: false }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("rowheader", { name: /^echo/ });

    await user.click(screen.getByRole("button", { name: "New agent" }));
    const dialog = await screen.findByRole("dialog", { name: "New agent" });
    await waitFor(() => expect(within(dialog).getByLabelText("Model")).toHaveValue("glm-5-3"));
    await user.type(within(dialog).getByLabelText("Name"), "nova");
    await waitFor(() => expect(projectField(dialog)).toBeEnabled());
    await user.click(projectField(dialog));
    await user.type(
      screen.getByRole("combobox", { name: "Search or create a project" }),
      "Billing",
    );
    await user.click(screen.getByRole("option", { name: 'Create project "Billing"' }));
    await waitFor(() => expect(projectField(dialog)).toHaveTextContent("Billing"));
    await user.click(within(dialog).getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls).toEqual([
      "GET /agents",
      'POST /projects {"name":"Billing"}',
      'POST /agents {"name":"nova","model":"glm-5-3","project_id":"p9"}',
      "GET /agents",
    ]);
  });

  it("an agents-manager gets no Create project", async () => {
    serve([makeAgent()]);
    projects.list = { projects: PROJECTS, can: { manage: false } };
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("rowheader", { name: /^echo/ });

    await user.click(screen.getByRole("button", { name: "New agent" }));
    const dialog = await screen.findByRole("dialog", { name: "New agent" });
    await waitFor(() => expect(projectField(dialog)).toBeEnabled());
    await user.click(projectField(dialog));
    await user.type(
      screen.getByRole("combobox", { name: "Search or create a project" }),
      "Billing",
    );
    expect(screen.queryByRole("option", { name: /Create project/ })).toBeNull();
    expect(screen.getByText("No projects match")).toBeInTheDocument();
  });

  it("loads the projects again after unknown project, and the dialog shows it", async () => {
    const api = serve([makeAgent()]);
    mswServer.use(
      http.put(`${API}/agents/:id`, () => {
        api.calls.push("PUT (400)");
        // Another admin deleted Marketing while the dialog was open.
        projects.list = { projects: [PAYMENTS], can: { manage: true } };
        return HttpResponse.json({ error: "unknown project" }, { status: 400 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Edit echo" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit agent" });
    await waitFor(() => expect(projectField(dialog)).toBeEnabled());
    const before = projects.gets;
    await user.click(projectField(dialog));
    await user.click(await screen.findByRole("option", { name: "Marketing" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(projectField(dialog)).toHaveAccessibleDescription(
        "That project no longer exists. Pick another one.",
      ),
    );
    expect(projects.gets).toBe(before + 1);
    expect(projectField(dialog)).toHaveTextContent("Marketing");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
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
