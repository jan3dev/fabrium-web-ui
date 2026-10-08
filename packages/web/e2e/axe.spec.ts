import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { HS_URL, expect, test } from "./fixtures/daemon-impersonator";

const AXE_PATH = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const BLOCKING = new Set(["serious", "critical"]);

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

    expect(found, found.join("\n\n")).toEqual([]);
  });
}
