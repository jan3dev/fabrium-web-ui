import { randomUUID } from "node:crypto";
import { HS_URL, expect, test } from "./fixtures/daemon-impersonator";

const HTML = `<!doctype html><html><head><style>.card{padding:16px}</style></head>
<body><div class="card"><h2>Pro</h2><button class="cta">Buy</button></div></body></html>`;

const REACT = `export default function Counter() {
  const [n, setN] = useState(0);
  return <button className="p-2" onClick={() => setN(n + 1)}>Count: {n}</button>;
}`;

test("an agent's artifact previews sandboxed, and an annotation reaches the agent", async ({
  page,
  human,
  daemon,
}) => {
  const join = (roomId: string) =>
    fetch(`${HS_URL}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${human.accessToken}` },
    });
  const send = (
    roomId: string,
    type: string,
    content: Record<string, unknown>,
  ) =>
    (
      daemon.agentClient.sendEvent as (
        r: string,
        t: string,
        c: Record<string, unknown>,
      ) => Promise<unknown>
    )(roomId, type, content);

  // Artifacts render only for rostered agents, so roster the identity the fixture sends as.
  const { user_id: agent } = await daemon.agentClient.whoami();
  const workforceSpace = `e2e-${randomUUID().slice(0, 8)}`;
  // The appservice owns no aliases, so the human creates the workforce space.
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
  expect((await join(roomId)).ok).toBeTruthy();

  const root = await daemon.sendText(roomId, "Build me a pricing card");
  const thread = { "m.relates_to": { rel_type: "m.thread", event_id: root } };
  await send(roomId, "dev.fabrium.artifact.version", {
    identifier: "pricing-card",
    type: "html",
    title: "Pricing card",
    body: HTML,
    ...thread,
  });

  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: { homeserver_url: HS_URL, workforce_space: workforceSpace },
    }),
  );
  await page.goto("/login");
  await page.getByLabel(/username/i).fill(human.username);
  await page.getByLabel(/password/i).fill(human.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.getByRole("button", { name: /user menu/i }).waitFor();
  await page.goto(`/room/${roomId}?thread=${encodeURIComponent(root)}`);

  await page.getByTestId("artifact-card").click();
  const panel = page.getByTestId("artifact-panel");
  await expect(panel).toBeVisible();
  const frame = page.frameLocator('[data-testid="artifact-preview"]');
  await expect(frame.getByRole("button", { name: "Buy" })).toBeVisible();
  // The sandbox gives the frame an opaque origin: no access to the app's cookies or storage.
  expect(await frame.locator("body").evaluate(() => window.origin)).toBe(
    "null",
  );

  await panel.getByRole("button", { name: "Annotate" }).click();
  await frame.getByRole("button", { name: "Buy" }).click();
  await expect(page.getByTestId("artifact-annotation-bar")).toContainText(
    "button.cta",
  );
  await page.getByLabel("Annotation note").fill("make it blue");
  await page.getByRole("button", { name: "Add to reply" }).click();

  const threadPane = page.getByTestId("thread-pane");
  await expect(
    threadPane.getByRole("list", { name: /artifact annotations/i }),
  ).toContainText("make it blue");
  await threadPane.getByRole("textbox", { name: /message/i }).fill("please");
  await threadPane.getByRole("textbox", { name: /message/i }).press("Enter");

  const sent = await daemon.waitForMessage(
    roomId,
    (e) =>
      e.sender === human.userId &&
      !!(e.content as Record<string, unknown>)["dev.fabrium.artifact_refs"],
  );
  const body = (sent.content as { body: string }).body;
  expect(body).toContain("[Annotation 1 on artifact `pricing-card` v1");
  expect(body).toContain("button.cta");
  expect(body).toContain("Note: make it blue");
  // The reply shows the comment and the annotation, not the agent-facing text.
  await expect(threadPane.getByText("please", { exact: true })).toBeVisible();

  // A version arriving while the thread is open opens itself; React runs from the vendored runtime.
  await send(roomId, "dev.fabrium.artifact.version", {
    identifier: "counter",
    type: "react",
    title: "Counter",
    body: REACT,
    ...thread,
  });
  await expect(panel.getByRole("heading", { name: "Counter" })).toBeVisible();
  await frame.getByRole("button", { name: "Count: 0" }).click();
  await expect(frame.getByRole("button", { name: "Count: 1" })).toBeVisible();
});
