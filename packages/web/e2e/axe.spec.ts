import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { Locator, Page } from "@playwright/test";
import type { AxeResults } from "axe-core";
import {
  INSTANCE_AGENT,
  INSTANCE_TYPES,
  PAYMENTS,
  PROFILE,
  PROJECTS,
  PROJECT_AGENT,
  PROJECT_VM,
  VM_GONE,
  makeAgent,
  makeVm,
} from "../test/vm-fixtures";
import { HS_URL, expect, test } from "./fixtures/daemon-impersonator";

const AXE_PATH = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const BLOCKING = new Set(["serious", "critical"]);

// One VM per look of /vm: each state tone, Confidential, expired setup, no IP, no agent, two agents,
// and a project VM. The project VM is kilo, so the stopped VM has another name.
const VMS = [
  makeVm(),
  makeVm({ id: "i-0123456789abcdef1", name: "juliet", state: "stopped", public_ip: null }),
  makeVm({
    id: "i-0123456789abcdef2",
    name: "oscar",
    state: "pending",
    setup: "pending",
    public_ip: null,
    agents: [],
  }),
  makeVm({
    id: "i-0123456789abcdef3",
    name: "tango",
    instance_type: "c6a.large",
    sev_snp: true,
    setup: "expired",
    agents: [
      { id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "echo", agent_id: "@tango.echo:example.org" },
      { id: "1b2c3d4e5f60718293a4b5c6d7e8f90a", name: "reviewer", agent_id: "@tango.reviewer:example.org" },
    ],
  }),
  PROJECT_VM,
];

// One agent per look of /agents: on a VM, a profile (Create VM disabled with its reason), an
// instance agent, a project agent, and an agent whose VM is gone (Create VM enabled).
const AGENTS = {
  agents: [makeAgent(), PROFILE, INSTANCE_AGENT, PROJECT_AGENT, VM_GONE],
  vms: [
    { name: "lima", state: "running", project_id: null },
    { name: "kilo", state: "running", project_id: PAYMENTS.id },
  ],
  people: [
    { user_id: "@ann:example.org", name: "Ann" },
    { user_id: "@luis:example.org", name: "Luis" },
  ],
};

// The homeserver answers on another origin, so a stubbed answer needs CORS headers.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
};

/** One axe pass: the page's serious and critical violations, keyed by rule and target. */
async function axePass(page: Page): Promise<Map<string, string>> {
  const results = await page.evaluate(() =>
    (
      window as unknown as { axe: { run: (o: object) => Promise<AxeResults> } }
    ).axe.run({
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    }),
  );
  const found = new Map<string, string>();
  for (const v of results.violations.filter((v) => BLOCKING.has(v.impact ?? "")))
    for (const n of v.nodes)
      found.set(
        `${v.id} ${n.target.join(" ")}`,
        `${v.id} (${v.impact}): ${n.target.join(" ")}\n  ${n.html}\n  ${n.failureSummary}`,
      );
  return found;
}

/**
 * The current page's serious and critical violations, one line each. The app
 * keeps re-rendering from sync while axe reads the DOM, and a node React swaps
 * out mid-run reads as empty, so a hit counts only if a second pass repeats it.
 */
async function seriousViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE_PATH });
  const first = await axePass(page);
  if (first.size === 0) return [];
  await page.waitForTimeout(1000);
  const second = await axePass(page);
  return [...first].filter(([key]) => second.has(key)).map(([, line]) => line);
}

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no serious violations in the ${theme} theme`, async ({
    page,
    human,
    daemon,
  }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(
      (t) => localStorage.setItem("fabrium:theme:v1", t),
      theme,
    );

    const roomId = await daemon.createRoomWithHuman(human.userId);
    const join = await fetch(
      `${HS_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${human.accessToken}` },
      },
    );
    expect(join.ok).toBeTruthy();
    const rootId = await daemon.sendText(
      roomId,
      "Deploy notes for the **payments** release",
    );
    await daemon.sendThreadReply(roomId, rootId, "Staging is green");
    // A motion artifact with two scenes and a tweak: the scene list, the transport and the Tweaks tab.
    // Sent before the approval: the inbox reads approvals from the room's first sync window.
    const motionRoot = await daemon.sendText(roomId, "Animate the intro");
    await (
      daemon.agentClient.sendEvent as (r: string, t: string, c: Record<string, unknown>) => Promise<unknown>
    )(roomId, "dev.fabrium.artifact.version", {
      identifier: "intro",
      type: "motion",
      title: "Intro",
      body:
        '<!doctype html><html><head><script type="application/json" data-tweaks>[{"name":"headline","label":"Headline","type":"text","value":"Hello"}]</script>' +
        "<style>h1{animation:rise 1s both}@keyframes rise{from{opacity:0}}</style></head>" +
        '<body><section data-name="Intro" data-duration="2000"><h1 data-tweak="headline">Hello</h1></section><section data-name="Outro"><h1>Bye</h1></section></body></html>',
      "m.relates_to": { rel_type: "m.thread", event_id: motionRoot },
    });
    await daemon.sendApprovalRequest(roomId, {
      sessionId: "s-axe",
      toolCallId: "tc-axe",
    });

    // A live app preview in the thread: the agent must be in a workforce roster for its card.
    const { user_id: agent } = await daemon.agentClient.whoami();
    const workforceSpace = `axe-${randomUUID().slice(0, 8)}`;
    const space = await fetch(`${HS_URL}/_matrix/client/v3/createRoom`, {
      method: "POST",
      headers: { Authorization: `Bearer ${human.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        room_alias_name: workforceSpace,
        creation_content: { type: "m.space" },
        initial_state: [
          {
            type: "dev.zooid.workforce",
            state_key: "axe",
            content: { version: 1, agents: [{ user_id: agent, name: "coder" }] },
          },
        ],
      }),
    });
    expect(space.ok).toBeTruthy();
    await (
      daemon.agentClient.sendEvent as (r: string, t: string, c: Record<string, unknown>) => Promise<unknown>
    )(roomId, "m.room.message", {
      msgtype: "m.notice",
      body: "Preview: Todo app (npm run dev)",
      "dev.fabrium.preview": { name: "todo-app", title: "Todo app", command: "npm run dev", action: "started" },
      "m.relates_to": { rel_type: "m.thread", event_id: rootId },
    });
    // A slides artifact, in its own thread so it does not open over the app preview.
    const deckRoot = await daemon.sendText(roomId, "Make a launch deck");
    await (
      daemon.agentClient.sendEvent as (r: string, t: string, c: Record<string, unknown>) => Promise<unknown>
    )(roomId, "dev.fabrium.artifact.version", {
      identifier: "deck",
      type: "slides",
      title: "Deck",
      body: "<!doctype html><html><body><section><h1>One</h1><aside data-notes>Open with the numbers.</aside></section><section data-skip><h1>Two</h1></section></body></html>",
      "m.relates_to": { rel_type: "m.thread", event_id: deckRoot },
    });
    // A design with two artboards, in its own thread: the all-artboards canvas.
    const designRoot = await daemon.sendText(roomId, "Sketch the checkout");
    await (
      daemon.agentClient.sendEvent as (r: string, t: string, c: Record<string, unknown>) => Promise<unknown>
    )(roomId, "dev.fabrium.artifact.version", {
      identifier: "checkout",
      type: "design",
      title: "Checkout",
      body: '<!doctype html><html><body><section data-name="Cart"><h1>Cart</h1></section><section data-name="Phone" data-width="390" data-height="844"><h1>Phone cart</h1></section></body></html>',
      "m.relates_to": { rel_type: "m.thread", event_id: designRoot },
    });
    // A whiteboard with every note color, a shape, a section and an edge: text on each color in both themes.
    const boardRoot = await daemon.sendText(roomId, "Map the launch");
    await (
      daemon.agentClient.sendEvent as (r: string, t: string, c: Record<string, unknown>) => Promise<unknown>
    )(roomId, "dev.fabrium.artifact.version", {
      identifier: "board",
      type: "whiteboard",
      title: "Board",
      body: JSON.stringify({
        nodes: [
          { id: "s", type: "section", x: 0, y: 0, w: 900, h: 200, text: "Launch" },
          ...["yellow", "orange", "red", "pink", "purple", "blue", "green", "gray"].map((color, i) => ({
            id: color,
            type: "note",
            x: 20 + i * 110,
            y: 60,
            w: 100,
            h: 100,
            text: `A ${color} note`,
            color,
          })),
          { id: "d", type: "shape", shape: "diamond", x: 20, y: 260, w: 160, h: 100, text: "Decide" },
        ],
        edges: [
          { from: "yellow", to: "d", label: "then" },
          { from: "blue", to: "d", label: "maybe", style: "dashed", color: "blue", arrow: "both" },
        ],
      }),
      "m.relates_to": { rel_type: "m.thread", event_id: boardRoot },
    });
    // A design system, in its own thread too.
    const tokensRoot = await daemon.sendText(roomId, "Write down our tokens");
    await (
      daemon.agentClient.sendEvent as (r: string, t: string, c: Record<string, unknown>) => Promise<unknown>
    )(roomId, "dev.fabrium.artifact.version", {
      identifier: "tokens",
      type: "design-system",
      title: "Tokens",
      body: JSON.stringify({
        overview: "# Tokens",
        colors: [{ name: "brand", value: "rgb(51, 85, 255)" }],
        spacing: [{ name: "sm", value: "8px" }],
      }),
      "m.relates_to": { rel_type: "m.thread", event_id: tokensRoot },
    });
    await page.route("**/config.json", (route) =>
      route.fulfill({ json: { homeserver_url: HS_URL, workforce_space: workforceSpace, previews: true } }),
    );
    // Crashed, so the panel shows its state with log and actions; a second app keeps the header button up.
    const previewInfo = (name: string, status: string) => ({
      agent_id: agent,
      name,
      title: name === "todo-app" ? "Todo app" : "Shop",
      command: "npm run dev",
      kind: "web",
      room_id: roomId,
      thread_root: rootId,
      status,
      since: "2026-11-11T09:30:00Z",
      exit_code: status === "crashed" ? 1 : null,
    });
    await page.route("**/_fabrium/v1/previews?*", (route) =>
      route.fulfill({ json: [previewInfo("todo-app", "crashed"), previewInfo("shop", "running")] }),
    );
    await page.route("**/_fabrium/v1/previews/**", (route) =>
      route.fulfill({
        json: {
          ...previewInfo("todo-app", "crashed"),
          log: { offset: 80, text: "VITE ready in 300 ms\nError: Cannot find module './routes/todos'\n" },
        },
      }),
    );

    // No Fabrium API in the fixture: stub it and its OpenID request, so the rail, /vm, and /agents have data.
    await page.route("**/openid/request_token", (route) =>
      route.request().method() === "OPTIONS"
        ? route.fulfill({ status: 204, headers: CORS })
        : route.fulfill({
            headers: CORS,
            json: {
              access_token: "e2e-openid-token",
              token_type: "Bearer",
              matrix_server_name: "localhost",
              expires_in: 3600,
            },
          }),
    );
    await page.route("**/_fabrium/v1/access", (route) =>
      route.fulfill({ json: { user_id: human.userId, role: "admin" } }),
    );
    await page.route("**/_fabrium/v1/vms", (route) =>
      route.fulfill({ json: VMS }),
    );
    await page.route("**/_fabrium/v1/agents", (route) =>
      route.fulfill({ json: AGENTS }),
    );
    await page.route("**/_fabrium/v1/models", (route) =>
      route.fulfill({ json: { models: [{ id: "glm-5-3" }], default: "glm-5-3" } }),
    );
    await page.route("**/_fabrium/v1/instance-types", (route) =>
      route.fulfill({ json: INSTANCE_TYPES }),
    );
    await page.route("**/_fabrium/v1/projects", (route) =>
      route.fulfill({ json: { projects: PROJECTS, can: { manage: true } } }),
    );

    const found: string[] = [];
    // Visit a page, wait until `ready` shows, then sweep it.
    async function sweep(path: string, ready: () => Promise<void>) {
      await page.goto(path);
      await ready();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const line of await seriousViolations(page))
        found.push(`${path}\n  ${line}`);
    }
    // Open a dialog on the current page, sweep it, then close it. Escape closes only the layer on
    // top: `layers` (an open project list, a rename) innermost first, then the dialog. Each press
    // waits until its layer is gone, so a second press never reaches a layer that is closing.
    async function sweepDialog(label: string, open: () => Promise<void>, layers: Locator[] = []) {
      await open();
      await page.getByRole("dialog").first().waitFor();
      for (const line of await seriousViolations(page)) found.push(`${label}\n  ${line}`);
      for (const layer of [...layers, page.getByRole("dialog")]) {
        await page.keyboard.press("Escape");
        await expect(layer).toHaveCount(0);
      }
    }
    const dialog = (name: string) => page.getByRole("dialog", { name });
    /** Opens the project list of a dialog, once the projects have loaded. */
    async function openProjects(name: string) {
      const field = dialog(name).getByRole("combobox", { name: "Project" });
      await expect(field).toBeEnabled();
      await field.click();
    }
    const room = `/room/${encodeURIComponent(roomId)}`;
    const text = (t: string | RegExp) => () =>
      page.getByText(t).first().waitFor();

    await sweep("/signup", () => page.getByLabel(/username/i).waitFor());
    await sweep("/login", () => page.getByLabel(/username/i).waitFor());
    await page.getByLabel(/username/i).fill(human.username);
    await page.getByLabel(/password/i).fill(human.password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: /user menu/i }).waitFor();

    await sweep("/", () =>
      page.getByRole("button", { name: /user menu/i }).waitFor(),
    );
    await sweep(room, () => page.getByTestId("approval-card").waitFor());
    await sweep(
      `${room}?thread=${encodeURIComponent(rootId)}`,
      text("Staging is green"),
    );
    await sweep(
      `${room}?thread=${encodeURIComponent(rootId)}&preview=${encodeURIComponent(`${agent}/todo-app`)}`,
      async () => {
        await page.getByTestId("preview-card").waitFor();
        await page.getByTestId("preview-state").getByRole("button", { name: "Restart app" }).waitFor();
        await page.getByRole("tab", { name: "Logs" }).click();
        await page.getByRole("tabpanel", { name: "App logs" }).waitFor();
      },
    );
    await sweep(`${room}?thread=${encodeURIComponent(deckRoot)}&artifact=deck`, async () => {
      await page.getByRole("navigation", { name: "Slides" }).getByRole("button", { name: /Two/ }).waitFor();
      await page.getByTestId("speaker-notes").waitFor();
    });
    // The grid view: the same preview cards, larger.
    await sweep(`${room}?thread=${encodeURIComponent(deckRoot)}&artifact=deck`, async () => {
      await page.getByRole("button", { name: "Grid view" }).click();
      await page.getByTestId("frame-grid").getByRole("button", { name: /Two/ }).waitFor();
      await page.getByTestId("frame-grid").locator("iframe").first().waitFor();
    });
    await sweep(`${room}?thread=${encodeURIComponent(tokensRoot)}&artifact=tokens`, async () => {
      await page.getByRole("navigation", { name: "Design system sections" }).getByRole("button", { name: /Colors/ }).click();
      await page.getByRole("form", { name: "Add to colors" }).waitFor();
    });
    // Level 2 edit surfaces: the slide menu with the editable notes, the layout picker, the version list, the design-system editor.
    await sweep(`${room}?thread=${encodeURIComponent(deckRoot)}&artifact=deck`, async () => {
      await page.getByTestId("speaker-notes").getByLabel("Speaker notes").waitFor();
      await page.getByRole("button", { name: "Slide 2 actions" }).click();
      await page.getByRole("menuitem", { name: "Include slide" }).waitFor();
    });
    await sweep(`${room}?thread=${encodeURIComponent(deckRoot)}&artifact=deck`, async () => {
      await page.getByRole("navigation", { name: "Slides" }).getByRole("button", { name: "Add slide" }).click();
      await page.getByRole("dialog", { name: "Add slide" }).locator("iframe").nth(9).waitFor();
    });
    await sweep(`${room}?thread=${encodeURIComponent(deckRoot)}&artifact=deck`, async () => {
      await page.getByTestId("artifact-versions").click();
      await page.getByRole("menuitemradio").first().waitFor();
    });
    // The deck's side panel on a tab. It may be open already: Properties is remembered across sweeps.
    const sideTab = async (name: string) => {
      await page.getByRole("toolbar", { name: "Canvas tools" }).waitFor();
      const toggle = page.getByRole("button", { name: "Side panel" });
      if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
      await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
    };
    // Level 5: the Export menu with the agent's formats.
    await sweep(`${room}?thread=${encodeURIComponent(deckRoot)}&artifact=deck`, async () => {
      await page.getByTestId("artifact-export").click();
      await page.getByRole("menuitem", { name: "Google Slides" }).waitFor();
    });
    // Level 4: comment mode, the side panel's Comments tab with the list of open comments.
    await sweep(`${room}?thread=${encodeURIComponent(deckRoot)}&artifact=deck`, async () => {
      await sideTab("Comments");
      await page.getByText("No open comments.").waitFor();
    });
    // Level 3: the canvas tools and the Properties tab with its layers list.
    await sweep(`${room}?thread=${encodeURIComponent(deckRoot)}&artifact=deck`, async () => {
      await sideTab("Properties");
      await page.getByTestId("layers-list").waitFor();
    });
    // The design canvas: every artboard in a row, with Properties (open since the sweep above).
    await sweep(`${room}?thread=${encodeURIComponent(designRoot)}&artifact=checkout`, async () => {
      const frame = page.frameLocator('[data-testid="artifact-preview"]');
      await frame.getByText("Cart", { exact: true }).waitFor();
      await frame.getByText("Phone cart").waitFor();
      await page.getByTestId("layers-list").waitFor();
    });
    // On a phone: Properties is a sheet under the canvas.
    await page.setViewportSize({ width: 390, height: 844 });
    await sweep(`${room}?thread=${encodeURIComponent(deckRoot)}&artifact=deck`, async () => {
      await page.getByRole("dialog", { name: "Properties" }).getByTestId("layers-list").waitFor();
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await sweep(`${room}?thread=${encodeURIComponent(tokensRoot)}&artifact=tokens`, async () => {
      await page.getByRole("navigation", { name: "Design system sections" }).getByRole("button", { name: /Colors/ }).click();
      await page.getByRole("button", { name: "Edit" }).click();
      await page.getByLabel("Value of brand").waitFor();
    });
    // The whiteboard, drawn in the app, with a note selected and the agent's actions open.
    await sweep(`${room}?thread=${encodeURIComponent(boardRoot)}&artifact=board`, async () => {
      await page.getByRole("group", { name: /^A gray note/ }).click();
      await page.getByRole("button", { name: "Ask agent" }).click();
      await page.getByRole("menuitem", { name: "Find the gaps" }).waitFor();
    });
    // A connection selected: its controls in the toolbar.
    await sweep(`${room}?thread=${encodeURIComponent(boardRoot)}&artifact=board`, async () => {
      await page.getByRole("button", { name: /^Connection from A blue note/ }).click();
      await page.getByRole("button", { name: "Reverse direction" }).waitFor();
    });
    // Comment mode on the board: the note box beside a node.
    await sweep(`${room}?thread=${encodeURIComponent(boardRoot)}&artifact=board`, async () => {
      const toggle = page.getByRole("button", { name: "Side panel" });
      if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
      await page.getByRole("tab", { name: /^Comments/ }).click();
      await page.getByRole("group", { name: /^Decide/ }).click();
      await page.getByTestId("comment-popover").waitFor();
    });
    // Motion: the scene list with duration fields, the transport, and the Tweaks tab.
    await sweep(`${room}?thread=${encodeURIComponent(motionRoot)}&artifact=intro`, async () => {
      await page.getByLabel("Duration of scene 2 in seconds").waitFor();
      await page.getByTestId("motion-transport").getByRole("slider", { name: "Time" }).waitFor();
      const toggle = page.getByRole("button", { name: "Side panel" });
      if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
      await page.getByRole("tab", { name: /^Tweaks/ }).click();
      await page.getByTestId("tweaks-panel").waitFor();
    });
    await sweep(`${room}?pane=members`, text(human.username));
    await sweep(`${room}?pane=info`, text("Room info"));
    await sweep("/search", () => page.getByRole("main").waitFor());
    await sweep("/inbox", () =>
      page
        .getByTestId("inbox-detail")
        .or(page.getByText(/approval needed/i).first())
        .waitFor(),
    );
    await sweep("/invites", () => page.getByRole("main").waitFor());
    await sweep("/vm", text("tango"));
    await sweepDialog("/vm: Move to project", async () => {
      await page.getByRole("button", { name: "Actions for kilo" }).click();
      await page.getByRole("menuitem", { name: "Move to project" }).click();
      await dialog("Move kilo to a project").waitFor();
    });
    await sweep("/agents", text(AGENTS.agents[0].name));
    await sweepDialog(
      "/agents: New agent, with the project list",
      async () => {
        await page.getByRole("button", { name: "New agent" }).click();
        await openProjects("New agent");
        await page.getByRole("combobox", { name: "Search or create a project" }).fill("Bil");
        await page.getByRole("option", { name: 'Create project "Bil"' }).waitFor();
      },
      [page.getByRole("listbox")],
    );
    await sweepDialog("/agents: Edit, taking an agent out of its project", async () => {
      await page.getByRole("button", { name: `Edit ${PROJECT_AGENT.name}` }).click();
      await openProjects("Edit agent");
      await page.getByRole("option", { name: "No project" }).click();
      // The pick closes the list: the Escape of the sweep must reach the dialog, not the list.
      await expect(page.getByRole("listbox")).toHaveCount(0);
      await dialog("Edit agent").getByLabel("Owner").waitFor();
    });
    await sweepDialog("/agents: Create VM", async () => {
      await page.getByRole("button", { name: `Create VM for ${VM_GONE.name}` }).click();
      await dialog(`Create a VM for ${VM_GONE.name}`).getByLabel("Instance type").waitFor();
    });
    await sweepDialog(
      "/agents: Manage projects, renaming",
      async () => {
        await page.getByRole("button", { name: "Manage projects" }).click();
        await dialog("Manage projects").getByRole("button", { name: "Rename Payments" }).click();
        await page.getByRole("textbox", { name: "Name of Payments" }).waitFor();
      },
      [page.getByRole("textbox", { name: "Name of Payments" })],
    );

    expect(found, found.join("\n\n")).toEqual([]);
  });
}
