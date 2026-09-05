import { expect, test } from "@playwright/test";
import { AuthHelper } from "./test-helpers";

const email = process.env.E2E_BETTER_AUTH_USER_EMAIL;
const password = process.env.E2E_BETTER_AUTH_USER_PASSWORD;

test("account switching clears protected UI before reloading", async ({
  page,
}) => {
  test.skip(!(email && password), "Requires E2E Better Auth credentials.");
  await new AuthHelper(page).signInWithEmailAndPassword(email!, password!);
  await expect(
    page.getByRole("link", { name: "Settings", exact: true })
  ).toBeVisible();
  const homeUrl = page.url();

  await page.evaluate(() => {
    window.addEventListener("beforeunload", () => {
      sessionStorage.setItem(
        "account-switch-protected-cleared",
        String(!document.querySelector('a[aria-label="Settings"]'))
      );
    });
  });
  const session = await page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session");
    return await response.json();
  });
  expect(session.user).toBeTruthy();
  await page.route("**/api/auth/get-session**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...session,
        user: { ...session.user, id: "e2e-different-account" },
      },
    });
  });
  await page.route(homeUrl, async (route) => {
    if (route.request().isNavigationRequest()) {
      await route.fulfill({
        contentType: "text/html",
        body: "<p>Account reload completed</p>",
      });
    } else {
      await route.continue();
    }
  });

  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText("Account reload completed")).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("account-switch-protected-cleared")
    )
  ).toBe("true");
});
