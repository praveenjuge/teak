import { expect, test } from "@playwright/test";
import { requirePassword } from "../helpers/env";
import { waitForEmail } from "../helpers/mailpit";
import { signIn } from "../helpers/prod";
import { readState, updateState } from "../helpers/run-state";

test("password reset and Polar checkout entry", async ({ page }) => {
  const { primary } = readState();
  if (!primary?.email) {
    throw new Error("Missing primary account");
  }
  const nextPassword = `${requirePassword()}Reset1!`;
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(primary.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/Reset link sent/i)).toBeVisible();
  await page.goto(await waitForEmail(primary.email, "Reset your Password"));
  await page.locator("#password").fill(nextPassword);
  await page.locator("#password_confirmation").fill(nextPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("Your password has been updated")).toBeVisible();
  updateState((state) => {
    if (state.primary) {
      state.primary.passwordReset = true;
    }
    for (const account of state.accounts) {
      if (account.email === primary.email) {
        account.passwordReset = true;
      }
    }
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill(primary.email);
  await page.getByLabel("Password").fill(requirePassword());
  await page.getByRole("button", { name: /login|sign in/i }).click();
  await expect(page.getByText(/invalid|incorrect/i)).toBeVisible();
  await signIn(page, primary.email, nextPassword);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Upgrade" }).click();
  await expect(
    page.getByRole("dialog", { name: "Upgrade to Pro" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).first().click();
  await expect(
    page.frameLocator('iframe[src*="polar.sh"]').locator("body")
  ).toBeVisible();
});
