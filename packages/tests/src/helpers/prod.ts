import { expect, type Page } from "@playwright/test";
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

export const signIn = async (
  page: Page,
  email: string,
  password = requirePassword()
) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /login|sign in/i }).click();
  await expect(page.getByPlaceholder(/Write a note/i)).toBeVisible();
};

export const passwordFor = (account: AccountState) =>
  account.passwordReset ? `${requirePassword()}Reset1!` : requirePassword();

export const signUp = async (page: Page, email = uniqueEmail()) => {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(requirePassword());
  await page
    .getByRole("button", { name: /create an account|sign up/i })
    .click();
  await expect(
    page.getByText(`Verification email sent to ${email}`)
  ).toBeVisible();
  await page.goto(await waitForEmail(email, "Verify your email address"));
  await expect(page.getByPlaceholder(/Write a note/i)).toBeVisible();
  return email;
};

export const generateApiKey = async (page: Page) => {
  await page.goto("/settings");
  await page.getByText("API Keys").waitFor();
  await page.getByRole("button", { name: "Manage" }).click();
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
  await page.goto("/settings");
  await page.getByRole("button", { name: /delete your account/i }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete Account" })
  ).toBeVisible();
  await page.locator("#deleteConfirm").fill("delete account");
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/login/);
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
  const suffix = rawKey.slice(-4);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Manage" }).click();
  const row = page.locator("div").filter({ hasText: suffix }).last();
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(row.getByText(/revoked/i)).toBeVisible();
};
