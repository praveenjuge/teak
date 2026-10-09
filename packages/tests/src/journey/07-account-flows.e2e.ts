import { expect, test } from "@playwright/test";
import {
  appPath,
  expectHostedSignIn,
  expectWrongPassword,
  newAnonymousContext,
  signIn,
} from "../helpers/app";
import { resetPasswordThroughEmail } from "../helpers/emulator";
import { E2E_PASSWORD } from "../helpers/env";
import { requireAccount, updateState } from "../helpers/run-state";

test("a password reset from the emailed link opens the same vault", async ({
  browser,
}) => {
  const account = requireAccount("account");
  const nextPassword = `${E2E_PASSWORD}Reset1`;
  const context = await newAnonymousContext(browser);
  const page = await context.newPage();
  try {
    await resetPasswordThroughEmail(account.email, nextPassword);
    updateState((state) => {
      if (state.account) {
        state.account.password = nextPassword;
      }
    });
    await expectWrongPassword(page, account.email, E2E_PASSWORD);
    await signIn(page, account.email, nextPassword);
    await page.goto(appPath("/settings"));
    await expect(page.getByText(account.email)).toBeVisible();
  } finally {
    await context.close();
  }
});

test("signing out from settings returns to hosted sign-in without crashing", async ({
  browser,
}) => {
  const account = requireAccount("account");
  const context = await newAnonymousContext(browser);
  const page = await context.newPage();
  try {
    await signIn(page, account.email, account.password ?? E2E_PASSWORD);
    await page.goto(appPath("/settings"));
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true })
    ).toBeVisible();

    // The page leaves for hosted AuthKit right after the click, so a toast is
    // gone before an assertion could find it. Record each one as it appears.
    const toasts: string[] = [];
    await page.exposeBinding("reportToast", (_source, text: string) => {
      toasts.push(text);
    });
    await page.evaluate(() => {
      const { reportToast } = window as unknown as {
        reportToast: (text: string) => void;
      };
      new MutationObserver((mutations) => {
        for (const node of mutations.flatMap((m) => [...m.addedNodes])) {
          if (!(node instanceof HTMLElement)) {
            continue;
          }
          const added = node.matches("[data-sonner-toast]")
            ? [node]
            : node.querySelectorAll("[data-sonner-toast]");
          for (const toast of added) {
            reportToast(toast.textContent ?? "");
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    });

    // Regression: signing out here used to crash the page with a client error
    // ("This page couldn't load") instead of returning the user to login, and
    // later flashed "Failed to sign out" while it signed out.
    await page.getByRole("button", { name: "Sign out", exact: true }).click();

    await expectHostedSignIn(page);
    await expect(page.getByText(/couldn't load/i)).toHaveCount(0);
    expect(toasts).toEqual([]);
    await page.goto(appPath("/settings"));
    await expectHostedSignIn(page);
  } finally {
    await context.close();
  }
});
