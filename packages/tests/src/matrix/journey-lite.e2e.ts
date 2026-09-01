import { expect, test } from "@playwright/test";
import { cleanupE2EAccounts } from "../helpers/e2e-cleanup";
import {
  clientFor,
  createAccount,
  fillAndSubmitTextCard,
} from "../helpers/prod";

test.setTimeout(180_000);

test("signup, create, and search", async ({ page }) => {
  const account = await createAccount(
    page,
    `matrix-${test.info().project.name}`,
    { remember: false }
  );
  try {
    const marker = `matrix-${Date.now()}`;
    await page.goto("/");
    await expect(
      page.getByText(
        "Welcome to Teak! Start capturing your thoughts, links, and inspiration.",
        { exact: true }
      )
    ).toBeVisible();
    await fillAndSubmitTextCard(page, marker);
    const api = clientFor(account.apiKey);
    await expect
      .poll(
        async () =>
          (await api.cards.search({ query: marker })).items.some(
            (card) => card.content === marker
          ),
        { timeout: 30_000, intervals: [1000, 2000, 3000, 5000] }
      )
      .toBe(true);
    const savedCard = page
      .getByRole("main")
      .getByRole("paragraph")
      .filter({ hasText: marker })
      .first();
    await expect(savedCard).toBeVisible();
    const search = page.getByPlaceholder("Search for anything...");
    await search.fill(`${marker}-missing`);
    await expect(savedCard).not.toBeVisible();
    await expect(page.getByText(/nothing found/i)).toBeVisible();
    await search.fill(marker);
    await expect(savedCard).toBeVisible();
  } finally {
    await page.context().close();
    await cleanupE2EAccounts([account.email]);
  }
});
