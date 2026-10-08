import { HS_URL, expect, test } from "./fixtures/daemon-impersonator";

test("top search finds a message on the server and opens it in its room", async ({
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
  const word = `pineapple${Date.now()}`;
  const eventId = await daemon.sendText(roomId, `the ${word} report is ready`);

  await page.goto("/login");
  await page.getByLabel(/username/i).fill(human.username);
  await page.getByLabel(/password/i).fill(human.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.getByRole("button", { name: /user menu/i }).waitFor();

  await page.getByTestId("top-search-input").fill(word);
  const hit = page.getByTestId(`search-result-message-${eventId}`);
  await expect(hit).toContainText(word);
  await hit.click();

  await expect(page).toHaveURL(/\/room\/[^?]+\?event=/);
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(`/room/${roomId}`);
});
