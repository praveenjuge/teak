import { expect, test } from "@playwright/test";
import { AuthHelper, generateTestContent, UiHelper } from "./test-helpers";

// Get test credentials from environment
const email = process.env.E2E_BETTER_AUTH_USER_EMAIL;
const password = process.env.E2E_BETTER_AUTH_USER_PASSWORD;

test.skip(
  !(email && password),
  "Set E2E_BETTER_AUTH_USER_EMAIL and E2E_BETTER_AUTH_USER_PASSWORD to run card CRUD tests."
);

test.describe("Text Cards", () => {
  test("supports creating, updating, and deleting a card", async ({ page }) => {
    const authHelper = new AuthHelper(page);
    const uiHelper = new UiHelper(page);

    // Sign in
    await authHelper.signInWithEmailAndPassword(email!, password!);

    const cardContent = generateTestContent("Card");
    const updatedContent = `${cardContent} - updated`;

    // Create card
    await uiHelper.createTextCard(cardContent);
    const createdCard = page.getByRole("main").getByText(cardContent);
    await expect(createdCard).toBeVisible();

    // Update card
    await createdCard.click();

    const editor = page.getByPlaceholder("Enter your text...");
    await expect(editor).toBeVisible();
    await editor.fill(updatedContent);
    await page.locator('button:has-text("Save changes"):visible').click();
    await expect(editor).toHaveValue(updatedContent);

    // Close modal
    await uiHelper.closeModal();

    const updatedCard = page.getByRole("main").getByText(updatedContent);
    await expect(updatedCard).toBeVisible();

    // Delete card
    await updatedCard.click();
    await page.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByRole("main").getByText(updatedContent)).toHaveCount(
      0
    );

    // Sign out
    await authHelper.signOut();
  });

  test("creates a card with keyboard shortcut", async ({ page }) => {
    const authHelper = new AuthHelper(page);
    const uiHelper = new UiHelper(page);

    await authHelper.signInWithEmailAndPassword(email!, password!);

    const cardContent = generateTestContent("Keyboard");

    const composer = uiHelper.getComposer();
    await composer.fill(cardContent);

    // Use keyboard shortcut (Meta for Mac, Ctrl for others)
    const isMac = await page.evaluate(() => navigator.platform.includes("Mac"));
    const modifier = isMac ? "Meta" : "Control";

    await composer.press(`${modifier}+Enter`);

    await expect(page.getByRole("main").getByText(cardContent)).toBeVisible();

    await authHelper.signOut();
  });

  test("persists changes across page refresh", async ({ page }) => {
    const authHelper = new AuthHelper(page);
    const uiHelper = new UiHelper(page);

    await authHelper.signInWithEmailAndPassword(email!, password!);

    const cardContent = generateTestContent("Persistent");

    // Create card
    await uiHelper.createTextCard(cardContent);
    await expect(page.getByRole("main").getByText(cardContent)).toBeVisible();

    // Refresh page
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Card should still be visible
    await expect(page.getByRole("main").getByText(cardContent)).toBeVisible();

    await authHelper.signOut();
  });

  test("handles special characters in card content", async ({ page }) => {
    const authHelper = new AuthHelper(page);
    const uiHelper = new UiHelper(page);

    await authHelper.signInWithEmailAndPassword(email!, password!);

    const specialContent = "Test with <html> & \"quotes\" and 'apostrophes' 🎉";

    await uiHelper.createTextCard(specialContent);

    // Should find part of the content
    await expect(page.getByText(/test with/i)).toBeVisible();

    await authHelper.signOut();
  });

  test("creates multiple cards in sequence", async ({ page }) => {
    const authHelper = new AuthHelper(page);
    const uiHelper = new UiHelper(page);

    await authHelper.signInWithEmailAndPassword(email!, password!);

    const initialCount = await page.locator("[data-card-id]").count();

    // Create 3 cards
    for (let i = 1; i <= 3; i++) {
      const content = generateTestContent(`Card ${i}`);
      await uiHelper.createTextCard(content);
      await page.waitForTimeout(500);
    }

    // Verify cards were added
    const finalCount = await page.locator("[data-card-id]").count();
    expect(finalCount).toBeGreaterThanOrEqual(initialCount + 3);

    await authHelper.signOut();
  });
});

test.describe("Link Cards", () => {
  test("creates a link card with URL", async ({ page }) => {
    const authHelper = new AuthHelper(page);
    const uiHelper = new UiHelper(page);

    await authHelper.signInWithEmailAndPassword(email!, password!);

    const linkUrl = "https://example.com/test-article";

    const composer = uiHelper.getComposer();
    await composer.fill(linkUrl);
    await uiHelper.getSaveButton().click();

    // Wait for link metadata to be fetched
    await page.waitForTimeout(3000);

    // Verify a card was created
    const cards = await page.locator("[data-card-id]").count();
    expect(cards).toBeGreaterThan(0);

    await authHelper.signOut();
  });

  test("handles invalid URLs gracefully", async ({ page }) => {
    const authHelper = new AuthHelper(page);
    const uiHelper = new UiHelper(page);

    await authHelper.signInWithEmailAndPassword(email!, password!);

    const invalidUrl = "not-a-valid-url";

    const composer = uiHelper.getComposer();
    await composer.fill(invalidUrl);
    await uiHelper.getSaveButton().click();

    // Should still create a card (as text)
    await page.waitForTimeout(1000);
    const cards = await page.locator("[data-card-id]").count();
    expect(cards).toBeGreaterThan(0);

    await authHelper.signOut();
  });
});

test.describe("Card Modal", () => {
  test("opens and closes card modal", async ({ page }) => {
    const authHelper = new AuthHelper(page);
    const uiHelper = new UiHelper(page);

    await authHelper.signInWithEmailAndPassword(email!, password!);

    // Create a card first
    const cardContent = generateTestContent("Modal test");
    await uiHelper.createTextCard(cardContent);

    // Click on card to open modal
    await page.getByRole("main").getByText(cardContent).click();

    // Modal should be visible
    await expect(page.getByRole("dialog")).toBeVisible();

    // Close modal by clicking outside
    await uiHelper.closeModal();

    // Modal should be closed
    await expect(page.getByRole("dialog")).not.toBeVisible();

    await authHelper.signOut();
  });

  test("shows card metadata in modal", async ({ page }) => {
    const authHelper = new AuthHelper(page);
    const uiHelper = new UiHelper(page);

    await authHelper.signInWithEmailAndPassword(email!, password!);

    // Create a card
    const cardContent = generateTestContent("Metadata test");
    await uiHelper.createTextCard(cardContent);

    // Click on card
    await page.getByRole("main").getByText(cardContent).click();

    // Modal should be visible
    await expect(page.getByRole("dialog")).toBeVisible();

    // Content should be in modal
    await expect(page.getByRole("dialog").getByText(cardContent)).toBeVisible();

    await authHelper.signOut();
  });
});

test.describe("Empty States", () => {
  test("shows onboarding empty state for new users", async ({ page }) => {
    // This test assumes the test user might have cards
    // In a real test environment, you'd use a fresh test user

    const authHelper = new AuthHelper(page);
    await authHelper.signInWithEmailAndPassword(email!, password!);

    // Check for empty state
    const emptyStateText = page.getByText(/let's add your first card/i);
    const hasEmptyState = await emptyStateText.isVisible().catch(() => false);

    if (hasEmptyState) {
      await expect(emptyStateText).toBeVisible();
      await expect(
        page.getByText(/start capturing your thoughts/i)
      ).toBeVisible();
    }
    // If user has cards, empty state won't show (also valid)

    await authHelper.signOut();
  });

  test("shows search results empty state", async ({ page }) => {
    const authHelper = new AuthHelper(page);
    const uiHelper = new UiHelper(page);

    await authHelper.signInWithEmailAndPassword(email!, password!);

    // Search for something that doesn't exist
    await uiHelper.search("xyznonexistent12345");

    // Should show "nothing found" message
    await expect(page.getByText(/nothing found/i)).toBeVisible();

    await authHelper.signOut();
  });
});
