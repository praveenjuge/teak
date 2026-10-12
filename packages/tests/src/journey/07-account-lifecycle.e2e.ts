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
import { describe, expect, test } from "../helpers/test";

// One account's whole life, in order: it signs up, resets its password,
// signs out, deletes itself, and its credentials stop working.
let email = "";
let apiKey = "";
let password = E2E_PASSWORD;

// Toasts report here from the page; the route answers before any server.
const TOAST_HOOK = "/__teak-e2e-hook/toast";

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

    // The page leaves for hosted AuthKit right after the click, so a toast is
    // gone before an assertion could find it. Record each one as it appears.
    const toasts: string[] = [];
    await browser.route(new RegExp(`${TOAST_HOOK}$`), async (route) => {
      toasts.push(route.request.postData ?? "");
      await route.fulfill({ status: 204, body: "" });
    });
    await browser.evaluate((hookPath: string) => {
      new MutationObserver((mutations) => {
        for (const node of mutations.flatMap((m) => [...m.addedNodes])) {
          if (!(node instanceof HTMLElement)) {
            continue;
          }
          const added = node.matches("[data-sonner-toast]")
            ? [node]
            : node.querySelectorAll("[data-sonner-toast]");
          for (const toast of added) {
            // keepalive lets the report finish while the page unloads.
            fetch(`${location.origin}${hookPath}`, {
              body: toast.textContent ?? "",
              keepalive: true,
              method: "POST",
            }).catch(() => undefined);
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
      return null;
    }, TOAST_HOOK);

    // Regression: signing out here used to crash the page with a client error
    // ("This page couldn't load") instead of returning the user to login, and
    // later flashed "Failed to sign out" while it signed out.
    await screen.getByRole("button", "Sign out").click();

    await expectHostedSignIn(surface);
    await expect(screen.getByText(/couldn't load/i)).toHaveCount(0);
    expect(toasts).toEqual([]);
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
