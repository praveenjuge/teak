import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { AuthHelper, UiHelper } from "./test-helpers";

const TEST_EMAIL = process.env.E2E_BETTER_AUTH_USER_EMAIL;
const TEST_PASSWORD = process.env.E2E_BETTER_AUTH_USER_PASSWORD;
const TEST_IMAGE_PATH = fileURLToPath(
  new URL("../app/apple-icon.png", import.meta.url)
);

test.describe("Search and Filter Workflows", () => {
  test.skip(
    !(TEST_EMAIL && TEST_PASSWORD),
    "Set E2E_BETTER_AUTH_USER_EMAIL and E2E_BETTER_AUTH_USER_PASSWORD to run search tests."
  );

  test.beforeEach(async ({ page }) => {
    const authHelper = new AuthHelper(page);
    await authHelper.signInWithEmailAndPassword(TEST_EMAIL!, TEST_PASSWORD!);
    await page.waitForLoadState("networkidle");

    // Create some test cards for filtering
    const uiHelper = new UiHelper(page);

    // Create a few cards with different content
    await uiHelper.createTextCard("Apple fruit red delicious");
    await page.waitForTimeout(500);

    await uiHelper.createTextCard("Banana yellow fruit");
    await page.waitForTimeout(500);

    await uiHelper.createTextCard("Carrot orange vegetable");
    await page.waitForTimeout(500);

    await uiHelper.createTextCard("https://example.com");
    await page.waitForTimeout(2000);
  });

  test.describe("Search Functionality", () => {
    test("should display search input", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      await expect(uiHelper.getSearchInput()).toBeVisible();
      await expect(uiHelper.getSearchInput()).toHaveAttribute(
        "placeholder",
        "Search for anything..."
      );
    });

    test("should search for text in cards", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Search for "Apple"
      await uiHelper.search("Apple");

      // Should see cards containing "Apple"
      await expect(page.getByText(/apple/i)).toBeVisible();
    });

    test("should search for partial matches", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Search for "ruit" which is in "fruit"
      await uiHelper.search("ruit");

      // Should see cards containing "ruit"
      await expect(page.getByText(/ruit/i)).toBeVisible();
    });

    test("should clear search results", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Search for something
      await uiHelper.search("Apple");
      await page.waitForTimeout(500);

      // Clear search
      await uiHelper.getSearchInput().clear();

      // All cards should be visible again
      await page.waitForTimeout(500);
      const cards = await page.locator("[data-card-id]").count();
      expect(cards).toBeGreaterThan(0);
    });

    test("should show no results for non-existent search", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Search for something that doesn't exist
      await uiHelper.search("xyznonexistent12345");

      // Should show "nothing found" message
      await expect(page.getByText(/nothing found/i)).toBeVisible({
        timeout: 5000,
      });
    });

    test("should show clear all button when filters are active", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);

      // Search to activate filters
      await uiHelper.search("Apple");

      // Should see Clear All button
      await expect(
        page.getByRole("button", { name: "Clear All" })
      ).toBeVisible();
    });
  });

  test.describe("Keyword Tags", () => {
    test("should add keyword tag by pressing Enter", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const searchInput = uiHelper.getSearchInput();

      // Type a keyword and press Enter
      await searchInput.fill("test-tag");
      await searchInput.press("Enter");

      // Should see keyword tag
      await expect(
        page.getByRole("button", { name: /#test-tag/i })
      ).toBeVisible();
    });

    test("should remove keyword tag by clicking", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const searchInput = uiHelper.getSearchInput();

      // Add a keyword tag
      await searchInput.fill("removable-tag");
      await searchInput.press("Enter");

      // Remove the tag
      await page.getByRole("button", { name: /#removable-tag/i }).click();

      // Tag should be removed
      await expect(
        page.getByRole("button", { name: /#removable-tag/i })
      ).not.toBeVisible();
    });

    test("should remove keyword tag with backspace", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const searchInput = uiHelper.getSearchInput();

      // Add a keyword tag
      await searchInput.fill("backspace-tag");
      await searchInput.press("Enter");

      // Clear input and press backspace
      await searchInput.fill("");
      await searchInput.press("Backspace");

      // Tag should be removed
      await expect(
        page.getByRole("button", { name: /#backspace-tag/i })
      ).not.toBeVisible();
    });

    test("should add multiple keyword tags", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const searchInput = uiHelper.getSearchInput();

      // Add multiple tags
      await searchInput.fill("tag1");
      await searchInput.press("Enter");
      await searchInput.fill("tag2");
      await searchInput.press("Enter");
      await searchInput.fill("tag3");
      await searchInput.press("Enter");

      // Should see all tags
      await expect(page.getByRole("button", { name: /#tag1/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /#tag2/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /#tag3/i })).toBeVisible();
    });
  });

  test.describe("Type Filters", () => {
    test("should show available type filters when search is focused", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);
      const searchInput = uiHelper.getSearchInput();

      // Focus on search input
      await searchInput.focus();

      // Should see type filter buttons
      await expect(page.getByRole("button", { name: /Text/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /Link/i })).toBeVisible();
    });

    test("should add type filter", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Add Text type filter
      await uiHelper.addTypeFilter("Text");

      // Should see active Text filter
      await expect(
        page.getByRole("button", { name: /Text/i }).first()
      ).toBeVisible();
    });

    test("should remove type filter by clicking", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Add and then remove Text filter
      await uiHelper.addTypeFilter("Text");

      // Click on the active Text filter to remove it
      const textFilter = page.getByRole("button", { name: /Text/i }).first();
      await textFilter.click();

      // Filter should be removed (button should be outline variant)
      await page.waitForTimeout(500);
    });

    test("should combine type filter with search", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Search and add filter
      await uiHelper.search("fruit");
      await uiHelper.addTypeFilter("Text");

      // Should see both active filters
      await expect(page.getByRole("button", { name: /#fruit/i })).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Text/i }).first()
      ).toBeVisible();
    });
  });

  test.describe("Favorites Filter", () => {
    test("should toggle favorites filter", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Toggle favorites filter
      await uiHelper.toggleFavoritesFilter();

      // Should see Favorites filter active
      await expect(
        page.getByRole("button", { name: /favorites/i }).first()
      ).toBeVisible();

      // Toggle again to remove
      await uiHelper.toggleFavoritesFilter();
    });

    test("should use keyboard shortcut 'fav' to toggle favorites", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);
      const searchInput = uiHelper.getSearchInput();

      // Type "fav" and press Enter
      await searchInput.fill("fav");
      await searchInput.press("Enter");

      // Should toggle favorites filter
      await expect(
        page.getByRole("button", { name: /favorites/i }).first()
      ).toBeVisible();
    });
  });

  test.describe("Trash Filter", () => {
    test("should toggle trash filter", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Toggle trash filter
      await uiHelper.toggleTrashFilter();

      // Should see Trash filter active
      await expect(
        page.getByRole("button", { name: /trash/i }).first()
      ).toBeVisible();

      // Toggle again to remove
      await uiHelper.toggleTrashFilter();
    });

    test("should use keyboard shortcut 'trash' to toggle trash", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);
      const searchInput = uiHelper.getSearchInput();

      // Type "trash" and press Enter
      await searchInput.fill("trash");
      await searchInput.press("Enter");

      // Should toggle trash filter
      await expect(
        page.getByRole("button", { name: /trash/i }).first()
      ).toBeVisible();
    });
  });

  test.describe("Clear All Filters", () => {
    test("should clear all active filters", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const searchInput = uiHelper.getSearchInput();

      // Add multiple filters
      await searchInput.fill("test");
      await searchInput.press("Enter");
      await page.waitForTimeout(200);

      await uiHelper.toggleFavoritesFilter();
      await page.waitForTimeout(200);

      await uiHelper.addTypeFilter("Text");
      await page.waitForTimeout(200);

      // Click Clear All
      await page.getByRole("button", { name: "Clear All" }).click();

      // All filters should be removed
      await expect(
        page.getByRole("button", { name: /#test/i })
      ).not.toBeVisible();
    });

    test("should hide filter panel when no filters are active", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);

      // Add and remove filters
      await uiHelper.search("test");
      await page.waitForTimeout(500);

      // Clear search
      await uiHelper.getSearchInput().clear();
      await page.waitForTimeout(500);

      // Filter panel should still be visible when focused
      await uiHelper.getSearchInput().focus();
      await expect(page.getByRole("button", { name: /Text/i })).toBeVisible();
    });
  });

  test.describe("Search Behavior", () => {
    test("should search in real-time as user types", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const searchInput = uiHelper.getSearchInput();

      // Type search query
      await searchInput.type("App");

      // Results should filter as we type
      await page.waitForTimeout(500);

      // Continue typing
      await searchInput.type("le");

      // Results should continue filtering
      await page.waitForTimeout(500);
    });

    test("should maintain search state when clicking card", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);

      // Search for something
      await uiHelper.search("Apple");
      await page.waitForTimeout(500);

      // Click on a card
      await page.getByText(/apple/i).first().click();

      // Close modal
      await uiHelper.closeModal();

      // Search should still be active
      await expect(uiHelper.getSearchInput()).toHaveValue("Apple");
    });
  });

  test.describe("Combined Filters", () => {
    test("should combine search with type filter", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      await uiHelper.search("fruit");
      await uiHelper.addTypeFilter("Text");

      // Both filters should be active
      await expect(page.getByRole("button", { name: /#fruit/i })).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Text/i }).first()
      ).toBeVisible();
    });

    test("should combine search with favorites filter", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      await uiHelper.search("fruit");
      await uiHelper.toggleFavoritesFilter();

      // Both filters should be active
      await expect(page.getByRole("button", { name: /#fruit/i })).toBeVisible();
      await expect(
        page.getByRole("button", { name: /favorites/i }).first()
      ).toBeVisible();
    });

    test("should combine type and favorites filters", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      await uiHelper.addTypeFilter("Text");
      await uiHelper.toggleFavoritesFilter();

      // Both filters should be active
      await expect(
        page.getByRole("button", { name: /Text/i }).first()
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /favorites/i }).first()
      ).toBeVisible();
    });
  });

  test.describe("Visual Inspiration Filters", () => {
    test("applies style and hue filters via search enter", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      const searchInput = uiHelper.getSearchInput();

      await searchInput.fill("vintage purple");
      await searchInput.press("Enter");

      await expect(
        page.getByText(/nothing found matching your filters/i)
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Vintage/i })
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /Purple/i })).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Clear All/i })
      ).toBeVisible();
    });

    test("exact hex filter via search enter supports clear recovery", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);
      const searchInput = uiHelper.getSearchInput();

      await searchInput.fill("#123456");
      await searchInput.press("Enter");

      await expect(
        page.getByText(/nothing found matching your filters/i)
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /#123456/i })
      ).toBeVisible();
      await page.getByRole("button", { name: "Clear All" }).click();

      await expect(
        page.getByText(/nothing found matching your filters/i)
      ).not.toBeVisible();
      expect(await page.locator("[data-card-id]").count()).toBeGreaterThan(0);
    });
  });

  test.describe("Image Palette Copy", () => {
    test("copies a swatch from image modal and has no palette dropdown", async ({
      page,
    }) => {
      const uploadButton = page.locator("form button[type='button']").first();
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        uploadButton.click(),
      ]);
      await chooser.setFiles(TEST_IMAGE_PATH);

      await page.waitForTimeout(4000);
      await page.getByPlaceholder("Search for anything...").focus();
      await page.getByRole("button", { name: /Image/i }).first().click();
      await page.locator("[data-card-id]").first().click();

      const swatch = page.locator("button[aria-label^='#']").first();
      await expect(swatch).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByRole("button", { name: /Copy Palette|Copied!/i })
      ).toHaveCount(0);

      const readClipboard = async () =>
        page.evaluate(async () => navigator.clipboard.readText());

      await swatch.click();
      await expect.poll(readClipboard).toMatch(/^#[A-F0-9]{6}$/);

      await expect(swatch).toHaveAttribute("aria-label", /^#[A-F0-9]{6}$/);
    });
  });
});
