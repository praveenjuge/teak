import { test } from "@playwright/test";
import { assertMailpitReady } from "../helpers/mailpit";
import { createAccount } from "../helpers/prod";
import { storageStateFile, updateState } from "../helpers/run-state";

test.setTimeout(240_000);

test("create verified production account and API key", async ({ page }) => {
  await assertMailpitReady();
  const account = await createAccount(page, "primary");
  updateState((state) => {
    state.primary = account;
  });
  await page.context().storageState({ path: storageStateFile });
});
