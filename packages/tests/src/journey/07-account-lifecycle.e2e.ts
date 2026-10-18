import { apiFetch } from "../helpers/api";
import {
  createAccount,
  deleteAccountViaUi,
  expectHostedSignIn,
  expectSignInRefused,
  expectWrongPassword,
  gotoApp,
  signIn,
} from "../helpers/app";
import { resetPasswordThroughEmail } from "../helpers/emulator";
import { E2E_PASSWORD, env } from "../helpers/env";
import { recordToasts } from "../helpers/page-hooks";
import { describe, expect, test } from "../helpers/test";

let email = "";
let apiKey = "";
let password = E2E_PASSWORD;

describe("account lifecycle", { serial: true, timeout: 180_000 }, () => {
  test("a new account signs up with an API key", async ({
    browser,
    screen,
  }) => {
    const account = await createAccount({ browser, screen }, "account");
    email = account.email;
    apiKey = account.apiKey ?? "";
    expect(apiKey).toMatch(/^teakapi_/);
  });

  test("a password reset from the emailed link opens the same vault", async ({
    app,
    browser,
    screen,
  }) => {
    const surface = { browser, screen };
    await app.clearState();
    const nextPassword = `${E2E_PASSWORD}Reset1`;
    await resetPasswordThroughEmail(email, nextPassword);
    password = nextPassword;
    await expectWrongPassword(surface, email, E2E_PASSWORD);
    await signIn(surface, email, nextPassword);
    await gotoApp(browser, "/settings");
    await expect(screen.getByText(email, { exact: false })).toBeVisible();
  });

  test("signing out from settings returns to hosted sign-in without crashing", async ({
    app,
    browser,
    screen,
  }) => {
    const surface = { browser, screen };
    await app.clearState();
    await signIn(surface, email, password);
    await gotoApp(browser, "/settings");
    await expect(screen.getByRole("heading", "Settings")).toBeVisible();

    const recorded = await recordToasts(browser);

    await screen.getByRole("button", "Sign out").click();

    await expectHostedSignIn(surface);
    await expect(screen.getByText(/couldn't load/i)).toHaveCount(0);
    expect(recorded.toasts).toEqual([]);
    await gotoApp(browser, "/settings");
    await expectHostedSignIn(surface);
  });

  test("deleting the account from settings removes its vault and WorkOS user", async ({
    app,
    browser,
    screen,
  }) => {
    const surface = { browser, screen };
    await app.clearState();
    await signIn(surface, email, password);
    await deleteAccountViaUi(surface, { apiKey, email, password });
    await expectSignInRefused(surface, email);
  });

  test("deleted account credentials are inert", async () => {
    expect(apiKey).toMatch(/^teakapi_/);
    expect((await apiFetch("/v1/tags", apiKey)).status).toBe(401);
    expect(
      (
        await fetch(env.mcpUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
      ).status
    ).toBe(401);
  });
});
