import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { makeVm } from "../test/vm-fixtures";
import { HS_URL, expect, test } from "./fixtures/daemon-impersonator";

const AXE_PATH = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const BLOCKING = new Set(["serious", "critical"]);

// One VM per look of /vm: each state tone, Confidential, expired setup, no IP or agent.
const VMS = [
  makeVm(),
  makeVm({ id: "i-0123456789abcdef1", name: "kilo", state: "stopped", public_ip: null }),
  makeVm({
    id: "i-0123456789abcdef2",
    name: "oscar",
    state: "pending",
    setup: "pending",
    public_ip: null,
    agent_id: null,
  }),
  makeVm({
    id: "i-0123456789abcdef3",
    name: "tango",
    instance_type: "c6a.large",
    sev_snp: true,
    setup: "expired",
    agent_id: "@tango.echo:example.org",
  }),
];

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

    // No Fabrium API in the fixture: stub it and its OpenID request, so the rail and /vm show VMs.
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

    const found: string[] = [];
    // Visit a page, wait until `ready` shows, then sweep it.
    async function sweep(path: string, ready: () => Promise<void>) {
      await page.goto(path);
      await ready();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const line of await seriousViolations(page))
        found.push(`${path}\n  ${line}`);
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

    expect(found, found.join("\n\n")).toEqual([]);
  });
}
