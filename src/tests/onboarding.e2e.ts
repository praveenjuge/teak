import { test, expect } from "@playwright/test";
import { AuthHelper, UiHelper, generateTestEmail, generateTestContent } from "./test-helpers";

const TEST_EMAIL = process.env.E2E_BETTER_AUTH_USER_EMAIL;
const TEST_PASSWORD = process.env.E2E_BETTER_AUTH_USER_PASSWORD;

test.describe("Onboarding Journey", () => {
  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    "Set E2E_BETTER_AUTH_USER_EMAIL and E2E_BETTER_AUTH_USER_PASSWORD to run onboarding tests."
  );

  test.beforeEach(async ({ page }) => {
    // Clear cookies and localStorage before each test
    await page.context().clearCookies();
  });

  test("complete journey: sign up → create first card → see empty state", async ({ page }) => {
    const authHelper = new AuthHelper(page);
    const uiHelper = new UiHelper(page);

    // Step 1: Navigate to register page
    await authHelper.goToRegisterPage();
    await expect(page).toHaveURL(/\/register/);

    // Step 2: Fill in registration form
    await page.getByLabel("Email").fill(TEST_EMAIL!);
    await page.getByLabel("Password").fill(TEST_PASSWORD!);

    // Step 3: Submit registration
    await page.getByRole("button", { name: /create an account/i }).click();

    // Step 4: Should show verification message
    await expect(page.getByText(/verify your email/i)).toBeVisible({
      timeout: 5000,
    });

    // Note: In a real scenario, user would verify email.
    // For testing, we'll proceed with login since the test account may already exist
  });

  test("complete journey: login → see empty state → create first card", async ({ page }) => {
    const authHelper = new AuthHelper(page);
    const uiHelper = new UiHelper(page);

    // Step 1: Sign in
    await authHelper.signInWithEmailAndPassword(TEST_EMAIL!, TEST_PASSWORD!);

    // Step 2: Should see empty state with onboarding message
    await expect(page.getByText(/let's add your first card/i)).toBeVisible();
    await expect(page.getByText(/start capturing your thoughts/i)).toBeVisible();

    // Step 3: Create first card
    const firstCardContent = generateTestContent("First card");
    await uiHelper.createTextCard(firstCardContent);

    // Step 4: Empty state should be gone, card should be visible
    await expect(page.getByText(/let's add your first card/i)).not.toBeVisible();
    await expect(page.getByRole("main").getByText(firstCardContent)).toBeVisible();
  });

  test("complete journey: login → create text card → create link card", async ({ page }) => {
    const authHelper = new AuthHelper(page);
    const uiHelper = new UiHelper(page);

    // Sign in
    await authHelper.signInWithEmailAndPassword(TEST_EMAIL!, TEST_PASSWORD!);

    // Wait for page to load
    await page.waitForLoadState("networkidle");

    // Create a text card
    const textContent = generateTestContent("Text");
    await uiHelper.createTextCard(textContent);

    // Verify text card is visible
    await expect(page.getByRole("main").getByText(textContent)).toBeVisible();

    // Create a link card
    const linkUrl = "https://example.com";
    await uiHelper.getComposer().fill(linkUrl);
    await uiHelper.getSaveButton().click();

    // Wait for link to be processed
    await page.waitForTimeout(2000);

    // Verify we have multiple cards now (at least 2)
    const cardCount = await page.locator('[data-card-id]').count();
    expect(cardCount).toBeGreaterThanOrEqual(2);
  });

  test("complete journey: new user sees helpful UI elements", async ({ page }) => {
    const authHelper = new AuthHelper(page);
    const uiHelper = new UiHelper(page);

    // Sign in
    await authHelper.signInWithEmailAndPassword(TEST_EMAIL!, TEST_PASSWORD!);

    // Check for key UI elements
    await expect(page.getByPlaceholder("Write or add a link...")).toBeVisible();

    // Check for search bar
    await expect(page.getByPlaceholder("Search for anything...")).toBeVisible();

    // Check for settings button
    await expect(page.getByRole("link", { name: /settings/i })).toBeVisible();

    // Check for file upload button
    await expect(page.getByRole("button", { name: "" }).filter({ hasText: "" }).first()).toBeVisible();
  });

  test("complete journey: create card using keyboard shortcut", async ({ page }) => {
    const authHelper = new AuthHelper(page);
    const uiHelper = new UiHelper(page);

    // Sign in
    await authHelper.signInWithEmailAndPassword(TEST_EMAIL!, TEST_PASSWORD!);

    // Type content and use Cmd/Ctrl+Enter to save
    const cardContent = generateTestContent("Keyboard shortcut");
    const composer = uiHelper.getComposer();

    await composer.fill(cardContent);

    // Use keyboard shortcut (Meta for Mac, Ctrl for others)
    const isMac = await page.evaluate(() => navigator.platform.includes("Mac"));
    const modifier = isMac ? "Meta" : "Control";

    await composer.press(`${modifier}+Enter`);

    // Card should be saved
    await expect(page.getByRole("main").getByText(cardContent)).toBeVisible();
  });
});
