import { expect, test } from "@playwright/test";
import { cleanupE2EAccounts } from "../helpers/e2e-cleanup";
import { deleteMessagesFor } from "../helpers/mailpit";
import { clickVisibleControl, createAccount } from "../helpers/prod";

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
    const note = page.getByPlaceholder(/Write a note/i);
    await note.pressSequentially(marker);
    await expect(note).toHaveValue(marker);
    await clickVisibleControl(
      page.getByRole("button", { exact: true, name: "Save" })
    );
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
    await cleanupE2EAccounts([account.email]);
    await deleteMessagesFor(account.email);
  }
});
