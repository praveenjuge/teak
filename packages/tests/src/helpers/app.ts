import { api } from "@teak/convex";
import { createTeakClient } from "teak-sdk";
import { waitForTeakAccount } from "../../../../scripts/lib/teak-account.ts";
import {
  createEmulatorUser,
  findEmulatorUser,
  sessionTokenFor,
  waitForEmailedEvent,
} from "./emulator";
import { E2E_PASSWORD, env, uniqueEmail } from "./env";
import {
  type Browser,
  expect,
  firstVisible,
  type Locator,
  retry,
  type Screen,
  type Surface,
} from "./test";

export interface AccountState {
  apiKey?: string;
  email: string;
  password?: string;
}

export const clientFor = (apiKey: string) =>
  createTeakClient({
    baseUrl: env.apiUrl,
    tokenProvider: { getAccessToken: async () => apiKey },
    userAgent: "teak-e2e",
  });

export const appPath = (path: string) => new URL(path, env.appUrl).toString();

export const gotoApp = (browser: Browser, path: string) =>
  browser.goto(appPath(path));

const isRetryableActionError = (error: unknown) =>
  error instanceof Error &&
  /ACTION_FAILED|detached|not stable|LOCATOR_NOT_FOUND/.test(
    `${(error as { code?: string }).code ?? ""} ${error.message}`
  );

export const clickRetryingReplacedNode = async (
  locator: Locator,
  options: { timeout?: number } = {}
) => {
  const timeout = options.timeout ?? 15_000;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await expect(locator).toBeVisible({ timeout });
    await expect(locator).toBeEnabled({ timeout });
    try {
      await locator.click({ timeout: Math.min(timeout, 5000) });
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isRetryableActionError(error)) {
        throw error;
      }
    }
  }
};

export const onScreenText = (screen: Screen, text: string) =>
  screen.getByText(text, { exact: false, visible: true });

export const composerOf = (screen: Screen) =>
  screen.getByRole("textbox", "Markdown content", { visible: true });

export const fillAndSubmitTextCard = async (
  { browser }: Surface,
  content: string
) => {
  const editor = browser
    .locator('form[data-card-creation-status="ready"]')
    .getByRole("textbox", "Markdown content");
  await retry(
    async () => {
      await editor.fill(content);
      await expect(editor).toHaveText(content, { timeout: 5000 });
    },
    { timeout: 30_000 }
  );
  await clickRetryingReplacedNode(
    browser
      .locator("form[data-card-creation-status]")
      .getByRole("button", "Save")
  );
};

export const expectVault = async ({ screen }: Surface) => {
  await expect(composerOf(screen)).toBeVisible({ timeout: 45_000 });
};

const waitForAccount = async (email: string, password = E2E_PASSWORD) =>
  waitForTeakAccount({
    accessToken: await sessionTokenFor(email, password),
    convexUrl: env.convexUrl,
  });

const emulatorOrigin = () => new URL(env.emulatorUrl).origin;

export const expectHostedSignIn = async ({ browser, screen }: Surface) => {
  await expect(screen.getByLabel("Email")).toBeVisible({ timeout: 30_000 });
  expect(
    new URL(await browser.url()).origin,
    "Sign-in must happen on hosted AuthKit, not a Teak page"
  ).toBe(emulatorOrigin());
};

const submitHostedForm = (screen: Screen) =>
  screen.getByRole("button", "Continue").click();

const enterCredentials = async (
  surface: Surface,
  email: string,
  password: string
) => {
  const { browser, screen } = surface;
  await gotoApp(browser, "/login");
  await expectHostedSignIn(surface);
  await screen.getByLabel("Email").fill(email);
  await submitHostedForm(screen);
  const passwordInput = screen.getByLabel("Password");
  await expect(passwordInput).toBeVisible();
  await passwordInput.fill(password);
  await submitHostedForm(screen);
};

export const signIn = async (
  surface: Surface,
  email: string,
  password = E2E_PASSWORD
) => {
  const { screen } = surface;
  await enterCredentials(surface, email, password);
  const verify = screen.getByRole("heading", "Verify your email", {
    exact: false,
  });
  const landed = await firstVisible([verify, composerOf(screen)], {
    timeout: 30_000,
  });
  if (landed === 0) {
    const { code } = await waitForEmailedEvent<{ code: string; email: string }>(
      "email_verification.created",
      email
    );
    await screen.getByLabel("Code").fill(code);
    await submitHostedForm(screen);
    await waitForAccount(email, password);
  }
  await expectVault(surface);
};

export const expectWrongPassword = async (
  surface: Surface,
  email: string,
  password: string
) => {
  const { screen } = surface;
  await enterCredentials(surface, email, password);
  await expect(
    screen.getByText("Incorrect password. Try again.", { exact: false })
  ).toBeVisible();
  await expect(composerOf(screen)).toHaveCount(0);
};

export const expectSignInRefused = async (surface: Surface, email: string) => {
  const { browser, screen } = surface;
  await gotoApp(browser, "/login");
  await expectHostedSignIn(surface);
  await screen.getByLabel("Email").fill(email);
  await submitHostedForm(screen);
  await expectHostedSignIn(surface);
  await expect(screen.getByLabel("Password")).toHaveCount(0);
  await expect(composerOf(screen)).toHaveCount(0);
};

// The Settings row whose label is `label`: the nearest block around the label
// that holds a button.
type SecurityTab = "Connections" | "API keys";

// Devices and connected apps live on Settings → Security; API keys on
// Settings → Integrations.
const SETTINGS_PAGES: Record<SecurityTab, { path: string; region: string }> = {
  Connections: { path: "/settings/security", region: "Devices" },
  "API keys": { path: "/settings/integrations", region: "API keys" },
};

/** The page's settings, below the header and beside the Settings nav. */
export const settingsContentOf = (browser: Browser) =>
  browser.locator('[data-slot="settings-content"]');

export const openSecurity = async (
  { browser, screen }: Surface,
  tab: SecurityTab = "Connections"
) => {
  const page = SETTINGS_PAGES[tab];
  await gotoApp(browser, page.path);
  await expect(screen.getByRole("region", page.region)).toBeVisible({
    timeout: 30_000,
  });
  return settingsContentOf(browser);
};

export const generateApiKey = async (surface: Surface) => {
  const settings = await openSecurity(surface, "API keys");
  await clickRetryingReplacedNode(settings.getByRole("button", "Create key"));
  // React updates the input's live value property, not necessarily its HTML
  // value attribute, so do not use an attribute-prefix CSS selector here.
  const input = surface.browser
    .locator('[data-slot="settings-content"] input[readonly]')
    .first();
  await expect(input).toHaveValue(/^teakapi_/);
  return input.inputValue();
};

export const apiStatus = async (apiKey: string) =>
  (
    await fetch(`${env.apiUrl}/v1/tags`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  ).status;

export const revokeVisibleKey = async (surface: Surface, rawKey: string) => {
  const visiblePrefix = rawKey.split("_").slice(0, 4).join("_");
  const settings = await openSecurity(surface, "API keys");
  const row = settings.getByRole("listitem").filter({ hasText: visiblePrefix });
  await expect(row).toBeVisible();
  await row.getByRole("button", /^Revoke /).click();
  await surface.screen
    .getByRole("alertdialog")
    .getByRole("button", "Revoke key")
    .click();
  await expect(row).toHaveCount(0);
  await expect.poll(() => apiStatus(rawKey), { timeout: 15_000 }).toBe(401);
};

export const signUp = async (
  surface: Surface,
  label: string,
  options: { emailVerified?: boolean } = {}
) => {
  const email = uniqueEmail(label);
  const emailVerified = options.emailVerified ?? true;
  await createEmulatorUser({ email, emailVerified, password: E2E_PASSWORD });
  if (emailVerified) {
    await waitForAccount(email);
  }
  await signIn(surface, email);
  return email;
};

export const createAccount = async (
  surface: Surface,
  label = "acct",
  options: { emailVerified?: boolean } = {}
): Promise<AccountState> => {
  const email = await signUp(surface, label, options);
  return { email, apiKey: await generateApiKey(surface) };
};

export const createApiAccount = async (
  label: string
): Promise<Required<Pick<AccountState, "apiKey" | "email">>> => {
  const email = uniqueEmail(label);
  await createEmulatorUser({
    email,
    emailVerified: true,
    password: E2E_PASSWORD,
  });
  const { client } = await waitForAccount(email);
  const { key } = await client.mutation(api.apiKeys.createUserApiKey, {});
  return { email, apiKey: key };
};

export const deleteAccountViaUi = async (
  surface: Surface,
  account: AccountState
) => {
  const { browser, screen } = surface;
  await gotoApp(browser, "/settings/security");
  await screen.getByRole("button", /delete your account/i).click();
  await expect(
    screen.getByRole("dialog", "Delete Account", { exact: false })
  ).toBeVisible();
  await browser.locator("#deleteConfirm").fill("delete account");
  await screen.getByRole("button", "Delete account", { exact: false }).click();
  await expectHostedSignIn(surface);
  const { apiKey } = account;
  if (apiKey) {
    await expect.poll(() => apiStatus(apiKey), { timeout: 15_000 }).toBe(401);
  }
  await expect
    .poll(() => findEmulatorUser(account.email), { timeout: 60_000 })
    .toBeNull();
};
