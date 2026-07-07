import { type Browser, expect, type Page } from "@playwright/test";
import { createTeakClient } from "@teak/convex/sdk";
import { env, requirePassword, uniqueEmail } from "./env";
import { waitForEmail } from "./mailpit";
import { type AccountState, rememberAccount, updateState } from "./run-state";

export const clientFor = (apiKey: string) =>
  createTeakClient({
    baseUrl: env.apiUrl,
    tokenProvider: { getAccessToken: async () => apiKey },
    userAgent: "teak-prod-e2e",
  });

export const appPath = (path: string) => new URL(path, env.appUrl).toString();

export const newAnonymousContext = (browser: Browser) =>
  browser.newContext({ storageState: { cookies: [], origins: [] } });

const settingsRow = (page: Page, label: string) =>
  page
    .getByText(label, { exact: true })
    .locator("xpath=ancestor::div[.//button][1]");

export const signIn = async (
  page: Page,
  email: string,
  password = requirePassword()
) => {
  await page.goto(appPath("/login"));
  const emailInput = page.getByLabel("Email");
  const canSignIn = await emailInput
    .waitFor({ state: "visible", timeout: 5000 })
    .then(
      () => true,
      () => false
    );
  if (!canSignIn) {
    await expect(page.getByPlaceholder(/Write a note/i)).toBeVisible();
    return;
  }
  await emailInput.fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /login|sign in/i }).click();
  await expect(page.getByPlaceholder(/Write a note/i)).toBeVisible();
};

export const passwordFor = (account: AccountState) =>
  account.passwordReset ? `${requirePassword()}Reset1!` : requirePassword();

export const signUp = async (page: Page, email = uniqueEmail()) => {
  await page.goto(appPath("/register"));
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(requirePassword());
  await page
    .getByRole("button", { name: /create an account|sign up/i })
    .click();
  const verificationMessages = page.getByText(
    `Verification email sent to ${email}`
  );
  await expect
    .poll(
      async () => {
        const count = await verificationMessages.count();
        for (let index = 0; index < count; index += 1) {
          if (await verificationMessages.nth(index).isVisible()) {
            return true;
          }
        }
        return false;
      },
      { timeout: 15_000 }
    )
    .toBe(true);
  await page.goto(await waitForEmail(email, "Verify your email address"));
  await expect(page.getByPlaceholder(/Write a note/i)).toBeVisible();
  return email;
};

export const generateApiKey = async (page: Page) => {
  await page.goto(appPath("/settings"));
  await page.getByText("API Keys").waitFor();
  await settingsRow(page, "API Keys")
    .getByRole("button", { name: "Manage" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Manage API Keys" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Generate Key" }).click();
  const input = page.locator('input[readonly][value^="teakapi_"]').first();
  await expect(input).toHaveValue(/^teakapi_/);
  return input.inputValue();
};

export const createAccount = async (page: Page, label = "acct") => {
  const email = await signUp(page, uniqueEmail(label));
  const apiKey = await generateApiKey(page);
  const account = { email, apiKey };
  rememberAccount(account);
  return account;
};

export const deleteAccountViaUi = async (page: Page, account: AccountState) => {
  if (account.deleted) {
    return;
  }
  await signIn(page, account.email, passwordFor(account));
  await page.goto(appPath("/settings"));
  await page.getByRole("button", { name: /delete your account/i }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete Account" })
  ).toBeVisible();
  await page.locator("#deleteConfirm").fill("delete account");
  await page.getByRole("button", { name: "Delete account" }).click();
  if (account.apiKey) {
    await expect
      .poll(
        async () =>
          (
            await fetch(`${env.apiUrl}/v1/tags`, {
              headers: { Authorization: `Bearer ${account.apiKey}` },
            })
          ).status,
        { timeout: 30_000 }
      )
      .toBe(401);
  }
  await page
    .waitForURL(/\/login/, { timeout: account.apiKey ? 10_000 : 30_000 })
    .catch(async (error: unknown) => {
      if (!account.apiKey) {
        throw error;
      }
      await page.context().clearCookies();
      await page.goto(appPath("/login"));
    });
  updateState((state) => {
    for (const saved of state.accounts) {
      if (saved.email === account.email) {
        saved.deleted = true;
      }
    }
    if (state.primary?.email === account.email) {
      state.primary.deleted = true;
    }
  });
};

export const revokeVisibleKey = async (page: Page, rawKey: string) => {
  const visiblePrefix = rawKey.split("_").slice(0, 4).join("_");
  await page.goto(appPath("/settings"));
  await settingsRow(page, "API Keys")
    .getByRole("button", { name: "Manage" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Manage API Keys" });
  const row = dialog
    .locator("div")
    .filter({
      has: page.getByRole("button", { name: "Revoke" }),
      hasText: visiblePrefix,
    })
    .last();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(
    dialog
      .locator("div")
      .filter({ hasText: visiblePrefix })
      .filter({ hasText: /revoked/i })
      .last()
  ).toBeVisible();
};
