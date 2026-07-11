import { test } from "@playwright/test";
import { assertMailpitReady } from "../helpers/mailpit";
import { signUp } from "../helpers/prod";
import { rememberAccount, storageStateFile } from "../helpers/run-state";

test.setTimeout(240_000);

test("create the controlled snapshot account", async ({ page }) => {
  await assertMailpitReady();
  const account = { email: await signUp(page) };
  rememberAccount(account, true);
  await page.context().storageState({ path: storageStateFile });
});
