import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import {
  type DaemonImpersonator,
  type FreshHuman,
  HS_URL,
  expect,
  test,
} from "./fixtures/daemon-impersonator";

const HTML = `<!doctype html><html><head><style>.card{padding:16px}</style></head>
<body><div class="card"><h2>Pro</h2><button class="cta">Buy</button></div></body></html>`;

const REACT = `export default function Counter() {
  const [n, setN] = useState(0);
  return <button className="p-2" onClick={() => setN(n + 1)}>Count: {n}</button>;
}`;

/** The open slide's card in the rail; its text starts with the slide number. */
const activeSlide = (panel: ReturnType<Page["getByTestId"]>) =>
  panel.getByRole("navigation", { name: "Slides" }).locator("[aria-current]");

/**
 * A rostered agent's thread, with the human signed in. `artifact` sends an artifact
 * version into the thread as the agent; `open` shows the thread.
 */
async function openThread({ page, human, daemon }: { page: Page; human: FreshHuman; daemon: DaemonImpersonator }) {
  const join = (roomId: string) =>
    fetch(`${HS_URL}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${human.accessToken}` },
    });
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
  const artifact = (content: Record<string, unknown>) =>
    (
      daemon.agentClient.sendEvent as (
        r: string,
        t: string,
        c: Record<string, unknown>,
      ) => Promise<unknown>
    )(roomId, "dev.fabrium.artifact.version", { ...content, ...thread });
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

  const open = () => page.goto(`/room/${roomId}?thread=${encodeURIComponent(root)}`);
  return { roomId, artifact, open };
}

test("an agent's artifact previews sandboxed, and an annotation reaches the agent", async ({
  page,
  human,
  daemon,
}) => {
  const { roomId, artifact, open } = await openThread({ page, human, daemon });
  await artifact({ identifier: "pricing-card", type: "html", title: "Pricing card", body: HTML });
  await open();

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
  // A style edit shows in the frame at once; cancelling the pick would drop it.
  await page.getByTestId("style-inspector").getByLabel("Radius").fill("12");
  await expect(frame.getByRole("button", { name: "Buy" })).toHaveCSS("border-radius", "12px");
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
  // The agent reads the style edit as CSS, then the user's note.
  expect(body).toContain("Note: Apply these style changes to the element:\nborder-radius: 12px;\n\nmake it blue");
  // The reply shows the comment and the annotation, not the agent-facing text.
  await expect(threadPane.getByText("please", { exact: true })).toBeVisible();

  // A version arriving while the thread is open opens itself; React runs from the vendored runtime.
  await artifact({ identifier: "counter", type: "react", title: "Counter", body: REACT });
  await expect(panel.getByRole("heading", { name: "Counter" })).toBeVisible();
  await frame.getByRole("button", { name: "Count: 0" }).click();
  await expect(frame.getByRole("button", { name: "Count: 1" })).toBeVisible();
});

const SLIDES = `<!doctype html><html><head><style>section{display:flex;align-items:center;justify-content:center;font:600 96px system-ui}</style></head>
<body><section data-title="Launch plan"><h1>Welcome</h1></section>
<section><h1>Why now</h1><p>Second slide text</p></section>
<section><h2>Pricing</h2><p>Third slide text</p></section></body></html>`;

const DESIGN = `<!doctype html><html><head><style>section{font:16px system-ui;padding:24px}</style></head>
<body><section data-name="Home"><h1>Home screen</h1></section>
<section data-name="Phone" data-width="390" data-height="844"><h1>Phone screen</h1></section></body></html>`;

test("slides and design artifacts open in their frame modes", async ({ page, human, daemon }) => {
  const { artifact, open } = await openThread({ page, human, daemon });
  await artifact({ identifier: "launch-deck", type: "slides", title: "Launch deck", body: SLIDES });
  await open();

  const card = page.getByTestId("artifact-card");
  await expect(card).toContainText("Slides");
  await card.click();
  const panel = page.getByTestId("artifact-panel");
  const rail = panel.getByRole("navigation", { name: "Slides" });
  await expect(rail.getByRole("button")).toHaveText(["1Launch plan", "2Why now", "3Pricing"]);
  const frame = page.frameLocator('[data-testid="artifact-preview"]');
  await expect(frame.getByText("Welcome")).toBeVisible();

  await rail.getByRole("button", { name: /Why now/ }).click();
  await expect(rail.getByRole("button", { name: /Why now/ })).toHaveAttribute("aria-current", "true");
  await expect(frame.getByText("Second slide text")).toBeVisible();
  await expect(frame.getByText("Welcome")).toBeHidden();
  await expect(activeSlide(panel)).toHaveText(/^2\D/);
  await page.keyboard.press("ArrowRight");
  await expect(activeSlide(panel)).toHaveText(/^3\D/);
  await expect(frame.getByText("Third slide text")).toBeVisible();
  // Keys pressed inside the frame come back to the panel.
  await frame.getByText("Third slide text").click();
  await page.keyboard.press("Home");
  await expect(activeSlide(panel)).toHaveText(/^1\D/);

  await artifact({ identifier: "checkout", type: "design", title: "Checkout", body: DESIGN });
  await expect(panel.getByRole("heading", { name: "Checkout" })).toBeVisible();
  const screens = panel.getByRole("navigation", { name: "Screens" });
  await screens.getByRole("button", { name: /Phone/ }).click();
  await expect(frame.getByText("Phone screen")).toBeVisible();
  await expect(frame.getByText("Home screen")).toBeHidden();
  // At 100 % the artboard has its own width; fit scales it to the stage.
  const width = () => frame.locator("body > section:nth-of-type(2)").evaluate((el) => el.getBoundingClientRect().width);
  await panel.getByTestId("frame-zoom").click();
  await page.getByRole("menuitemradio", { name: "100%" }).click();
  await expect.poll(width).toBe(390);
  await expect(page.getByRole("menu")).toBeHidden();
  await panel.getByTestId("frame-zoom").click();
  await page.getByRole("menuitemradio", { name: "Fit" }).click();
  await expect.poll(width).not.toBe(390);
});

// 30 slides with notes; slide 3 is skipped, the deck fades between slides.
const DECK = `<!doctype html><html><head><style>section{display:flex;align-items:center;justify-content:center;font:600 96px system-ui}</style></head>
<body data-transition="fade">${Array.from(
  { length: 30 },
  (_, i) =>
    `<section${i === 2 ? " data-skip" : ""}><h1>Topic ${i + 1}</h1><aside data-notes>Say point ${i + 1} slowly.</aside></section>`,
).join("\n")}</body></html>`;

test("a 30-slide deck with notes is reviewed and presented from two windows", async ({ page, human, daemon }) => {
  test.setTimeout(120_000);
  const { artifact, open } = await openThread({ page, human, daemon });
  await artifact({ identifier: "big-deck", type: "slides", title: "Big deck", body: DECK });
  await open();
  await page.getByTestId("artifact-card").click();
  const panel = page.getByTestId("artifact-panel");
  const frame = page.frameLocator('[data-testid="artifact-preview"]');

  // Preview cards: every slide listed, only the visible ones live, at most 12.
  const rail = panel.getByRole("navigation", { name: "Slides" });
  await expect(rail.getByRole("button")).toHaveCount(30);
  const counter = activeSlide(panel);
  await expect(rail.getByRole("button", { name: /^3\s*Topic 3\s*Skipped$/ })).toBeVisible();
  await expect(rail.locator("iframe").first()).toBeAttached();
  expect(await rail.locator("iframe").count()).toBeLessThanOrEqual(12);
  // A card is the same sandboxed document, inert.
  await expect(rail.locator("iframe").first()).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-pointer-lock");
  await expect(rail.locator("iframe").first()).toHaveAttribute("inert", "");

  // Notes show under the slide, never on it.
  await expect(panel.getByTestId("speaker-notes")).toContainText("Say point 1 slowly.");
  await expect(frame.getByText("Topic 1", { exact: true })).toBeVisible();
  await expect(frame.getByText("Say point 1 slowly.")).toBeHidden();

  // Grid view: the same cards; a click opens the slide.
  await panel.getByRole("button", { name: "Grid view" }).click();
  const grid = panel.getByTestId("frame-grid");
  // The same button now leads back.
  await expect(panel.getByRole("button", { name: "Single view" })).toBeVisible();
  await grid.getByRole("button", { name: /^5\s*Topic 5$/ }).click();
  await expect(grid).toBeHidden();
  await expect(counter).toHaveText(/^5\D/);
  await expect(frame.getByText("Topic 5", { exact: true })).toBeVisible();

  // Zoom keys while focus is on the rail or the stage.
  await rail.getByRole("button", { name: /^5\s*Topic 5$/ }).focus();
  await page.keyboard.press("ControlOrMeta+=");
  await expect(panel.getByTestId("frame-zoom")).toHaveText("100%");
  await page.keyboard.press("ControlOrMeta+=");
  await expect(panel.getByTestId("frame-zoom")).toHaveText("200%");
  await page.keyboard.press("ControlOrMeta+0");
  await expect(panel.getByTestId("frame-zoom")).toHaveText("Fit");

  // Present from the start: the skipped slide is left out, digits jump, Esc ends.
  await panel.getByRole("button", { name: "Present", exact: true }).click();
  await page.getByRole("menuitem", { name: "Present from the start" }).click();
  await expect(counter).toHaveText(/^1\D/);
  await expect(panel.getByRole("button", { name: "End presentation" })).toBeAttached();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect(counter).toHaveText(/^4\D/);
  await page.keyboard.press("ArrowUp");
  await expect(counter).toHaveText(/^2\D/);
  await page.keyboard.press("3");
  await expect(counter).toHaveText(/^4\D/);
  await page.keyboard.press("End");
  await expect(counter).toHaveText(/^30\D/);
  const fullscreen = () => page.evaluate(() => document.fullscreenElement !== null);
  await expect.poll(fullscreen).toBe(true);
  // F leaves fullscreen and keeps presenting; Esc then ends.
  await page.keyboard.press("f");
  await expect.poll(fullscreen).toBe(false);
  await expect(panel.getByRole("button", { name: "End presentation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("button", { name: "End presentation" })).toBeHidden();

  // Present with speaker notes: a second window with notes and the next slide drives this one.
  await rail.getByRole("button", { name: /^2\s*Topic 2$/ }).click();
  const [presenter] = await Promise.all([
    page.waitForEvent("popup"),
    (async () => {
      await panel.getByRole("button", { name: "Present", exact: true }).click();
      await page.getByRole("menuitem", { name: "Present with speaker notes" }).click();
    })(),
  ]);
  await expect(presenter.getByTestId("presenter-notes")).toHaveText("Say point 2 slowly.");
  await expect(presenter.getByRole("heading", { name: "Slide 2 of 30: Topic 2" })).toBeVisible();
  await expect(presenter.getByTestId("presenter-timer")).toContainText("Elapsed 0:0");
  // Its slides are sandboxed frames too.
  await expect(presenter.locator("iframe")).toHaveCount(2);
  expect(await presenter.frameLocator("iframe").first().locator("body").evaluate(() => window.origin)).toBe("null");
  await presenter.getByRole("button", { name: "Next" }).click();
  await expect(counter).toHaveText(/^4\D/);
  await expect(presenter.getByTestId("presenter-notes")).toHaveText("Say point 4 slowly.");
  await presenter.keyboard.press("ArrowLeft");
  await expect(counter).toHaveText(/^2\D/);
  await expect(frame.getByText("Topic 2", { exact: true })).toBeVisible();
  // Ending the presentation closes the presenter window.
  const closed = presenter.waitForEvent("close");
  await panel.getByRole("button", { name: "End presentation" }).click();
  await closed;
});

test("a slides artifact exports a PDF through a short-lived print frame", async ({ page, human, daemon }) => {
  const { artifact, open } = await openThread({ page, human, daemon });
  await artifact({ identifier: "launch-deck", type: "slides", title: "Launch deck", body: SLIDES });
  await open();
  await page.getByTestId("artifact-card").click();
  // Stub print in every new frame: the print frame calls it itself, after laying out pages.
  await page.addInitScript(() => {
    window.print = () =>
      console.log(`print called: ${getComputedStyle(document.querySelector("section")!).getPropertyValue("page")}`);
  });
  const printed = page.waitForEvent("console", (m) => m.text().startsWith("print called"));
  await page.getByRole("button", { name: "Export as PDF" }).click();
  expect((await printed).text()).toBe("print called: p0");
  // Gone once the dialog closed; the preview frame never gets `allow-modals`.
  await expect(page.locator('iframe[title="PDF export"]')).toHaveCount(0);
  await expect(page.getByTestId("artifact-preview")).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-pointer-lock");
});

const DESIGN_SYSTEM = JSON.stringify({
  overview: "# Northwind\n\nOne strong accent, quiet surfaces.",
  colors: [
    { name: "brand", value: "rgb(51, 85, 255)", description: "Primary actions" },
    { name: "ink", value: "rgb(20, 20, 19)" },
  ],
  spacing: [{ name: "sm", value: "8px" }],
  components: [
    {
      name: "Button",
      // The image must not load: the frame has no network.
      html: '<button style="background:var(--color-brand);color:white;padding:var(--spacing-sm)">Save</button><img alt="" src="https://example.com/pixel.png">',
    },
  ],
});

test("a design-system artifact shows its sections, and Add puts a value in the reply", async ({
  page,
  human,
  daemon,
}) => {
  const { artifact, open } = await openThread({ page, human, daemon });
  await artifact({ identifier: "tokens", type: "design-system", title: "Tokens", body: DESIGN_SYSTEM });
  await open();

  const card = page.getByTestId("artifact-card");
  await expect(card).toContainText("Design system");
  await card.click();
  const panel = page.getByTestId("artifact-panel");
  const nav = panel.getByRole("navigation", { name: "Design system sections" });
  await expect(nav.getByRole("button")).toHaveText(["Overview", "Colors2", "Spacing1", "Components1"]);
  await expect(nav.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "true");
  await expect(panel.getByRole("heading", { name: "Northwind" })).toBeVisible();

  // The browser reports a CSP-blocked request as a failed one: nothing from the frame may complete.
  const completed: string[] = [];
  page.on("requestfinished", (r) => {
    if (r.frame() !== page.mainFrame()) completed.push(r.url());
  });
  const blockedImage = page.waitForEvent("requestfailed", (r) => r.url().endsWith("/pixel.png"));
  const frame = page.frameLocator('[data-testid="artifact-preview"]');
  await nav.getByRole("button", { name: /Colors/ }).click();
  await expect(frame.locator("#color-brand")).toContainText("rgb(51, 85, 255)");
  await expect(frame.locator("#color-ink")).toBeVisible();
  expect(await frame.locator("body").evaluate(() => window.origin)).toBe("null");

  // Annotate names the token by its id.
  await panel.getByRole("button", { name: "Annotate" }).click();
  await frame.locator("#color-brand .name").click();
  await expect(page.getByTestId("artifact-annotation-bar")).toContainText("div#color-brand");
  // Another section is another document: the pick goes.
  await nav.getByRole("button", { name: /Components/ }).click();
  await expect(page.getByTestId("artifact-annotation-bar")).not.toContainText("div#color-brand");
  await panel.getByRole("button", { name: "Stop annotating" }).click();
  await expect(frame.getByRole("button", { name: "Save" })).toBeVisible();
  expect((await blockedImage).failure()?.errorText).toBe("csp");
  expect(completed).toEqual([]);

  await nav.getByRole("button", { name: /Colors/ }).click();
  const add = panel.getByRole("form", { name: "Add to colors" });
  await add.getByLabel("Name").fill("accent");
  await add.getByLabel("Value").fill("rgb(255, 0, 0)");
  await add.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Added to your reply")).toBeVisible();
  await expect(
    page.getByTestId("thread-pane").getByRole("list", { name: /artifact annotations/i }),
  ).toContainText('Colors: "accent: rgb(255, 0, 0)"');

  // Content that is not a JSON object: a message in Preview, the source in Code.
  await artifact({ identifier: "broken", type: "design-system", title: "Broken", body: "{not json" });
  await expect(panel.getByRole("heading", { name: "Broken" })).toBeVisible();
  await expect(panel).toContainText("This design system can't be shown: its content is not a valid JSON object.");
  await panel.getByTestId("artifact-tab-code").click();
  await expect(panel.getByRole("button", { name: "Show preview" })).toBeVisible();
  await expect(panel).toContainText("{not json");
});
