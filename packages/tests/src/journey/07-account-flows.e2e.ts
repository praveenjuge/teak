import { expect, test } from "@playwright/test";
import { env, requirePassword } from "../helpers/env";
import { waitForEmail } from "../helpers/mailpit";
import {
  appPath,
  expectAuthEntry,
  newAnonymousContext,
  passwordFor,
  signIn,
} from "../helpers/prod";
import { requireAccount, updateState } from "../helpers/run-state";

test("scheduled email canary resets the password", async ({ browser }) => {
  // Allow the 180s email wait, composer recovery, and password-reset steps.
  test.setTimeout(300_000);
  test.skip(
    !env.emailDeliveryEnabled,
    "Real email delivery runs only in the nightly production canary"
  );
  const primary = requireAccount("account");
  const nextPassword = `${requirePassword()}Reset1!`;
  const context = await newAnonymousContext(browser);
  const page = await context.newPage();
  try {
    await page.goto(appPath("/forgot-password"));
    await page.getByLabel("Email").fill(primary.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/Reset link sent/i)).toBeVisible();
    await page.goto(await waitForEmail(primary.email, "Reset your Password"));
    await page.locator("#password").fill(nextPassword);
    await page.locator("#password_confirmation").fill(nextPassword);
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(
      page.getByText("Your password has been updated")
    ).toBeVisible();
    updateState((state) => {
      if (state.account) {
        state.account.passwordReset = true;
      }
      if (state.primary && state.primary.email === primary.email) {
        state.primary.passwordReset = true;
      }
      for (const account of state.accounts) {
        if (account.email === primary.email) {
          account.passwordReset = true;
        }
      }
    });
    await signIn(page, primary.email, requirePassword(), {
      failure: /invalid|incorrect/i,
    });
    await signIn(page, primary.email, nextPassword);
  } finally {
    await context.close();
  }
});

test("Polar checkout entry stays usable", async ({ browser }) => {
  const primary = requireAccount("account");
  const context = await newAnonymousContext(browser);
  const page = await context.newPage();
  try {
    await signIn(page, primary.email, passwordFor(primary));
    await page.goto(appPath("/settings"));
    await page.getByRole("button", { name: "Upgrade" }).click();
    await expect(
      page.getByRole("dialog", { name: "Upgrade to Pro" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).first().click();
    await expect(
      page.frameLocator('iframe[src*="polar.sh"]').locator("body")
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("signing out from settings returns to hosted sign-in without crashing", async ({
  browser,
}) => {
  const primary = requireAccount("account");
  const context = await newAnonymousContext(browser);
  const page = await context.newPage();
  try {
    await signIn(page, primary.email, passwordFor(primary));
    await page.goto(appPath("/settings"));

    // Regression: signing out here used to crash the page with a client error
    // ("This page couldn't load") instead of returning the user to login.
    await page.getByRole("button", { name: "Sign out", exact: true }).click();

    expect(await expectAuthEntry(page, "signin")).toBe("workos");
    await expect(page.getByText(/couldn't load/i)).toHaveCount(0);
  } finally {
    await context.close();
  }
});
