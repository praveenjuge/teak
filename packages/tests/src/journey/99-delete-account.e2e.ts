import { test } from "@playwright/test";
import { requirePassword } from "../helpers/env";
import { deleteAccountViaUi, passwordFor, signIn } from "../helpers/prod";
import { requireAccount } from "../helpers/run-state";

test("delete primary account through the web UI", async ({ page }) => {
  const primary = requireAccount("account");
  await deleteAccountViaUi(page, primary);
  await signIn(page, primary.email, passwordFor(primary), {
    failure: /invalid|incorrect|not found|unable/i,
  });
  if (primary.passwordReset) {
    await signIn(page, primary.email, requirePassword(), {
      failure: /invalid|incorrect|not found|unable/i,
    });
  }
});
