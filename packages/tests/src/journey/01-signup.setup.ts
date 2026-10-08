import { test } from "@playwright/test";
import { createAccount } from "../helpers/app";
import { type AccountState, writeState } from "../helpers/run-state";

test.setTimeout(240_000);

test("new WorkOS users get isolated Teak vaults and API keys", async ({
  browser,
  page,
}) => {
  // The primary account signs up unverified, so its first sign-in goes
  // through the emailed verification code before the vault opens.
  const primary = await createAccount(page, "primary", {
    emailVerified: false,
  });

  const createIsolatedAccount = async (label: string) => {
    const context = await browser.newContext();
    try {
      return await createAccount(await context.newPage(), label);
    } finally {
      await context.close();
    }
  };
  // One at a time: parallel sign-ups starve a small CI runner's backend.
  const accounts: AccountState[] = [];
  for (const label of [
    "web-core",
    "web-surfaces",
    "web-filters",
    "account-lifecycle",
    "security",
    "service-api",
    "service-cli",
    "service-mcp",
  ]) {
    accounts.push(await createIsolatedAccount(label));
  }
  const [webCore, webSurfaces, webFilters, account, security, api, cli, mcp] =
    accounts;
  // Each run starts a fresh emulator, so earlier accounts no longer exist.
  writeState({
    account,
    createdCardIds: [],
    primary,
    security,
    serviceAccounts: { api, cli, mcp },
    webCore,
    webFilters,
    webSurfaces,
  });
});
