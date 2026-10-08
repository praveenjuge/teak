import { test } from "@playwright/test";
import {
  deleteAccountViaUi,
  expectSignInRefused,
  signIn,
} from "../helpers/app";
import { E2E_PASSWORD } from "../helpers/env";
import { requireAccount } from "../helpers/run-state";

test("deleting the account from settings removes its vault and WorkOS user", async ({
  page,
}) => {
  const account = requireAccount("account");
  await signIn(page, account.email, account.password ?? E2E_PASSWORD);
  await deleteAccountViaUi(page, account);
  await expectSignInRefused(page, account.email);
});
