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

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** The open slide's card in the rail; its text starts with the slide number. */
const activeSlide = (panel: ReturnType<Page["getByTestId"]>) =>
  panel.getByRole("navigation", { name: "Slides" }).locator("[aria-current]");

/** The cards' select buttons: their names start with the frame number (menu buttons and Add do not). */
const cards = (rail: ReturnType<Page["getByTestId"]>) => rail.getByRole("button", { name: /^\d/ });

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
      ) => Promise<{ event_id: string }>
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
  // In the replies: the composer may still hold the text for a moment after the send.
  await expect(threadPane.getByTestId("message-thread-replies").getByText("please", { exact: true })).toBeVisible();

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
  await expect(cards(rail)).toHaveText(["1Launch plan", "2Why now", "3Pricing"]);
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
  // Keys pressed inside the frame come back to the panel. A click selects the layer (the
  // canvas editor), where Home selects the first layer: Esc clears it first.
  await frame.getByText("Third slide text").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Home");
  await expect(activeSlide(panel)).toHaveText(/^1\D/);

  await artifact({ identifier: "checkout", type: "design", title: "Checkout", body: DESIGN });
  await expect(panel.getByRole("heading", { name: "Checkout" })).toBeVisible();
  const screens = panel.getByRole("navigation", { name: "Screens" });
  await screens.getByRole("button", { name: /Phone/ }).click();
  // Every artboard sits in one row (spec §6.3); the screen list centres the one it selects.
  await expect(frame.getByText("Phone screen")).toBeVisible();
  await expect(frame.getByText("Home screen")).toBeVisible();
  const centred = (n: number) =>
    frame.locator(`body > section:nth-of-type(${n})`).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return Math.abs(r.left + r.width / 2 - document.documentElement.clientWidth / 2) < 2;
    });
  await expect.poll(() => centred(2)).toBe(true);
  await screens.getByRole("button", { name: /Home/ }).click();
  await expect.poll(() => centred(1)).toBe(true);
  await screens.getByRole("button", { name: /Phone/ }).click();
  await expect.poll(() => centred(2)).toBe(true);
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
  await expect(cards(rail)).toHaveCount(30);
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

test("a design-system artifact shows its sections, and a member adds and edits values in place", async ({
  page,
  human,
  daemon,
}) => {
  const { roomId, artifact, open } = await openThread({ page, human, daemon });
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

  // A member with edit rights: Add writes a version instead of annotating (spec §9.1, level 2).
  await nav.getByRole("button", { name: /Colors/ }).click();
  const add = panel.getByRole("form", { name: "Add to colors" });
  await add.getByLabel("Name").fill("accent");
  await add.getByLabel("Value").fill("rgb(255, 0, 0)");
  await add.getByRole("button", { name: "Add" }).click();
  await expect(frame.locator("#color-accent")).toContainText("rgb(255, 0, 0)");
  const added = await daemon.waitForMessage(
    roomId,
    (e) => e.type === "dev.fabrium.artifact.version" && e.sender === human.userId,
  );
  expect(added.content).toMatchObject({ identifier: "tokens", type: "design-system", summary: "Added accent to Colors" });
  expect(JSON.parse((added.content as { body: string }).body).colors[2]).toEqual({ name: "accent", value: "rgb(255, 0, 0)" });

  // Edit mode: a value changes in place and autosaves into the same version.
  await panel.getByRole("button", { name: "Edit" }).click();
  await panel.getByLabel("Value of ink").fill("rgb(1, 2, 3)");
  await panel.getByLabel("Value of ink").press("Enter");
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(frame.locator("#color-ink")).toContainText("rgb(1, 2, 3)");
  await expect(panel.getByTestId("artifact-versions")).toHaveText(/v1 of 1/);

  // Content that is not a JSON object: a message in Preview, the source in Code.
  await artifact({ identifier: "broken", type: "design-system", title: "Broken", body: "{not json" });
  await expect(panel.getByRole("heading", { name: "Broken" })).toBeVisible();
  await expect(panel).toContainText("This design system can't be shown: its content is not a valid JSON object.");
  await panel.getByTestId("artifact-tab-code").click();
  await expect(panel.getByRole("button", { name: "Show preview" })).toBeVisible();
  await expect(panel).toContainText("{not json");
});

type Event = { type: string; sender: string; event_id: string; content: Record<string, unknown> };

test("the user's edits autosave into the current version, and the agent's next version keeps them", async ({
  page,
  human,
  daemon,
}) => {
  test.setTimeout(120_000);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const { roomId, artifact, open } = await openThread({ page, human, daemon });
  const { event_id: v1 } = await artifact({ identifier: "launch-deck", type: "slides", title: "Launch deck", body: SLIDES });
  await open();
  await page.getByTestId("artifact-card").click();
  const panel = page.getByTestId("artifact-panel");
  const rail = panel.getByRole("navigation", { name: "Slides" });
  await expect(cards(rail)).toHaveText(["1Launch plan", "2Why now", "3Pricing"]);
  /** The user's version with this summary, other than the ones in `seen`. */
  const userVersion = (summary: string, seen: string[] = []) =>
    daemon.waitForMessage(
      roomId,
      (e) =>
        e.type === "dev.fabrium.artifact.version" &&
        e.sender === human.userId &&
        (e.content as Event["content"]).summary === summary &&
        !seen.includes(e.event_id),
    ) as Promise<Event>;

  const threadCards = page.getByTestId("thread-pane").getByTestId("artifact-card");
  const versionCount = panel.getByTestId("artifact-versions");

  // The slide menu's Move up; the save goes out after the idle time, as the user, and
  // folds into v1: no new version, no new card in the thread.
  await rail.getByRole("button", { name: "Slide 3 actions" }).click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect(cards(rail)).toHaveText(["1Launch plan", "2Pricing", "3Why now"]);
  const v2 = await userVersion("Moved slide 3");
  expect(v2.content).toMatchObject({ identifier: "launch-deck", type: "slides", title: "Launch deck", based_on: v1 });
  expect(v2.content["m.relates_to"]).toMatchObject({ rel_type: "m.thread" });
  await expect(versionCount).toHaveText(/v1 of 1/);
  await expect(threadCards).toHaveCount(1);

  // Delete on a card, undone before it is sent: nothing goes out.
  await cards(rail).nth(2).focus();
  await page.keyboard.press("Delete");
  await expect(cards(rail)).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(cards(rail)).toHaveText(["1Launch plan", "2Pricing", "3Why now"]);

  // Right-click opens the same menu: skip the first slide.
  await cards(rail).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Skip slide" }).click();
  await expect(cards(rail).first()).toHaveText(/Skipped/);
  const v3 = await userVersion("Skipped slide 1");
  expect(v3.content.based_on).toBe(v2.event_id);

  // Undo past what was sent sends the older content; redo brings the skip back.
  await cards(rail).first().focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(cards(rail).first()).not.toHaveText(/Skipped/);
  await userVersion("Undid: Skipped slide 1");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(cards(rail).first()).toHaveText(/Skipped/);
  const v5 = await userVersion("Skipped slide 1", [v3.event_id]);

  // Still one version: the list shows the agent's v1, edited by the user.
  await expect(versionCount).toHaveText(/v1 of 1/);
  await expect(threadCards).toHaveCount(1);
  await versionCount.click();
  const list = page.getByRole("menu");
  await expect(list.getByRole("menuitemradio")).toHaveCount(1);
  await expect(list.getByRole("menuitemradio")).toContainText("agent");
  await expect(list.getByRole("menuitemradio")).toContainText(`Edited by${human.username}`);
  await expect(list.getByRole("menuitemradio")).toContainText("Last of 4 edits: Skipped slide 1");
  await page.keyboard.press("Escape");

  // The agent edits slide 2 of the user's latest version (as `edits` would).
  const body = v5.content.body as string;
  expect(body).toContain("Third slide text");
  await artifact({
    identifier: "launch-deck",
    type: "slides",
    title: "Launch deck",
    body: body.replace("Third slide text", "Agent text"),
    based_on: v5.event_id,
    summary: "Edited slide 2",
  });
  // A new version: it keeps both of the user's changes, and the panel jumps to the slide it changed.
  await expect(versionCount).toHaveText(/v2 of 2/);
  await expect(threadCards).toHaveCount(2);
  await expect(cards(rail)).toHaveText(["1Launch planSkipped", /^2Pricing/, "3Why now"]);
  await expect(activeSlide(panel)).toHaveText(/^2Pricing/);
  await expect(page.frameLocator('[data-testid="artifact-preview"]').getByText("Agent text")).toBeVisible();
  await expect(cards(rail).nth(1)).toHaveText(/Changed/);
  await expect(panel.getByTestId("artifact-older-base")).toBeHidden();

  // Copy slide 2 and paste it after slide 3.
  await rail.getByRole("button", { name: "Slide 2 actions" }).click();
  await page.getByRole("menuitem", { name: "Copy" }).click();
  await rail.getByRole("button", { name: "Slide 3 actions" }).click();
  await page.getByRole("menuitem", { name: "Paste after" }).click();
  await expect(cards(rail)).toHaveText(["1Launch planSkipped", /^2Pricing/, "3Why now", "4Pricing"]);
  await userVersion("Pasted slide 4");
  await expect(versionCount).toHaveText(/v2 of 2/);

  // A version made from an older one gets the notice and the way to the diff.
  await artifact({ identifier: "launch-deck", type: "slides", title: "Launch deck", body: SLIDES, based_on: v1 });
  await expect(panel.getByTestId("artifact-older-base")).toContainText("Made from an older version (v1)");
  await panel.getByTestId("artifact-older-base").getByRole("button", { name: "Show changes" }).click();
  await expect(panel.getByText(/v2 → v3/)).toBeVisible();
});

test("speaker notes are edited under the slide and autosaved", async ({ page, human, daemon }) => {
  const { roomId, artifact, open } = await openThread({ page, human, daemon });
  await artifact({ identifier: "launch-deck", type: "slides", title: "Launch deck", body: SLIDES });
  await open();
  await page.getByTestId("artifact-card").click();
  const notes = page.getByTestId("speaker-notes").getByLabel("Speaker notes");
  await notes.fill("Open with the launch date.");
  const sent = await daemon.waitForMessage(
    roomId,
    (e) => e.type === "dev.fabrium.artifact.version" && e.sender === human.userId,
  );
  expect((sent.content as { summary: string }).summary).toBe("Edited the notes on slide 1");
  expect((sent.content as { body: string }).body).toContain("<aside data-notes=\"\">Open with the launch date.</aside>");
});

/** The user's version of `identifier` with this summary, waited for in the room. */
const userVersionOf =
  (daemon: DaemonImpersonator, roomId: string, human: FreshHuman) =>
  (summary: string, identifier = "launch-deck") =>
    daemon.waitForMessage(
      roomId,
      (e) =>
        e.type === "dev.fabrium.artifact.version" &&
        e.sender === human.userId &&
        (e.content as Event["content"]).identifier === identifier &&
        (e.content as Event["content"]).summary === summary,
    ) as Promise<Event>;

test("the slide menu renames by dialog, Shift+F10 opens it, a drag reorders, and the title menu restores and duplicates", async ({
  page,
  human,
  daemon,
}) => {
  test.setTimeout(120_000);
  const { roomId, artifact, open } = await openThread({ page, human, daemon });
  await artifact({ identifier: "launch-deck", type: "slides", title: "Launch deck", body: SLIDES });
  await open();
  await page.getByTestId("artifact-card").click();
  const panel = page.getByTestId("artifact-panel");
  const rail = panel.getByRole("navigation", { name: "Slides" });
  const userVersion = userVersionOf(daemon, roomId, human);
  await expect(cards(rail)).toHaveText(["1Launch plan", "2Why now", "3Pricing"]);

  // Shift+F10 on a focused card opens its menu; Rename opens the dialog.
  await cards(rail).nth(1).focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menuitem", { name: "Add slide after" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Rename slide…" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename slide 2" });
  await expect(dialog.getByLabel("Name")).toHaveValue("Why now");
  await dialog.getByLabel("Name").fill("The problem");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(cards(rail)).toHaveText(["1Launch plan", "2The problem", "3Pricing"]);
  const renamed = await userVersion("Renamed slide 2");
  expect(renamed.content.body).toContain('<section data-title="The problem">');

  // Drag the first card onto the last.
  await cards(rail).first().dragTo(cards(rail).last());
  await expect(cards(rail)).toHaveText(["1The problem", "2Pricing", "3Launch plan"]);
  const dragged = await userVersion("Moved slide 1");
  await expect(panel.getByTestId("artifact-versions")).toHaveText(/v1 of 1/);

  // The agent makes v2. Restore v1 (as the user edited it) from the version list: a save
  // into v2, by the user, with v1's content; still two versions.
  const { event_id: v2 } = await artifact({
    identifier: "launch-deck",
    type: "slides",
    title: "Launch deck",
    body: SLIDES.replace("Third slide text", "Agent text"),
    based_on: dragged.event_id,
  });
  await expect(panel.getByTestId("artifact-versions")).toHaveText(/v2 of 2/);
  await panel.getByTestId("artifact-versions").click();
  await page.getByRole("menuitemradio", { name: /^v1/ }).click();
  await expect(panel.getByTestId("artifact-versions")).toHaveText(/v1 of 2/);
  await expect(cards(rail)).toHaveText(["1The problem", "2Pricing", "3Launch plan"]);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await panel.getByTestId("artifact-title-menu").click();
  await page.getByRole("menuitem", { name: "Restore this version" }).click();
  const restored = await userVersion("Restored v1");
  expect(restored.content.body).toBe(dragged.content.body);
  expect(restored.content.based_on).toBe(v2);
  await expect(panel.getByTestId("artifact-versions")).toHaveText(/v2 of 2/);
  await expect(cards(rail)).toHaveText(["1The problem", "2Pricing", "3Launch plan"]);
  await expect(page.getByTestId("thread-pane").getByTestId("artifact-card")).toHaveCount(2);

  // Duplicate: a second artifact with the same content, opened in the panel.
  // The Restore menu must be gone first: a click during its exit animation counts as outside it.
  await expect(page.getByRole("menu")).toHaveCount(0);
  await panel.getByTestId("artifact-title-menu").click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  const copy = await userVersion("Duplicated from Launch deck v2", "launch-deck-copy");
  expect(copy.content).toMatchObject({
    title: "Launch deck (copy)",
    type: "slides",
    body: dragged.content.body,
    based_on: restored.event_id,
  });
  await expect(panel.getByRole("heading", { name: "Launch deck (copy)" })).toBeVisible();
  await expect(panel.getByTestId("artifact-versions")).toHaveText(/v1 of 1/);
  await expect(page).toHaveURL(/artifact=launch-deck-copy/);
});

test("the artboard menu adds an artboard from a preset and resizes one through the size dialog", async ({
  page,
  human,
  daemon,
}) => {
  const { roomId, artifact, open } = await openThread({ page, human, daemon });
  await artifact({ identifier: "checkout", type: "design", title: "Checkout", body: DESIGN });
  await open();
  await page.getByTestId("artifact-card").click();
  const screens = page.getByTestId("artifact-panel").getByRole("navigation", { name: "Screens" });
  const userVersion = userVersionOf(daemon, roomId, human);

  await screens.getByRole("button", { name: "Artboard 1 actions" }).click();
  await page.getByRole("menuitem", { name: "Add artboard" }).click();
  await page.getByRole("menuitem", { name: /^Tablet/ }).click();
  await expect(cards(screens)).toHaveCount(3);
  const added = await userVersion("Added artboard 2", "checkout");
  // A blank artboard of the preset's size.
  expect(added.content.body).toContain('<section data-width="834" data-height="1194"></section>');

  await screens.getByRole("button", { name: "Artboard 3 actions" }).click();
  await page.getByRole("menuitem", { name: "Resize" }).click();
  await page.getByRole("menuitem", { name: "Custom…" }).click();
  const dialog = page.getByRole("dialog", { name: "Resize artboard 3" });
  await expect(dialog.getByLabel("Width (px)")).toHaveValue("390");
  await dialog.getByLabel("Width (px)").fill("50");
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await dialog.getByLabel("Width (px)").fill("800");
  await dialog.getByLabel("Height (px)").fill("600");
  await dialog.getByRole("button", { name: "Save" }).click();
  const resized = await userVersion("Resized artboard 3 to 800×600", "checkout");
  expect(resized.content.body).toContain('<section data-name="Phone" data-width="800" data-height="600">');
});

test("on a phone the open slide's menu sits in the toolbar", async ({ page, human, daemon }) => {
  const { roomId, artifact } = await openThread({ page, human, daemon });
  await artifact({ identifier: "launch-deck", type: "slides", title: "Launch deck", body: SLIDES });
  await page.setViewportSize({ width: 390, height: 844 });
  const root = (await daemon.waitForMessage(roomId, (e) => e.type === "dev.fabrium.artifact.version")).content as {
    "m.relates_to": { event_id: string };
  };
  await page.goto(`/room/${roomId}?thread=${encodeURIComponent(root["m.relates_to"].event_id)}&artifact=launch-deck`);
  const panel = page.getByTestId("artifact-panel");
  await expect(panel.getByRole("navigation", { name: "Slides" })).toBeHidden();
  await panel.getByTestId("artifact-toolbar").getByRole("button", { name: "Slide 1 actions" }).click();
  await page.getByRole("menuitem", { name: "Skip slide" }).click();
  const skipped = await userVersionOf(daemon, roomId, human)("Skipped slide 1");
  expect(skipped.content.body).toContain('<section data-title="Launch plan" data-skip>');
  // Notes are edited on a phone too.
  await expect(panel.getByTestId("speaker-notes").getByLabel("Speaker notes")).toBeVisible();
});

// A deck whose agent wrote its own Table layout in its design.
const LAYOUT_SLIDES = SLIDES.replace(
  "</head>",
  '<template data-layout="table"><section class="deck-table"><h2>Agent table</h2><table><tr><td>Q1</td><td>Q2</td></tr></table></section></template></head>',
);

test("Add slide opens a layout picker in the deck's design and autosaves the chosen layout", async ({
  page,
  human,
  daemon,
}) => {
  test.setTimeout(90_000);
  const { roomId, artifact, open } = await openThread({ page, human, daemon });
  await artifact({ identifier: "launch-deck", type: "slides", title: "Launch deck", body: LAYOUT_SLIDES });
  await open();
  await page.getByTestId("artifact-card").click();
  const panel = page.getByTestId("artifact-panel");
  const rail = panel.getByRole("navigation", { name: "Slides" });
  const userVersion = userVersionOf(daemon, roomId, human);
  const threadCards = page.getByTestId("thread-pane").getByTestId("artifact-card");

  // From the end of the rail; ten layouts, each a sandboxed, inert preview.
  await rail.getByRole("button", { name: "Add slide" }).click();
  const picker = page.getByRole("dialog", { name: "Add slide" });
  const layouts = picker.getByRole("group", { name: "Layouts" });
  await expect(layouts.getByRole("button")).toHaveText([
    "Blank",
    "Title",
    "Section",
    "Title and body",
    "Bullets",
    "Two columns",
    "Table",
    "Quote",
    "Image and caption",
    "Closing",
  ]);
  await expect(layouts.locator("iframe")).toHaveCount(10);
  await expect(layouts.locator("iframe").first()).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-pointer-lock");
  await expect(layouts.locator("iframe").first()).toHaveAttribute("inert", "");
  // Arrow keys and Enter: five per row, so Down then Right lands on Table.
  await expect(layouts.getByRole("button", { name: "Blank" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await expect(layouts.getByRole("button", { name: "Table" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(picker).toBeHidden();
  // After the open slide (1), selected, in the agent's own layout.
  await expect(cards(rail)).toHaveText(["1Launch plan", "2Agent table", "3Why now", "4Pricing"]);
  await expect(activeSlide(panel)).toHaveText(/^2Agent table/);
  const fromTemplate = await userVersion("Added slide 2");
  expect(fromTemplate.content.body).toContain(
    '<section data-title="Launch plan"><h1>Welcome</h1></section>\n<section class="deck-table"><h2>Agent table</h2><table><tbody><tr><td>Q1</td><td>Q2</td></tr></tbody></table></section>',
  );
  await expect(panel.getByTestId("artifact-versions")).toHaveText(/v1 of 1/);
  await expect(threadCards).toHaveCount(1);

  // A deck without templates, from the slide menu: the app builds the layout from plain elements.
  await artifact({ identifier: "plain-deck", type: "slides", title: "Plain deck", body: SLIDES });
  await expect(panel.getByRole("heading", { name: "Plain deck" })).toBeVisible();
  await rail.getByRole("button", { name: "Slide 3 actions" }).click();
  await page.getByRole("menuitem", { name: "Add slide after" }).click();
  await picker.getByRole("button", { name: "Table" }).click();
  await expect(cards(rail)).toHaveText(["1Launch plan", "2Why now", "3Pricing", "4Slide title"]);
  const fallback = await userVersion("Added slide 4", "plain-deck");
  expect(fallback.content.body).toContain(
    "<section><h2>Slide title</h2><table><thead><tr><th>Heading</th><th>Heading</th><th>Heading</th></tr></thead>",
  );
  await expect(panel.getByTestId("artifact-versions")).toHaveText(/v1 of 1/);
  await expect(threadCards).toHaveCount(2);
});

test("a text box and an image inserted on the canvas, restyled, hold after a reload", async ({ page, human, daemon }) => {
  test.setTimeout(120_000);
  // A wide window: the canvas toolbar shows every tool inline beside the Properties panel.
  await page.setViewportSize({ width: 1920, height: 1080 });
  const { roomId, artifact, open } = await openThread({ page, human, daemon });
  await artifact({ identifier: "launch-deck", type: "slides", title: "Launch deck", body: SLIDES });
  await open();
  await page.getByTestId("artifact-card").click();
  const panel = page.getByTestId("artifact-panel");
  const frame = page.frameLocator('[data-testid="artifact-preview"]');
  await expect(frame.getByText("Welcome")).toBeVisible();

  // Text places a free layer in the middle of the slide, ready to retype.
  await panel.getByRole("toolbar", { name: "Canvas tools" }).getByRole("button", { name: "Text", exact: true }).click();
  const box = frame.locator('p[data-layer="Text"]');
  await expect(box).toHaveText("Text");
  await box.dblclick();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Hello canvas");
  await page.keyboard.press("Escape");
  await expect(box).toHaveText("Hello canvas");

  // Properties: the layer is listed and selected; a font size restyles it in place.
  await panel.getByRole("button", { name: "Properties" }).click();
  const props = page.getByTestId("style-inspector");
  await expect(props.getByTestId("layers-list").getByRole("button", { name: "Text", pressed: true })).toBeVisible();
  await props.getByLabel("Font size").fill("64");
  await expect(box).toHaveCSS("font-size", "64px");

  // The save holds the app's own copy of the source: no ids, the layer where it was placed.
  const saved = await daemon.waitForMessage(roomId, (e) => {
    const body = String((e.content as { body?: unknown }).body ?? "");
    return (
      e.type === "dev.fabrium.artifact.version" &&
      e.sender === human.userId &&
      body.includes("Hello canvas") &&
      body.includes("font-size: 64px")
    );
  });
  const body = (saved.content as { body: string }).body;
  expect(body).not.toContain("data-fab-id");
  expect(body).toMatch(
    /<p data-free="" data-layer="Text" style="position: absolute; left: 720px; top: 492px; [^"]*font-size: 64px;[^"]*">Hello canvas<\/p><\/section>/,
  );
  await expect(panel.getByTestId("artifact-versions")).toHaveText(/v1 of 1/);

  // After a reload the version still holds the text box.
  await page.reload();
  await expect(frame.locator('p[data-layer="Text"]')).toHaveText("Hello canvas");
  await expect(frame.locator('p[data-layer="Text"]')).toHaveCSS("font-size", "64px");

  // Image: uploaded through authenticated media, named by its mxc URI; the frame (no network)
  // shows the bytes the app posts in, as its own object URL.
  const tools = panel.getByRole("toolbar", { name: "Canvas tools" });
  const chooser = page.waitForEvent("filechooser");
  await tools.getByRole("button", { name: "Image", exact: true }).click();
  await (await chooser).setFiles({ name: "dot.png", mimeType: "image/png", buffer: TINY_PNG });
  const img = frame.locator('img[data-layer="Image"]');
  await expect(img).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);
  await props.getByLabel("Radius").fill("24");
  await expect(img).toHaveCSS("border-radius", "24px");
  const withImage = await daemon.waitForMessage(roomId, (e) => {
    const b = String((e.content as { body?: unknown }).body ?? "");
    return e.sender === human.userId && b.includes('<img src="mxc://') && b.includes("border-radius: 24px");
  });
  const imageBody = (withImage.content as { body: string }).body;
  expect(imageBody).toMatch(/<img src="mxc:\/\/[^"]+" alt="" data-free="" data-layer="Image" style="[^"]*border-radius: 24px;[^"]*">/);
  expect(imageBody).toContain("Hello canvas");
  const mxc = /<img src="(mxc:\/\/[^"]+)"/.exec(imageBody)![1]!;
  expect((await daemon.downloadMedia(mxc)).equals(TINY_PNG)).toBe(true);

  // Anything else dropped on the canvas is refused, at the stage: the frame never gets the file.
  const notMedia = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["hi"], "notes.txt", { type: "text/plain" }));
    return dt;
  });
  await page.getByTestId("artifact-preview").dispatchEvent("dragenter", { dataTransfer: notMedia });
  await page.getByTestId("canvas-drop").dispatchEvent("drop", { dataTransfer: notMedia });
  await expect(page.getByText("Only images and videos can be dropped here.")).toBeVisible();

  await page.reload();
  await expect(frame.locator('p[data-layer="Text"]')).toHaveText("Hello canvas");
  await expect(frame.locator('img[data-layer="Image"]')).toHaveAttribute("src", /^blob:/);
  await expect(frame.locator('img[data-layer="Image"]')).toHaveCSS("border-radius", "24px");

  // A script in the frame cannot edit as the user: an op it posts without a user gesture is dropped.
  const srcdoc = (await page.getByTestId("artifact-preview").getAttribute("srcdoc")) ?? "";
  const channel = /var CHANNEL = "([^"]+)"/.exec(srcdoc)![1]!;
  const id = await frame.locator('p[data-layer="Text"]').getAttribute("data-fab-id");
  await frame.locator("body").evaluate(
    (_, [ch, target]) =>
      parent.postMessage({ type: "fabrium.preview.op", channel: ch, detail: { ops: [{ kind: "delete", id: target }] } }, "*"),
    [channel, id] as const,
  );
  await page.waitForTimeout(1000);
  await expect(frame.locator('p[data-layer="Text"]')).toHaveText("Hello canvas");

  // An element the agent wrote in the flow moves anywhere by drag: an offset, its siblings stay put.
  const heading = frame.getByRole("heading", { name: "Welcome" });
  const hb = (await heading.boundingBox())!;
  await page.mouse.move(hb.x + 10, hb.y + 10);
  await page.mouse.down();
  await page.mouse.move(hb.x + 18, hb.y + 14, { steps: 8 });
  await page.mouse.up();
  const moved = await daemon.waitForMessage(roomId, (e) => {
    const b = String((e.content as { body?: unknown }).body ?? "");
    return e.sender === human.userId && /<h1 style="translate: -?\d+px( -?\d+px)?;">Welcome<\/h1>/.test(b);
  });
  expect((moved.content as { body: string }).body).not.toContain("data-free=\"\">Welcome");

  // Double-click puts a live caret where the pointer is: the frame has focus and the selection is collapsed in the heading.
  const nb = (await heading.boundingBox())!;
  // Near its left end: the text box from above sits over the heading's middle.
  await page.mouse.dblclick(nb.x + 12, nb.y + nb.height / 2);
  await expect
    .poll(() =>
      heading.evaluate((el) => {
        const s = getSelection()!;
        return document.hasFocus() && document.activeElement === el && s.isCollapsed && el.contains(s.anchorNode);
      }),
    )
    .toBe(true);
  await page.keyboard.press("Escape");

  // Align, its own menu: one flow layer aligns to the slide, by an offset.
  await page.keyboard.press("Escape");
  await page.mouse.click(nb.x + 12, nb.y + nb.height / 2);
  await tools.getByRole("button", { name: "Align" }).click();
  await page.getByRole("menuitem", { name: "Align left" }).click();
  const slideX = (await frame.locator("section").first().boundingBox())!.x;
  await expect.poll(async () => Math.abs((await heading.boundingBox())!.x - slideX)).toBeLessThan(1.5);

  // A narrow stage collapses the toolbar: the insert tools become a menu, inside the stage.
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(tools.getByRole("button", { name: "Text", exact: true })).toBeHidden();
  await expect(tools.getByRole("button", { name: "Insert" })).toBeVisible();
  await expect(tools.getByRole("button", { name: "Align" })).toBeVisible();
  const stage = (await page.getByTestId("artifact-preview").boundingBox())!;
  const bar = (await tools.boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(stage.x);
  expect(bar.x + bar.width).toBeLessThanOrEqual(stage.x + stage.width + 0.5);
});
