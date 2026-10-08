import {
  type Browser,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { createTeakClient } from "@teak/convex/sdk";
import {
  createEmulatorUser,
  findEmulatorUser,
  waitForEmailedEvent,
} from "./emulator";
import { E2E_PASSWORD, env, uniqueEmail } from "./env";
import { type AccountState, rememberAccount, updateState } from "./run-state";

export const clientFor = (apiKey: string) =>
  createTeakClient({
    baseUrl: env.apiUrl,
    tokenProvider: { getAccessToken: async () => apiKey },
    userAgent: "teak-e2e",
  });

export const appPath = (path: string) => new URL(path, env.appUrl).toString();

export const newAnonymousContext = (browser: Browser) =>
  browser.newContext({ storageState: { cookies: [], origins: [] } });

const sleep = (delayMs: number) =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

const isRetryableActionabilityError = (error: unknown) =>
  error instanceof Error &&
  /element (is not stable|was detached)|Timeout .* exceeded|Timeout: \d+ms/.test(
    error.message
  );

// Firefox aborts a navigation when the previous one is still settling, for
// example the post-login redirect, and page.goto throws NS_BINDING_ABORTED.
// A second attempt lands normally, so retry only these abort errors.
const isAbortedNavigationError = (error: unknown) =>
  error instanceof Error &&
  /NS_BINDING_ABORTED|net::ERR_ABORTED|frame was detached/.test(error.message);

export const gotoApp = async (
  page: Page,
  path: string,
  wait: (delayMs: number) => Promise<unknown> = sleep
) => {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await page.goto(appPath(path));
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isAbortedNavigationError(error)) {
        throw error;
      }
      await wait(1000);
    }
  }
};

export const clickVisibleControl = async (
  locator: Locator,
  options: { timeout?: number } = {}
) => {
  const timeout = options.timeout ?? 15_000;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const target = locator.filter({ visible: true }).first();
    await expect(target).toBeVisible({ timeout });
    await expect(target).toBeEnabled({ timeout });

    try {
      await target.click({ timeout: Math.min(timeout, 5000) });
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isRetryableActionabilityError(error)) {
        throw error;
      }
    }
  }
};

export const fillAndSubmitTextCard = async (page: Page, content: string) => {
  const creationForm = page.locator('form[data-card-creation-status="ready"]');
  const editor = creationForm.getByRole("textbox", {
    name: "Markdown content",
  });
  await expect(async () => {
    await editor.fill(content);
    await expect(editor).toHaveText(content, { timeout: 5000 });
  }).toPass({ intervals: [250, 500, 1000], timeout: 30_000 });
  await clickVisibleControl(
    page
      .locator("form[data-card-creation-status]")
      .getByRole("button", { name: "Save", exact: true })
  );
};

const composerOf = (page: Page) =>
  page.getByRole("textbox", { name: "Markdown content", exact: true });

// The vault opens once the backend has the WorkOS webhook for this user. If
// the first bootstrap ran before the webhook landed, Teak offers a retry.
export const expectVault = async (page: Page) => {
  const composer = composerOf(page);
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(async () => {
    if (await retry.isVisible()) {
      await retry.click();
    }
    await expect(composer).toBeVisible({ timeout: 5000 });
  }).toPass({ intervals: [500, 1000, 2000], timeout: 45_000 });
};

const emulatorOrigin = new URL(env.emulatorUrl).origin;

// Sign-in is hosted by WorkOS (here, the emulator's AuthKit pages), never a
// Teak page. Teak's /login hands the browser straight to it.
export const expectHostedSignIn = async (page: Page) => {
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  expect(
    new URL(page.url()).origin,
    "Sign-in must happen on hosted AuthKit, not a Teak page"
  ).toBe(emulatorOrigin);
};

const submitHostedForm = (page: Page) =>
  page.getByRole("button", { name: "Continue", exact: true }).click();

const enterCredentials = async (
  page: Page,
  email: string,
  password: string
) => {
  await gotoApp(page, "/login");
  await expectHostedSignIn(page);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await submitHostedForm(page);
  const passwordInput = page.getByLabel("Password", { exact: true });
  await expect(passwordInput).toBeVisible();
  await passwordInput.fill(password);
  await submitHostedForm(page);
};

export const signIn = async (
  page: Page,
  email: string,
  password = E2E_PASSWORD
) => {
  await enterCredentials(page, email, password);
  // An unverified mailbox gets the code WorkOS would email.
  const verify = page.getByRole("heading", { name: "Verify your email" });
  await expect(
    verify
      .or(composerOf(page))
      .or(page.getByRole("button", { name: "Try again" }))
  ).toBeVisible({ timeout: 30_000 });
  if (await verify.isVisible()) {
    const { code } = await waitForEmailedEvent<{ code: string; email: string }>(
      "email_verification.created",
      email
    );
    await page.getByLabel("Code", { exact: true }).fill(code);
    await submitHostedForm(page);
  }
  await expectVault(page);
};

export const expectWrongPassword = async (
  page: Page,
  email: string,
  password: string
) => {
  await enterCredentials(page, email, password);
  await expect(page.getByText("Incorrect password. Try again.")).toBeVisible();
  await expect(composerOf(page)).toHaveCount(0);
};

// A deleted WorkOS user can't finish sign-in: the callback fails and Teak
// sends the browser back to hosted sign-in, without vault access.
export const expectSignInRefused = async (page: Page, email: string) => {
  await gotoApp(page, "/login");
  await expectHostedSignIn(page);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await submitHostedForm(page);
  await expectHostedSignIn(page);
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await expect(composerOf(page)).toHaveCount(0);
};

const settingsRow = (page: Page, label: string) =>
  page
    .getByText(label, { exact: true })
    .locator("xpath=ancestor::div[.//button][1]");

export const openSecurity = async (
  page: Page,
  tab: "Connections" | "API keys" = "Connections"
) => {
  await gotoApp(page, "/settings");
  const manageButton = settingsRow(page, "Security").getByRole("button", {
    name: "Manage",
  });
  const dialog = page.getByRole("dialog", { name: "Security", exact: true });
  const tabTrigger = dialog.getByRole("tab", { name: tab, exact: true });
  const tabPanel = dialog.getByRole("tabpanel", { name: tab, exact: true });
  // A click can fail to select its tab, or the dialog can disappear afterward.
  // Retry the complete read-only navigation, verifying the mounted panel.
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await clickVisibleControl(manageButton, { timeout: 2500 });
    }
    await expect(dialog).toBeVisible({ timeout: 2500 });
    if (
      (await tabTrigger.getAttribute("aria-selected", { timeout: 2500 })) !==
      "true"
    ) {
      await clickVisibleControl(tabTrigger, { timeout: 2500 });
    }
    await expect(tabTrigger).toHaveAttribute("aria-selected", "true", {
      timeout: 2500,
    });
    await expect(tabPanel).toBeVisible({ timeout: 2500 });
  }).toPass({ intervals: [250, 500, 1000], timeout: 20_000 });
  return dialog;
};

export const generateApiKey = async (page: Page) => {
  const dialog = await openSecurity(page, "API keys");
  await clickVisibleControl(
    dialog.getByRole("button", { name: "Create key", exact: true })
  );
  // React updates the input's live value property, not necessarily its HTML
  // value attribute, so do not use an attribute-prefix CSS selector here.
  const input = dialog.locator("input[readonly]").first();
  await expect(input).toHaveValue(/^teakapi_/);
  return input.inputValue();
};

export const apiStatus = async (apiKey: string) =>
  (
    await fetch(`${env.apiUrl}/v1/tags`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  ).status;

export const revokeVisibleKey = async (page: Page, rawKey: string) => {
  const visiblePrefix = rawKey.split("_").slice(0, 4).join("_");
  const dialog = await openSecurity(page, "API keys");
  const row = dialog.getByRole("listitem").filter({ hasText: visiblePrefix });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /^Revoke / }).click();
  await expect(
    row,
    "revoked API keys should disappear from the settings table"
  ).toHaveCount(0);
  await expect.poll(() => apiStatus(rawKey)).toBe(401);
};

// A new WorkOS user signs in for the first time; the signed user.created
// webhook is what gives the address a Teak account.
export const createAccount = async (
  page: Page,
  label = "acct",
  options: { emailVerified?: boolean; remember?: boolean } = {}
): Promise<AccountState> => {
  const email = uniqueEmail(label);
  await createEmulatorUser({
    email,
    emailVerified: options.emailVerified ?? true,
    password: E2E_PASSWORD,
  });
  await signIn(page, email);
  const account = { email, apiKey: await generateApiKey(page) };
  if (options.remember !== false) {
    rememberAccount(account);
  }
  return account;
};

export const deleteAccountViaUi = async (page: Page, account: AccountState) => {
  await gotoApp(page, "/settings");
  await page.getByRole("button", { name: /delete your account/i }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete Account" })
  ).toBeVisible();
  await page.locator("#deleteConfirm").fill("delete account");
  await page.getByRole("button", { name: "Delete account" }).click();
  // Deletion signs out at admission, then removes the vault and the WorkOS
  // user in the background.
  await expectHostedSignIn(page);
  const { apiKey } = account;
  if (apiKey) {
    await expect.poll(() => apiStatus(apiKey)).toBe(401);
  }
  await expect
    .poll(() => findEmulatorUser(account.email), { timeout: 60_000 })
    .toBeNull();
  updateState((state) => {
    for (const saved of [state.account, state.primary, ...state.accounts]) {
      if (saved?.email === account.email) {
        saved.deleted = true;
      }
    }
  });
};
