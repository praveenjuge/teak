import { expect, test } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { createPageObjects } from "@clerk/testing/playwright/unstable";

const shouldSkipClerkTests =
  process.env.PLAYWRIGHT_CLERK_SETUP_SKIPPED === "true";

test.skip(
  shouldSkipClerkTests,
  "Clerk testing credentials are not configured for Playwright.",
);

test.describe("Clerk authentication", () => {
  const signInIdentifier = process.env.E2E_CLERK_USER_EMAIL;
  const signInPassword = process.env.E2E_CLERK_USER_PASSWORD;
  const skipCredentialedFlows =
    shouldSkipClerkTests || !signInIdentifier || !signInPassword;
  const shouldSkipSignupFlow =
    process.env.PLAYWRIGHT_RUN_SIGNUP_FLOW !== "true";

  test.describe.configure({ mode: "serial" });

  test("renders the sign-in experience", async ({ page }) => {
    await setupClerkTestingToken({ page });

    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: /sign in/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue", exact: true }),
    ).toBeVisible();
  });

  test("renders the sign-up experience", async ({ page }) => {
    await setupClerkTestingToken({ page });

    await page.goto("/register");

    await expect(
      page.getByRole("heading", {
        name: /sign up|create your account/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue", exact: true }),
    ).toBeVisible();
  });

  test.fail(
    skipCredentialedFlows,
    "Set E2E_CLERK_USER_EMAIL and E2E_CLERK_USER_PASSWORD to run sign-in flow tests.",
  );

  test("signs in with Clerk helpers and reaches the dashboard", async ({
    page,
  }) => {
    await page.goto("/login");

    await clerk.signIn({
      page,
      signInParams: {
        strategy: "password",
        identifier: signInIdentifier!,
        password: signInPassword!,
      },
    });

    await page.goto("/");

    await expect(
      page.getByRole("searchbox", { name: "Search for anything..." }),
    ).toBeVisible();

    await clerk.signOut({ page });
  });

  test("creates a new account through the sign-up flow", async ({ page }) => {
    test.skip(
      shouldSkipSignupFlow,
      "Set PLAYWRIGHT_RUN_SIGNUP_FLOW=true to run sign-up flow tests.",
    );

    await setupClerkTestingToken({ page });
    await page.goto("/register");

    const { signUp } = createPageObjects({ page });
    const uniqueEmail = `playwright-${Date.now()}+clerk_test@example.com`;
    const password = `Test-${Date.now()}!`;

    await signUp.getEmailAddressInput().fill(uniqueEmail);
    await signUp.getPasswordInput().fill(password);
    await signUp.continue();

    const otpLabel = page.getByLabel(/verification code/i);
    if (await otpLabel.isVisible().catch(() => false)) {
      await otpLabel.fill("424242");
    } else {
      const otpInput = page
        .getByRole("textbox", { name: /digit 1/i })
        .first();
      if (await otpInput.isVisible().catch(() => false)) {
        await otpInput.click();
        await page.keyboard.type("424242", { delay: 75 });
      }
    }

    await signUp.waitForSession();
    await page.waitForURL("**/", { waitUntil: "networkidle" });

    await expect(
      page.getByRole("searchbox", { name: "Search for anything..." }),
    ).toBeVisible();

    await clerk.signOut({ page });
  });
});
