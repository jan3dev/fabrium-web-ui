import { HS_URL, expect, test } from "./fixtures/daemon-impersonator";

test("an open approval shows in the inbox and can be answered there", async ({
  page,
  human,
  daemon,
}) => {
  const roomId = await daemon.createRoomWithHuman(human.userId);
  const join = await fetch(
    `${HS_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${human.accessToken}` },
    },
  );
  expect(join.ok).toBeTruthy();

  const { approvalId, eventId } = await daemon.sendApprovalRequest(roomId, {
    sessionId: "s-inbox",
    toolCallId: "tc-inbox",
  });

  await page.goto("/login");
  await page.getByLabel(/username/i).fill(human.username);
  await page.getByLabel(/password/i).fill(human.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.getByRole("button", { name: /user menu/i }).waitFor();
  await page.goto("/inbox");

  const row = page.getByTestId(`inbox-item-${eventId}`);
  await expect(row).toContainText(/approval needed in/i);
  await row.getByRole("button", { name: /open inbox item/i }).click();

  const detail = page.getByTestId("inbox-detail");
  await expect(detail.getByTestId("approval-card")).toBeVisible();
  await detail.getByRole("button", { name: /allow/i }).click();

  const response = await daemon.waitForApprovalResponse(roomId, approvalId);
  expect(response.sender).toBe(human.userId);
  // The answered approval leaves the list but stays open in the detail pane.
  await expect(row).toHaveCount(0);
  await expect(detail.getByTestId("approval-card")).toContainText(
    /approved by/i,
  );
});
