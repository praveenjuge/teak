import { clientFor, generateApiKey, revokeVisibleKey } from "../helpers/app";
import { readState, updateState } from "../helpers/run-state";
import { expect, test } from "../helpers/test";

test("web journey covers cards, search, settings, and a revoked key", async ({
  page,
}) => {
  const state = readState();
  const coreAccount = state.webCore ?? state.primary;
  if (!coreAccount?.apiKey) {
    throw new Error("Missing web-core API key");
  }
  const api = clientFor(coreAccount.apiKey);
  const marker = `e2e-${Date.now()}`;
  const rawMarkdown = `${marker} <script>alert("xss")</script>`;
  const expectedMarkdown = `${marker} &lt;script&gt;alert("xss")&lt;/script&gt;`;
  const dialogTrap: string[] = [];
  page.on("dialog", (dialog) => {
    dialogTrap.push(dialog.message());
    return dialog.dismiss();
  });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Markdown content" });
  await expect(composer).toBeVisible();
  await expect(
    page.getByText(/Welcome to Teak|Let's add your first card/i)
  ).toBeVisible();
  await composer.fill(rawMarkdown);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const savedCard = page.locator("main p").filter({ hasText: marker }).first();
  await expect(savedCard).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () =>
        (await api.cards.search({ query: marker })).items.find((card) =>
          card.content?.includes(marker)
        )?.content,
      { timeout: 30_000, intervals: [1000, 2000, 3000, 5000] }
    )
    .toBe(expectedMarkdown);
  await page.getByPlaceholder("Search for anything...").fill(marker);
  await page.keyboard.press("Enter");
  await expect(savedCard).toBeVisible();
  await page.getByRole("button", { name: "Clear All" }).click();

  const link = await api.cards.create({
    content: "https://example.com",
    tags: ["e2e"],
    source: "e2e",
  });
  const text = await api.cards.create({
    content: marker,
    tags: ["e2e"],
    source: "e2e",
  });
  await api.cards.setFavorite(text.cardId, true);
  updateState((s) => s.createdCardIds.push(link.cardId, text.cardId));

  await page.goto("/settings");
  await expect(page.getByText(coreAccount.email)).toBeVisible();
  await expect(page.getByText("Free Plan")).toBeVisible();
  const revokedKey = await generateApiKey(page);
  await revokeVisibleKey(page, revokedKey);
  updateState((s) => {
    s.revokedKey = revokedKey;
  });
  expect(dialogTrap).toEqual([]);
});

test("saving a color in the composer creates a palette card", async ({
  page,
}) => {
  // Regression: the web note composer forced type "text", which disabled
  // server-side classification, so colors stopped becoming palette cards.
  const state = readState();
  const coreAccount = state.webCore ?? state.primary;
  if (!coreAccount?.apiKey) {
    throw new Error("Missing web-core API key");
  }
  const hex = "#2050D0";

  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Markdown content" });
  await composer.fill(hex);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // The optimistic card appears immediately; classification runs server-side.
  await expect(
    page.locator("main").getByText(hex, { exact: true }).first()
  ).toBeVisible();

  // Poll the API until the composer-created card is classified as a palette.
  const api = clientFor(coreAccount.apiKey);
  await expect
    .poll(
      async () => {
        const result = await api.cards.search({ type: "palette" });
        return result.items.some((card) => card.content === hex);
      },
      { timeout: 30_000, intervals: [1000, 2000, 3000, 5000] }
    )
    .toBe(true);
});
