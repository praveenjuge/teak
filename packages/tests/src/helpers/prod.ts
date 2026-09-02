import {
  type Browser,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { createTeakClient } from "@teak/convex/sdk";
import { provisionE2EAccount } from "./e2e-cleanup";
import { env, requirePassword, uniqueEmail } from "./env";
import { waitForEmail } from "./mailpit";
import { type AccountState, rememberAccount, updateState } from "./run-state";

const TRANSIENT_API_STATUSES = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_API_RETRY_DELAYS_MS = [500, 1500];
const PROD_E2E_API_TIMEOUT_MS = 35_000;

const sleep = (delayMs: number) =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

const waitForRetry = async (
  wait: (delayMs: number) => Promise<unknown>,
  delayMs: number,
  signal?: AbortSignal | null
) => {
  if (!signal) {
    await wait(delayMs);
    return;
  }
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }

  let rejectOnAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = () =>
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", rejectOnAbort, { once: true });
  });
  try {
    await Promise.race([wait(delayMs), aborted]);
  } finally {
    if (rejectOnAbort) {
      signal.removeEventListener("abort", rejectOnAbort);
    }
  }
};

export const createProdE2EFetch = (
  fetchImpl: typeof fetch = fetch,
  wait: (delayMs: number) => Promise<unknown> = sleep,
  attemptTimeoutMs = 10_000
): typeof fetch => {
  const retryingFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const request = input instanceof Request ? input : null;
    const overallSignal = init?.signal ?? request?.signal;
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? request?.headers);
    const url = request?.url ?? String(input);
    const isCardCreate =
      method === "POST" && new URL(url).pathname.endsWith("/v1/cards");
    if (isCardCreate && !headers.has("Idempotency-Key")) {
      headers.set("Idempotency-Key", crypto.randomUUID());
    }
    const isSafeToRetry =
      isCardCreate || ["GET", "HEAD", "OPTIONS"].includes(method);
    // Normalize the reusable body without a signal. Each attempt composes a
    // fresh timeout with the SDK's longer overall E2E request deadline.
    const retryRequest = new Request(input, {
      ...init,
      headers,
      signal: null,
    });

    for (let attempt = 0; ; attempt += 1) {
      const delayMs = TRANSIENT_API_RETRY_DELAYS_MS[attempt];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
      const signal = overallSignal
        ? AbortSignal.any([overallSignal, controller.signal])
        : controller.signal;
      let response: Response;
      try {
        response = await fetchImpl(retryRequest.clone(), {
          signal,
        });
      } catch (error) {
        if (
          overallSignal?.aborted ||
          delayMs === undefined ||
          !isSafeToRetry ||
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          throw error;
        }
        clearTimeout(timeout);
        await waitForRetry(wait, delayMs, overallSignal);
        continue;
      } finally {
        clearTimeout(timeout);
      }
      if (
        delayMs === undefined ||
        !isSafeToRetry ||
        !TRANSIENT_API_STATUSES.has(response.status)
      ) {
        return response;
      }
      await response.body?.cancel();
      if (overallSignal?.aborted) {
        throw overallSignal.reason ?? new DOMException("Aborted", "AbortError");
      }
      await waitForRetry(wait, delayMs, overallSignal);
    }
  };
  return retryingFetch as typeof fetch;
};

export const clientFor = (apiKey: string) =>
  createTeakClient({
    baseUrl: env.apiUrl,
    fetch: createProdE2EFetch(),
    timeoutMs: PROD_E2E_API_TIMEOUT_MS,
    tokenProvider: { getAccessToken: async () => apiKey },
    userAgent: "teak-prod-e2e",
  });

export const appPath = (path: string) => new URL(path, env.appUrl).toString();

export const newAnonymousContext = (browser: Browser) =>
  browser.newContext({ storageState: { cookies: [], origins: [] } });

const isRetryableActionabilityError = (error: unknown) =>
  error instanceof Error &&
  /element (is not stable|was detached)|Timeout .* exceeded/.test(
    error.message
  );

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
  const creationForm = page.locator("form[data-card-creation-status]");
  const readyCreationForm = page.locator(
    'form[data-card-creation-status="ready"]'
  );
  const editor = readyCreationForm.getByRole("textbox", {
    name: "Markdown content",
  });
  await expect(async () => {
    await expect(readyCreationForm).toBeVisible({ timeout: 5000 });
    await editor.fill(content);
    await expect(editor).toHaveText(content, { timeout: 5000 });
  }).toPass({ intervals: [250, 500, 1000], timeout: 30_000 });
  await clickVisibleControl(
    creationForm.getByRole("button", { name: "Save", exact: true })
  );
};

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
  const dialog = page.getByRole("dialog", { name: "Manage API Keys" });
  await expect(dialog).toBeVisible();
  await clickVisibleControl(
    dialog.getByRole("button", { name: "Generate Key" })
  );
  // React updates the input's live value property, not necessarily its HTML
  // value attribute, so do not use an attribute-prefix CSS selector here.
  const input = dialog.locator("input[readonly]").first();
  await expect(input).toHaveValue(/^teakapi_/);
  return input.inputValue();
};

export const createAccount = async (
  page: Page,
  label = "acct",
  options: { remember?: boolean; viaEmail?: boolean } = {}
) => {
  const email = options.viaEmail
    ? await signUp(page, uniqueEmail(label))
    : uniqueEmail(label);
  if (!options.viaEmail) {
    await provisionE2EAccount(email, requirePassword());
    await signIn(page, email);
  }
  const apiKey = await generateApiKey(page);
  const account = { email, apiKey };
  if (options.remember !== false) {
    rememberAccount(account);
  }
  return account;
};

export const deleteAccountViaUi = async (page: Page, account: AccountState) => {
  if (account.deleted) {
    return;
  }
  await page.goto(appPath("/settings"));
  const deleteAccountButton = page.getByRole("button", {
    name: /delete your account/i,
  });
  const canDelete = await deleteAccountButton
    .waitFor({ state: "visible", timeout: 5000 })
    .then(
      () => true,
      () => false
    );
  if (!canDelete) {
    await signIn(page, account.email, passwordFor(account));
  }
  await page.goto(appPath("/settings"));
  await deleteAccountButton.click();
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
        { timeout: 60_000 }
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
    if (state.account?.email === account.email) {
      state.account.deleted = true;
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
  const row = dialog.getByRole("row").filter({ hasText: visiblePrefix });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /^Revoke / }).click();
  await expect(
    row,
    "revoked API keys should disappear from the settings table"
  ).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (
          await fetch(`${env.apiUrl}/v1/tags`, {
            headers: { Authorization: `Bearer ${rawKey}` },
          })
        ).status,
      { timeout: 30_000 }
    )
    .toBe(401);
};
