import { expect, test } from "@playwright/test";
import { createAccount, deleteAccountViaUi } from "../helpers/prod";

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
    await expect(page.getByRole("main").getByText(marker)).toBeVisible();
    await page.getByPlaceholder("Search for anything...").fill(marker);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main").getByText(marker)).toBeVisible();
  } finally {
    await deleteAccountViaUi(page, account);
  }
});
