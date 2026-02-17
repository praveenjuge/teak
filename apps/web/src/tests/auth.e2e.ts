import { expect, test } from "@playwright/test";
import { AuthHelper, generateTestEmail } from "./test-helpers";

// Get test credentials from environment or use defaults
const TEST_EMAIL = process.env.E2E_TEST_EMAIL || generateTestEmail();
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || "TestPassword123!";
const SKIP_AUTH_TESTS = process.env.SKIP_AUTH_TESTS === "true";

test.describe("Authentication Flows", () => {
  // Skip all auth tests if flag is set
  // biome-ignore lint/suspicious/noSkippedTests: Conditional test skip
  test.skip(
    SKIP_AUTH_TESTS,
    "Authentication tests skipped via SKIP_AUTH_TESTS"
  );

  test.beforeEach(async ({ page }) => {
    // Clear cookies and localStorage before each test
    await page.context().clearCookies();
    await page.goto("/login");
  });

  test.describe("Login Page", () => {
    test("should display login form elements", async ({ page }) => {
      const _authHelper = new AuthHelper(page);

      // Check that we're on the login page
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByText("Login to Teak")).toBeVisible();

      // Check for social login buttons
      await expect(
        page.getByRole("button", { name: /continue with google/i })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /continue with apple/i })
      ).toBeVisible();

      // Check for email form
      await expect(page.getByLabel("Email")).toBeVisible();
      await expect(page.getByLabel("Password")).toBeVisible();
      await expect(page.getByRole("button", { name: /login/i })).toBeVisible();

      // Check for footer links
      await expect(
        page.getByRole("link", { name: /forgot your password/i })
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: /register with email/i })
      ).toBeVisible();
    });

    test("should navigate to register page", async ({ page }) => {
      await page.getByRole("link", { name: /register with email/i }).click();
      await expect(page).toHaveURL(/\/register/);
      await expect(page.getByText("Register", { exact: true })).toBeVisible();
    });

    test("should navigate to forgot password page", async ({ page }) => {
      await page.getByRole("link", { name: /forgot your password/i }).click();
      await expect(page).toHaveURL(/\/forgot-password/);
    });

    test("should show validation error for invalid email format", async ({
      page,
    }) => {
      await page.getByLabel("Email").fill("invalid-email");
      await page.getByLabel("Password").fill(TEST_PASSWORD);
      await page.getByRole("button", { name: /login/i }).click();

      // Browser's HTML5 validation should trigger
      const emailInput = page.getByLabel("Email");
      await expect(emailInput).toHaveAttribute("type", "email");
    });

    test("should show validation error for empty fields", async ({ page }) => {
      await page.getByRole("button", { name: /login/i }).click();

      // Check for required attribute validation
      const emailInput = page.getByLabel("Email");
      const isRequired = await emailInput.evaluate((el) =>
        el.hasAttribute("required")
      );
      expect(isRequired).toBe(true);
    });
  });

  test.describe("Registration Page", () => {
    test("should display registration form elements", async ({ page }) => {
      await page.goto("/register");

      // Check that we're on the register page
      await expect(page).toHaveURL(/\/register/);
      await expect(page.getByText("Register", { exact: true })).toBeVisible();

      // Check for social signup buttons
      await expect(
        page.getByRole("button", { name: /continue with google/i })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /continue with apple/i })
      ).toBeVisible();

      // Check for email form
      await expect(page.getByLabel("Email")).toBeVisible();
      await expect(page.getByLabel("Password")).toBeVisible();
      await expect(
        page.getByRole("button", { name: /create an account/i })
      ).toBeVisible();

      // Check for link to login
      await expect(
        page.getByRole("link", { name: /already have an account/i })
      ).toBeVisible();
    });

    test("should validate password minimum length", async ({ page }) => {
      await page.goto("/register");

      await page.getByLabel("Email").fill(TEST_EMAIL);
      await page.getByLabel("Password").fill("short"); // Less than 8 characters

      // Button should be disabled
      await expect(
        page.getByRole("button", { name: /create an account/i })
      ).toBeDisabled();
    });

    test("should enable submit button with valid password", async ({
      page,
    }) => {
      await page.goto("/register");

      await page.getByLabel("Email").fill(TEST_EMAIL);
      await page.getByLabel("Password").fill(TEST_PASSWORD);

      // Button should be enabled
      await expect(
        page.getByRole("button", { name: /create an account/i })
      ).toBeEnabled();
    });

    test("should navigate back to login page", async ({ page }) => {
      await page.goto("/register");
      await page
        .getByRole("link", { name: /already have an account/i })
        .click();
      await expect(page).toHaveURL(/\/login/);
    });

    test("should show password validation warning", async ({ page }) => {
      await page.goto("/register");

      const passwordInput = page.getByLabel("Password");
      await passwordInput.fill("short");
      await passwordInput.blur(); // Trigger validation

      // Should show error message
      await expect(
        page.getByText(/password must be at least 8 characters/i)
      ).toBeVisible();
      await expect(passwordInput).toHaveClass(/border-destructive/);
    });
  });

  test.describe("Email Authentication", () => {
    // biome-ignore lint/suspicious/noSkippedTests: Conditional test skip
    test.skip(
      !(
        process.env.E2E_BETTER_AUTH_USER_EMAIL &&
        process.env.E2E_BETTER_AUTH_USER_PASSWORD
      ),
      "Set E2E_BETTER_AUTH_USER_EMAIL and E2E_BETTER_AUTH_USER_PASSWORD to run email auth tests."
    );

    test("should sign in with valid credentials", async ({ page }) => {
      const email = process.env.E2E_BETTER_AUTH_USER_EMAIL!;
      const password = process.env.E2E_BETTER_AUTH_USER_PASSWORD!;
      const authHelper = new AuthHelper(page);

      // Sign up will create the user if they don't exist, or sign in if they do
      await authHelper.signUpWithEmailAndPassword(
        email,
        password,
        "E2E Test User"
      );

      // Should be redirected to home page
      await expect(page).toHaveURL("/");

      // Check that we're logged in by looking for authenticated content
      await expect(page.getByPlaceholder(/Write or add a link/i)).toBeVisible();
    });

    test("should show error for invalid credentials", async ({ page }) => {
      await page.goto("/login");

      await page.getByLabel("Email").fill("nonexistent@example.com");
      await page.getByLabel("Password").fill("WrongPassword123!");

      await page.getByRole("button", { name: /login/i }).click();

      // Should show an error message
      await expect(page.getByText(/invalid email or password/i)).toBeVisible({
        timeout: 5000,
      });
    });

    test("should redirect authenticated users to home", async ({ page }) => {
      const email = process.env.E2E_BETTER_AUTH_USER_EMAIL!;
      const password = process.env.E2E_BETTER_AUTH_USER_PASSWORD!;
      const authHelper = new AuthHelper(page);

      // First, sign up to create the user
      await authHelper.signUpWithEmailAndPassword(
        email,
        password,
        "E2E Test User"
      );

      // Try to go to login page again
      await page.goto("/login");

      // Should be redirected to home
      await expect(page).toHaveURL("/");
    });
  });

  test.describe("Sign Out Flow", () => {
    // biome-ignore lint/suspicious/noSkippedTests: Conditional test skip
    test.skip(
      !(
        process.env.E2E_BETTER_AUTH_USER_EMAIL &&
        process.env.E2E_BETTER_AUTH_USER_PASSWORD
      ),
      "Set E2E_BETTER_AUTH_USER_EMAIL and E2E_BETTER_AUTH_USER_PASSWORD to run sign out tests."
    );

    test("should sign out successfully", async ({ page }) => {
      const email = process.env.E2E_BETTER_AUTH_USER_EMAIL!;
      const password = process.env.E2E_BETTER_AUTH_USER_PASSWORD!;
      const authHelper = new AuthHelper(page);

      // Sign up first (creates and signs in the user)
      await authHelper.signUpWithEmailAndPassword(
        email,
        password,
        "E2E Test User"
      );
      await expect(page).toHaveURL("/");

      // Sign out
      await authHelper.signOut();

      // Should be redirected to login page
      await expect(page).toHaveURL("/login");

      // Try to access home page - should be redirected back to login
      await page.goto("/");
      await expect(page).toHaveURL("/login");
    });
  });

  test.describe("Protected Routes", () => {
    test("should redirect unauthenticated users to login", async ({ page }) => {
      // Try to access home page without authentication
      await page.goto("/");

      // Should be redirected to login
      await expect(page).toHaveURL("/login");
    });

    test("should redirect unauthenticated users from settings", async ({
      page,
    }) => {
      // Try to access settings page without authentication
      await page.goto("/settings");

      // Should be redirected to login
      await expect(page).toHaveURL("/login");
    });
  });

  test.describe("Password Visibility", () => {
    test("should have password input type", async ({ page }) => {
      await page.goto("/login");

      const passwordInput = page.getByLabel("Password");
      await expect(passwordInput).toHaveAttribute("type", "password");
    });
  });

  test.describe("Social Auth Buttons", () => {
    test("should show Google and Apple login options", async ({ page }) => {
      await page.goto("/login");

      const googleButton = page.getByRole("button", {
        name: /continue with google/i,
      });
      const appleButton = page.getByRole("button", {
        name: /continue with apple/i,
      });

      await expect(googleButton).toBeVisible();
      await expect(appleButton).toBeVisible();

      // Check for icons
      await expect(googleButton.locator("svg")).toBeVisible();
      await expect(appleButton.locator("svg")).toBeVisible();
    });

    test("should show Google and Apple signup options", async ({ page }) => {
      await page.goto("/register");

      const googleButton = page.getByRole("button", {
        name: /continue with google/i,
      });
      const appleButton = page.getByRole("button", {
        name: /continue with apple/i,
      });

      await expect(googleButton).toBeVisible();
      await expect(appleButton).toBeVisible();
    });
  });
});
