import { test } from "@playwright/test";
import { env } from "../helpers/env";
import { createAccount } from "../helpers/prod";
import { storageStateFile, updateState } from "../helpers/run-state";

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

  for (const surface of ["api", "cli", "mcp"] as const) {
    const context = await browser.newContext();
    try {
      const serviceAccount = await createAccount(
        await context.newPage(),
        `service-${surface}`
      );
      updateState((state) => {
        state.serviceAccounts ??= {};
        state.serviceAccounts[surface] = serviceAccount;
      });
    } finally {
      await context.close();
    }
  }
});
