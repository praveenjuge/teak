import { expect, test } from "@playwright/test";
import { createAccount } from "../helpers/prod";

test.setTimeout(180_000);

test("signup, create, and search", async ({ page }) => {
  await createAccount(page, `matrix-${test.info().project.name}`);
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
  await expect(savedCard).toBeVisible();
});
