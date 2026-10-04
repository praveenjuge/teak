import { expect, test } from "@playwright/test";
import { SIGNUPS_PAUSED_MESSAGE } from "@teak/convex/shared/constants";
import { env } from "../helpers/env";
import { appPath, createAccount } from "../helpers/prod";
import {
  accountStorageStateFile,
  importExportStorageStateFile,
  securityStorageStateFile,
  storageStateFile,
  updateState,
  webCoreStorageStateFile,
  webFilesStorageStateFile,
  webFiltersStorageStateFile,
  webSurfacesStorageStateFile,
} from "../helpers/run-state";

test.setTimeout(240_000);

test("create isolated verified production accounts and API keys", async ({
  browser,
  page,
}, testInfo) => {
  let viaEmail = env.emailDeliveryEnabled;
  if (viaEmail) {
    await page.goto(appPath("/register"));
    const paused = page.getByRole("status").filter({
      hasText: SIGNUPS_PAUSED_MESSAGE,
    });
    const email = page.getByLabel("Email", { exact: true });
    await expect(paused.or(email)).toBeVisible();
    if (await paused.isVisible()) {
      await expect(paused).toHaveText(SIGNUPS_PAUSED_MESSAGE);
      await expect(email).toHaveCount(0);
      await testInfo.attach("registration-freeze", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      testInfo.annotations.push({
        type: "migration",
        description:
          "Registration freeze verified; account provisioned through the protected E2E endpoint. Signup email canary deferred until unfreeze.",
      });
      viaEmail = false;
    }
  }
  const account = await createAccount(page, "primary", {
    viaEmail,
  });
  updateState((state) => {
    state.primary = account;
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
    webFiles,
    webFilters,
    lifecycleAccount,
    api,
    cli,
    mcp,
    importExport,
    security,
  ] = await Promise.all([
    createIsolatedAccount("web-core", webCoreStorageStateFile),
    createIsolatedAccount("web-surfaces", webSurfacesStorageStateFile),
    createIsolatedAccount("web-files", webFilesStorageStateFile),
    createIsolatedAccount("web-filters", webFiltersStorageStateFile),
    createIsolatedAccount("account-lifecycle", accountStorageStateFile),
    createIsolatedAccount("service-api"),
    createIsolatedAccount("service-cli"),
    createIsolatedAccount("service-mcp"),
    createIsolatedAccount("import-export", importExportStorageStateFile),
    createIsolatedAccount("security", securityStorageStateFile),
  ]);
  updateState((state) => {
    state.accounts.push(
      webCore,
      webSurfaces,
      webFiles,
      webFilters,
      lifecycleAccount,
      api,
      cli,
      mcp,
      importExport,
      security
    );
    state.webCore = webCore;
    state.webSurfaces = webSurfaces;
    state.webFiles = webFiles;
    state.webFilters = webFilters;
    state.account = lifecycleAccount;
    state.importExport = importExport;
    state.serviceAccounts = { api, cli, mcp };
  });
});
