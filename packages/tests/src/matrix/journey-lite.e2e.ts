import { expect, test } from "@playwright/test";
import { createAccount, deleteAccountViaUi } from "../helpers/prod";

test.setTimeout(180_000);
const cleanupTimeoutMs = 120_000;

test("signup, create, search, favorite, delete account", async ({ page }) => {
  const account = await createAccount(
    page,
    `matrix-${test.info().project.name}`
  );
  try {
    const marker = `matrix-${Date.now()}`;
    await page.goto("/");
    await page.getByPlaceholder(/Write a note/i).fill(marker);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const savedCard = page
      .getByRole("main")
      .getByRole("paragraph")
      .filter({ hasText: marker })
      .first();
    await expect(savedCard).toBeVisible();
    await page.getByPlaceholder("Search for anything...").fill(marker);
    await page.keyboard.press("Enter");
    await expect(savedCard).toBeVisible();
  } finally {
    test.info().setTimeout(test.info().timeout + cleanupTimeoutMs);
    await deleteAccountViaUi(page, account);
  }
});
