import { test } from "@playwright/test";
import { createAccount } from "../helpers/app";
import {
  accountStorageStateFile,
  securityStorageStateFile,
  storageStateFile,
  updateState,
  webCoreStorageStateFile,
  webFiltersStorageStateFile,
  webSurfacesStorageStateFile,
  writeState,
} from "../helpers/run-state";

test.setTimeout(240_000);

test("new WorkOS users get isolated Teak vaults and API keys", async ({
  browser,
  page,
}) => {
  // Each run starts a fresh emulator, so earlier accounts no longer exist.
  writeState({ accounts: [], createdCardIds: [] });
  // The primary account signs up unverified, so its first sign-in goes
  // through the emailed verification code before the vault opens.
  const primary = await createAccount(page, "primary", {
    emailVerified: false,
  });
  updateState((state) => {
    state.primary = primary;
  });
  await page.context().storageState({ path: storageStateFile });

  const createIsolatedAccount = async (
    label: string,
    storageStatePath?: string
  ) => {
    const context = await browser.newContext();
    try {
      const account = await createAccount(await context.newPage(), label, {
        remember: false,
      });
      if (storageStatePath) {
        await context.storageState({ path: storageStatePath });
      }
      return account;
    } finally {
      await context.close();
    }
  };

  const [
    webCore,
    webSurfaces,
    webFilters,
    lifecycleAccount,
    api,
    cli,
    mcp,
    security,
  ] = await Promise.all([
    createIsolatedAccount("web-core", webCoreStorageStateFile),
    createIsolatedAccount("web-surfaces", webSurfacesStorageStateFile),
    createIsolatedAccount("web-filters", webFiltersStorageStateFile),
    createIsolatedAccount("account-lifecycle", accountStorageStateFile),
    createIsolatedAccount("service-api"),
    createIsolatedAccount("service-cli"),
    createIsolatedAccount("service-mcp"),
    createIsolatedAccount("security", securityStorageStateFile),
  ]);
  updateState((state) => {
    state.accounts.push(
      webCore,
      webSurfaces,
      webFilters,
      lifecycleAccount,
      api,
      cli,
      mcp,
      security
    );
    state.webCore = webCore;
    state.webSurfaces = webSurfaces;
    state.webFilters = webFilters;
    state.account = lifecycleAccount;
    state.serviceAccounts = { api, cli, mcp };
  });
});
