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

  test.skip(
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
      page.getByRole("heading", { name: /let.?s add your first card!/i }),
    ).toBeVisible();

    await clerk.signOut({ page });
  });

  test("creates a new account through the sign-up flow", async ({ page }) => {
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
      page.getByRole("heading", { name: /let.?s add your first card!/i }),
    ).toBeVisible();

    await clerk.signOut({ page });
  });
});
