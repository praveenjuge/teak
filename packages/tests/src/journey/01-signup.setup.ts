import { test } from "@playwright/test";
import { env } from "../helpers/env";
import { createAccount } from "../helpers/prod";
import {
  importExportStorageStateFile,
  storageStateFile,
  updateState,
} from "../helpers/run-state";

test.setTimeout(240_000);

test("create isolated verified production accounts and API keys", async ({
  browser,
  page,
}) => {
  const account = await createAccount(page, "primary", {
    viaEmail: env.emailDeliveryEnabled,
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

  const [api, cli, mcp, importExport] = await Promise.all([
    createIsolatedAccount("service-api"),
    createIsolatedAccount("service-cli"),
    createIsolatedAccount("service-mcp"),
    createIsolatedAccount("import-export", importExportStorageStateFile),
  ]);
  updateState((state) => {
    state.accounts.push(api, cli, mcp, importExport);
    state.importExport = importExport;
    state.serviceAccounts = { api, cli, mcp };
  });
});
