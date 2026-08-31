import { expect, test } from "@playwright/test";
import { deleteAccountViaUi } from "../helpers/prod";
import { requireAccount } from "../helpers/run-state";

test("delete primary account through the web UI", async ({ page }) => {
  const primary = requireAccount("account");
  await deleteAccountViaUi(page, primary);
  await page.getByLabel("Email").fill(primary.email);
  await page.getByLabel("Password").fill(process.env.PROD_E2E_PASSWORD!);
  await page.getByRole("button", { name: /login|sign in/i }).click();
  await expect(page.getByText(/invalid|not found|unable/i)).toBeVisible();
});
