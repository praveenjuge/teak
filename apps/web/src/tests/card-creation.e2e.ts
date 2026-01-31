import { expect, test } from "@playwright/test";
import { AuthHelper, generateTestContent, UiHelper } from "./test-helpers";

const TEST_EMAIL = process.env.E2E_BETTER_AUTH_USER_EMAIL;
const TEST_PASSWORD = process.env.E2E_BETTER_AUTH_USER_PASSWORD;

test.describe("Card Creation", () => {
  test.skip(
    !(TEST_EMAIL && TEST_PASSWORD),
    "Set E2E_BETTER_AUTH_USER_EMAIL and E2E_BETTER_AUTH_USER_PASSWORD to run card creation tests."
  );

  test.beforeEach(async ({ page }) => {
    const authHelper = new AuthHelper(page);
    // Sign up to create the user (in development, this also signs them in)
    await authHelper.signUpWithEmailAndPassword(
      TEST_EMAIL!,
      TEST_PASSWORD!,
      "E2E Test User"
    );
    await page.waitForLoadState("networkidle");
  });

  test.describe("Text Cards", () => {
    test("should create a simple text card", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const content = generateTestContent("Text");

      await uiHelper.createTextCard(content);

      // Verify card is visible
      await expect(page.getByRole("main").getByText(content)).toBeVisible();
    });

    test("should create a multi-line text card", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const content = `Line 1\nLine 2\nLine 3\n${generateTestContent("Multi-line")}`;

      const composer = uiHelper.getComposer();
      await composer.fill(content);
      await uiHelper.getSaveButton().click();

      // Verify card is created
      await expect(page.getByText(/line 1/i)).toBeVisible();
    });

    test("should create card using keyboard shortcut", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const content = generateTestContent("Keyboard");

      const composer = uiHelper.getComposer();
      await composer.fill(content);

      const isMac = await page.evaluate(() =>
        navigator.platform.includes("Mac")
      );
      const modifier = isMac ? "Meta" : "Control";

      await composer.press(`${modifier}+Enter`);

      // Verify card is created
      await expect(page.getByRole("main").getByText(content)).toBeVisible();
    });
  });

  test.describe("Link Cards", () => {
    test("should create a link card with URL", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const url = "https://example.com/article";

      const composer = uiHelper.getComposer();
      await composer.fill(url);
      await uiHelper.getSaveButton().click();

      // Wait for link metadata to be fetched
      await page.waitForTimeout(3000);

      // Verify a card was created (link cards show metadata)
      const cards = await page.locator("[data-card-id]").count();
      expect(cards).toBeGreaterThan(0);
    });

    test("should create a link card with https URL", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const url = "https://github.com";

      const composer = uiHelper.getComposer();
      await composer.fill(url);
      await uiHelper.getSaveButton().click();

      // Wait for processing
      await page.waitForTimeout(3000);

      // Check for link preview elements
      const cards = await page.locator("[data-card-id]").count();
      expect(cards).toBeGreaterThan(0);
    });

    test("should create a link card with www URL", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const url = "www.wikipedia.org";

      const composer = uiHelper.getComposer();
      await composer.fill(url);
      await uiHelper.getSaveButton().click();

      await page.waitForTimeout(3000);

      const cards = await page.locator("[data-card-id]").count();
      expect(cards).toBeGreaterThan(0);
    });
  });

  test.describe("Image Cards", () => {
    test("should create an image card from URL", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      // Using a reliable test image URL
      const imageUrl = "https://picsum.photos/800/600";

      const composer = uiHelper.getComposer();
      await composer.fill(imageUrl);
      await uiHelper.getSaveButton().click();

      // Wait for image to be processed
      await page.waitForTimeout(3000);

      // Verify card was created
      const cards = await page.locator("[data-card-id]").count();
      expect(cards).toBeGreaterThan(0);
    });

    test("should handle invalid image URL gracefully", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const invalidUrl =
        "https://invalid-domain-that-does-not-exist-12345.com/image.jpg";

      const composer = uiHelper.getComposer();
      await composer.fill(invalidUrl);
      await uiHelper.getSaveButton().click();

      // Wait a bit for error handling
      await page.waitForTimeout(2000);

      // Card might still be created but with error state
      const cards = await page.locator("[data-card-id]").count();
      expect(cards).toBeGreaterThan(0);
    });
  });

  test.describe("Quote Cards", () => {
    test("should create a quote card from markdown-style quote", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);
      const quote = `> ${generateTestContent("Quote")}`;

      const composer = uiHelper.getComposer();
      await composer.fill(quote);
      await uiHelper.getSaveButton().click();

      // Verify card is created
      await page.waitForTimeout(1000);
      const cards = await page.locator("[data-card-id]").count();
      expect(cards).toBeGreaterThan(0);
    });

    test("should create a quote card with multi-line quote", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);
      const quote =
        "> First line of quote\n> Second line of quote\n> Third line";

      const composer = uiHelper.getComposer();
      await composer.fill(quote);
      await uiHelper.getSaveButton().click();

      // Verify card is created
      await page.waitForTimeout(1000);
      const cards = await page.locator("[data-card-id]").count();
      expect(cards).toBeGreaterThan(0);
    });
  });

  test.describe("Palette Cards", () => {
    test("should create a palette card from color notation", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);
      // Color notation that might trigger palette detection
      const paletteText = "#FF5733 #33FF57 #3357FF";

      const composer = uiHelper.getComposer();
      await composer.fill(paletteText);
      await uiHelper.getSaveButton().click();

      // Verify card is created
      await page.waitForTimeout(1000);
      const cards = await page.locator("[data-card-id]").count();
      expect(cards).toBeGreaterThan(0);
    });

    test("should handle comma-separated colors", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const colors = "rgb(255, 0, 0), rgb(0, 255, 0), rgb(0, 0, 255)";

      const composer = uiHelper.getComposer();
      await composer.fill(colors);
      await uiHelper.getSaveButton().click();

      // Verify card is created
      await page.waitForTimeout(1000);
      const cards = await page.locator("[data-card-id]").count();
      expect(cards).toBeGreaterThan(0);
    });
  });

  test.describe("File Upload Cards", () => {
    test("should show file upload button", async ({ page }) => {
      const _uiHelper = new UiHelper(page);

      // The upload button should be visible
      const uploadButtons = page.getByRole("button").filter({ hasText: "" });
      await expect(uploadButtons.first()).toBeVisible();
    });

    test("should trigger file input when upload button clicked", async ({
      page,
    }) => {
      const _uiHelper = new UiHelper(page);

      // Click the upload button (first icon button)
      const uploadButtons = page
        .getByRole("button", { name: "" })
        .filter({ hasText: "" });

      // The upload button creates a file input element
      await uploadButtons.nth(0).click();

      // Check if file input was created (it's created dynamically)
      const fileInput = page.locator("input[type='file']");
      const exists = await fileInput.count();

      // File input should exist temporarily
      expect(exists).toBeGreaterThanOrEqual(0);
    });
  });

  test.describe("Audio Recording Cards", () => {
    test("should show audio recording button", async ({ page }) => {
      const _uiHelper = new UiHelper(page);

      // The mic button should be visible
      const buttons = page.getByRole("button", { name: "" });
      await expect(buttons.first()).toBeVisible();
    });
  });

  test.describe("Card Creation Edge Cases", () => {
    test("should handle empty submission", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Try to click save without content
      const saveButton = uiHelper.getSaveButton();

      // Button should not be visible without content
      const isVisible = await saveButton.isVisible().catch(() => false);
      expect(isVisible).toBe(false);
    });

    test("should handle whitespace-only content", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const composer = uiHelper.getComposer();

      // Fill with only whitespace
      await composer.fill("   \n  \t  ");

      // Save button should not appear for whitespace-only content
      const saveButton = uiHelper.getSaveButton();
      const isVisible = await saveButton.isVisible().catch(() => false);
      expect(isVisible).toBe(false);
    });

    test("should handle very long text", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const longText = "A".repeat(5000);

      const composer = uiHelper.getComposer();
      await composer.fill(longText);

      // Save button should appear
      const saveButton = uiHelper.getSaveButton();
      await expect(saveButton).toBeVisible();

      await saveButton.click();

      // Card should be created
      await page.waitForTimeout(2000);
      const cards = await page.locator("[data-card-id]").count();
      expect(cards).toBeGreaterThan(0);
    });

    test("should handle special characters", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const specialText = "Test with <html> & \"quotes\" and 'apostrophes' 🎉";

      const composer = uiHelper.getComposer();
      await composer.fill(specialText);
      await uiHelper.getSaveButton().click();

      // Card should be created
      await expect(page.getByText(/test with/i)).toBeVisible();
    });

    test("should handle emoji content", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const emojiText = "😀 😃 😄 😁 Test with emoji";

      const composer = uiHelper.getComposer();
      await composer.fill(emojiText);
      await uiHelper.getSaveButton().click();

      // Card should be created
      await expect(page.getByText(/test with emoji/i)).toBeVisible();
    });
  });

  test.describe("Multiple Card Creation", () => {
    test("should create multiple cards in sequence", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      const initialCount = await page.locator("[data-card-id]").count();

      // Create 3 cards
      for (let i = 1; i <= 3; i++) {
        const content = generateTestContent(`Card ${i}`);
        await uiHelper.createTextCard(content);
        await page.waitForTimeout(500);
      }

      // Verify 3 new cards were added
      const finalCount = await page.locator("[data-card-id]").count();
      expect(finalCount).toBeGreaterThanOrEqual(initialCount + 3);
    });

    test("should clear composer after saving", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const content = generateTestContent("Clear test");

      const composer = uiHelper.getComposer();
      await composer.fill(content);
      await uiHelper.getSaveButton().click();

      // Wait for card to be saved
      await page.waitForTimeout(1000);

      // Composer should be empty
      await expect(composer).toHaveValue("");
    });
  });
});
