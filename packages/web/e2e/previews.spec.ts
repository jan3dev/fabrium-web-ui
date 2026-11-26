import { randomUUID } from "node:crypto";
import { bridgeScript } from "../../cli/src/previews/gateway";
import { HS_URL, expect, test } from "./fixtures/daemon-impersonator";

// The daemon's preview API and gateway are mocked: this spec covers the web UI and the
// gateway's real bridge script. The app's CSP allows frames from `*.preview.localhost` only.
const SESSION_URL = "http://tok-e2e.preview.localhost:5999/";
const APP_HTML = `<!doctype html><html><head><script src="/__fabrium/bridge.js"></script><title>Todos</title></head>
<body><h1>Todo app running</h1><ul><li id="milk">Milk</li></ul>
<a href="/done">Done</a><button onclick="console.error('TypeError: todos is undefined')">Break</button></body></html>`;

test("an agent's preview opens beside its thread, shows a crash and restarts", async ({
  page,
  human,
  daemon,
}) => {
  const { user_id: agent } = await daemon.agentClient.whoami();
  const workforceSpace = `e2e-${randomUUID().slice(0, 8)}`;
  const created = await fetch(`${HS_URL}/_matrix/client/v3/createRoom`, {
    method: "POST",
    headers: { Authorization: `Bearer ${human.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "E2E",
      room_alias_name: workforceSpace,
      creation_content: { type: "m.space" },
      initial_state: [
        {
          type: "dev.zooid.workforce",
          state_key: "e2e",
          content: { version: 1, agents: [{ user_id: agent, name: "coder" }] },
        },
      ],
    }),
  });
  expect(created.ok).toBeTruthy();
  const roomId = await daemon.createRoomWithHuman(human.userId);
  const joined = await fetch(`${HS_URL}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${human.accessToken}` },
  });
  expect(joined.ok).toBeTruthy();

  const root = await daemon.sendText(roomId, "Build me a todo app");
  await (
    daemon.agentClient.sendEvent as (r: string, t: string, c: Record<string, unknown>) => Promise<unknown>
  )(roomId, "m.room.message", {
    msgtype: "m.notice",
    body: "Preview: Todo app (npm run dev)",
    "dev.fabrium.preview": { name: "todo-app", title: "Todo app", command: "npm run dev", action: "started" },
    "m.relates_to": { rel_type: "m.thread", event_id: root },
  });

  let status = "running";
  // Changes with the status only, as on the gateway: the panel mints a session per run.
  let since = new Date().toISOString();
  let exitCode: number | null = null;
  let log = "VITE ready\n";
  const calls: string[] = [];
  await page.route("**/_fabrium/v1/previews/**", async (route) => {
    const url = new URL(route.request().url());
    const [, , , , agentId, name, verb] = url.pathname.split("/").map(decodeURIComponent);
    expect([agentId, name]).toEqual([agent, "todo-app"]);
    if (route.request().method() === "POST") {
      calls.push(verb!);
      if (verb === "session") {
        return route.fulfill({ json: { url: SESSION_URL, expires_at: "2099-01-01T00:00:00Z" } });
      }
      if (verb === "restart") {
        status = "running";
        since = new Date().toISOString();
        exitCode = null;
        log = "";
      }
      return route.fulfill({ status: 204 });
    }
    const offset = Number(url.searchParams.get("log_offset") ?? 0);
    return route.fulfill({
      json: {
        agent_id: agent,
        name: "todo-app",
        title: "Todo app",
        command: "npm run dev",
        kind: "web",
        room_id: roomId,
        thread_root: root,
        status,
        since,
        exit_code: exitCode,
        log: { offset: log.length, text: offset > log.length ? log : log.slice(offset) },
      },
    });
  });
  await page.route("**/_fabrium/v1/previews?*", (route) =>
    route.fulfill({
      json: [
        {
          agent_id: agent,
          name: "todo-app",
          title: "Todo app",
          command: "npm run dev",
          kind: "web",
          room_id: roomId,
          thread_root: root,
          status,
          since,
          exit_code: exitCode,
        },
      ],
    }),
  );
  await page.route(`${SESSION_URL}**`, (route) =>
    new URL(route.request().url()).pathname === "/__fabrium/bridge.js"
      ? route.fulfill({ contentType: "text/javascript", body: bridgeScript(`http://localhost:${process.env.E2E_WEB_PORT ?? "5173"}`) })
      : route.fulfill({ contentType: "text/html", body: APP_HTML }),
  );
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: { homeserver_url: HS_URL, workforce_space: workforceSpace, previews: true },
    }),
  );

  await page.goto("/login");
  await page.getByLabel(/username/i).fill(human.username);
  await page.getByLabel(/password/i).fill(human.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.getByRole("button", { name: /user menu/i }).waitFor();
  await page.goto(`/room/${roomId}?thread=${encodeURIComponent(root)}`);

  await page.getByTestId("preview-card").click();
  const panel = page.getByTestId("preview-panel");
  await expect(panel).toBeVisible();
  // The iframe URL comes from the session call, never from the event.
  await expect(page.getByTestId("preview-frame")).toHaveAttribute("src", SESSION_URL);
  await expect(
    page.frameLocator('[data-testid="preview-frame"]').getByRole("heading", { name: "Todo app running" }),
  ).toBeVisible();
  // The thread stays beside the preview.
  await expect(page.getByTestId("thread-pane")).toBeVisible();
  const app = page.frameLocator('[data-testid="preview-frame"]');
  const path = page.getByTestId("preview-path");

  // The bridge reports navigation: the path field follows the app.
  await app.getByRole("link", { name: "Done" }).click();
  await expect(path).toHaveValue("/done");
  // A typed path loads on the session origin.
  await path.fill("/todos?filter=all");
  await path.press("Enter");
  await expect(page.getByTestId("preview-frame")).toHaveAttribute("src", `${SESSION_URL}todos?filter=all`);
  await expect(path).toHaveValue("/todos?filter=all");

  // A page error shows in the console, and "Ask agent to fix" fills the composer; nothing is sent.
  await app.getByRole("button", { name: "Break" }).click();
  const drawer = page.getByTestId("preview-console");
  await expect(drawer.getByTestId("preview-error-count")).toHaveText("1 error");
  await drawer.getByRole("button", { name: "Ask agent to fix" }).click();
  const thread = page.getByTestId("thread-pane");
  const annotations = thread.getByRole("list", { name: "Artifact annotations" });
  await expect(annotations).toContainText("Todo app · /todos?filter=all");
  await expect(annotations).toContainText("todos is undefined");
  await expect(thread.getByRole("textbox", { name: "Message" })).toContainText(
    "Can you fix this error in the preview?",
  );

  // Annotate: a click in the app picks the element instead of acting on it.
  await page.getByRole("button", { name: "Annotate" }).click();
  await app.locator("#milk").click();
  await page.getByLabel("Annotation note").fill("Strike this through when done");
  await page.getByRole("button", { name: "Add to reply" }).click();
  await expect(annotations.getByRole("listitem")).toHaveCount(2);
  await expect(annotations).toContainText("li#milk");
  await page.getByRole("button", { name: "Stop annotating" }).click();

  // Sent: the agent's body names the preview and the page; the timeline opens the preview again.
  await thread.getByRole("textbox", { name: "Message" }).press("Enter");
  // The composer's chips go; the sent message lists the same annotations, as buttons that open the preview.
  await expect(thread.getByRole("button", { name: /^Remove annotation/ })).toHaveCount(0);
  await expect(thread.getByRole("button", { name: /li#milk/ })).toBeVisible();

  // Device widths persist.
  await page.getByRole("button", { name: "Phone width (390 px)" }).click();
  await expect(page.getByTestId("preview-frame")).toHaveCSS("width", "390px");
  expect(await page.evaluate(() => localStorage.getItem("fabrium:preview-device:v1"))).toBe("phone");
  await page.getByRole("button", { name: "Desktop width" }).click();

  // The room header lists the running app and opens it.
  await page.getByRole("button", { name: "Close preview" }).click();
  await expect(panel).toBeHidden();
  await page.getByTestId("room-preview-button").click();
  await expect(panel).toBeVisible();

  // Mobile: the preview takes the screen; a switch shows the thread and keeps the app loaded.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("preview-mobile-view-thread").click();
  await expect(page.getByTestId("preview-frame")).toBeHidden();
  await expect(thread.getByRole("textbox", { name: "Message" })).toBeVisible();
  await page.getByTestId("preview-mobile-view-preview").click();
  await expect(page.getByTestId("preview-frame")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });

  status = "crashed";
  exitCode = 1;
  log += "Error: Cannot find module './routes/todos'\n";
  const state = page.getByTestId("preview-state");
  await expect(state).toContainText("App stopped (exit 1)");
  await expect(state).toContainText("Cannot find module");

  await state.getByRole("button", { name: "Restart app" }).click();
  await expect(state).toBeHidden();
  await expect(page.getByTestId("preview-frame")).toBeVisible();
  expect(calls).toContain("restart");
  expect(calls.filter((c) => c === "session").length).toBeGreaterThanOrEqual(2);
});

