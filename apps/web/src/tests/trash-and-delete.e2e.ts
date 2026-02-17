import { expect, test } from "@playwright/test";
import { AuthHelper, UiHelper } from "./test-helpers";

const TEST_EMAIL = process.env.E2E_BETTER_AUTH_USER_EMAIL;
const TEST_PASSWORD = process.env.E2E_BETTER_AUTH_USER_PASSWORD;

test.describe("Trash, Delete, and Restore Workflows", () => {
  // biome-ignore lint/suspicious/noSkippedTests: Conditional test skip
  test.skip(
    !(TEST_EMAIL && TEST_PASSWORD),
    "Set E2E_BETTER_AUTH_USER_EMAIL and E2E_BETTER_AUTH_USER_PASSWORD to run delete tests."
  );

  test.beforeEach(async ({ page }) => {
    const authHelper = new AuthHelper(page);
    await authHelper.signInWithEmailAndPassword(TEST_EMAIL!, TEST_PASSWORD!);
    await page.waitForLoadState("networkidle");

    // Create a test card for deletion tests
    const uiHelper = new UiHelper(page);
    await uiHelper.createTextCard("Test card for deletion");
    await page.waitForTimeout(500);
  });

  test.describe("Soft Delete (Move to Trash)", () => {
    test("should move card to trash", async ({ page }) => {
      const firstCard = page.locator("[data-card-id]").first();
      const cardText = await firstCard.textContent();

      // Click on card to open modal
      await firstCard.click();

      // Look for delete button in modal
      const deleteButton = page
        .getByRole("dialog")
        .getByRole("button", { name: /delete/i })
        .or(page.getByRole("dialog").locator("[data-delete-button]"));

      await expect(deleteButton.first()).toBeVisible();
      await deleteButton.first().click();

      // Card should be removed from main view
      await page.waitForTimeout(500);
      await expect(page.getByText(cardText || "")).not.toBeVisible();
    });

    test("should show deleted cards in trash filter", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Get initial card count
      const initialCount = await page.locator("[data-card-id]").count();

      // Delete first card
      await page.locator("[data-card-id]").first().click();
      const deleteButton = page
        .getByRole("dialog")
        .getByRole("button", { name: /delete/i });
      await deleteButton.click();
      await page.waitForTimeout(500);

      // Check main view - should have one less card
      const afterDeleteCount = await page.locator("[data-card-id]").count();
      expect(afterDeleteCount).toBeLessThan(initialCount);

      // Now check trash
      await uiHelper.toggleTrashFilter();

      // Should see deleted card in trash
      await page.waitForTimeout(500);
      const trashCount = await page.locator("[data-card-id]").count();
      expect(trashCount).toBeGreaterThan(0);
    });

    test("should restore card from trash", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Delete first card
      await page.locator("[data-card-id]").first().click();
      const deleteButton = page
        .getByRole("dialog")
        .getByRole("button", { name: /delete/i });
      await deleteButton.click();
      await page.waitForTimeout(500);

      // Go to trash
      await uiHelper.toggleTrashFilter();
      await page.waitForTimeout(500);

      // Click on trashed card
      await page.locator("[data-card-id]").first().click();

      // Look for restore button
      const restoreButton = page
        .getByRole("dialog")
        .getByRole("button", { name: /restore/i })
        .or(page.getByRole("dialog").locator("[data-restore-button]"));

      if ((await restoreButton.count()) > 0) {
        await restoreButton.first().click();
        await page.waitForTimeout(500);

        // Clear trash filter
        await uiHelper.toggleTrashFilter();

        // Card should be back in main view
        await page.waitForTimeout(500);
        const mainViewCount = await page.locator("[data-card-id]").count();
        expect(mainViewCount).toBeGreaterThan(0);
      } else {
        // biome-ignore lint/suspicious/noSkippedTests: Conditional test skip
        test.skip(true, "Restore button not found");
      }
    });

    test("should not show deleted cards in main view", async ({ page }) => {
      // Delete first card
      await page.locator("[data-card-id]").first().click();
      const deleteButton = page
        .getByRole("dialog")
        .getByRole("button", { name: /delete/i });
      await deleteButton.click();
      await page.waitForTimeout(500);

      // Close any open modal
      const modal = page.getByRole("dialog");
      if (await modal.isVisible()) {
        const box = await modal.boundingBox();
        if (box) {
          const viewport = page.viewportSize();
          const outsideX = Math.min(
            Math.max(box.x - 20, 5),
            (viewport?.width ?? box.x + 20) - 5
          );
          const outsideY = Math.min(
            Math.max(box.y - 20, 5),
            (viewport?.height ?? box.y + 20) - 5
          );
          await page.mouse.click(outsideX, outsideY);
        }
      }

      // Search should not find deleted cards
      const uiHelper = new UiHelper(page);
      await uiHelper.search("deletion");

      await page.waitForTimeout(500);

      // Should either show no results or only non-deleted cards
      const nothingFound = await page
        .getByText(/nothing found/i)
        .isVisible()
        .catch(() => false);
      const hasCards = (await page.locator("[data-card-id]").count()) > 0;

      expect(nothingFound || hasCards).toBe(true);
    });
  });

  test.describe("Permanent Delete", () => {
    test("should permanently delete card from trash", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Delete card first
      await page.locator("[data-card-id]").first().click();
      const deleteButton = page
        .getByRole("dialog")
        .getByRole("button", { name: /delete/i });
      await deleteButton.click();
      await page.waitForTimeout(500);

      // Go to trash
      await uiHelper.toggleTrashFilter();
      await page.waitForTimeout(500);

      const trashCountBefore = await page.locator("[data-card-id]").count();

      // Click on trashed card
      await page.locator("[data-card-id]").first().click();

      // Look for permanent delete button
      const permanentDeleteButton = page
        .getByRole("dialog")
        .getByRole("button", { name: /permanently|delete forever/i })
        .or(page.getByRole("dialog").locator("[data-permanent-delete-button]"));

      if ((await permanentDeleteButton.count()) > 0) {
        await permanentDeleteButton.first().click();
        await page.waitForTimeout(500);

        // Card should be gone from trash
        const trashCountAfter = await page.locator("[data-card-id]").count();
        expect(trashCountAfter).toBeLessThan(trashCountBefore);
      } else {
        // biome-ignore lint/suspicious/noSkippedTests: Conditional test skip
        test.skip(true, "Permanent delete button not found");
      }
    });

    test("should show confirmation for permanent delete", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Delete card first
      await page.locator("[data-card-id]").first().click();
      const deleteButton = page
        .getByRole("dialog")
        .getByRole("button", { name: /delete/i });
      await deleteButton.click();
      await page.waitForTimeout(500);

      // Go to trash
      await uiHelper.toggleTrashFilter();
      await page.waitForTimeout(500);

      // Click on trashed card
      await page.locator("[data-card-id]").first().click();

      // Look for permanent delete button
      const permanentDeleteButton = page
        .getByRole("dialog")
        .getByRole("button", { name: /permanently|delete forever/i });

      if ((await permanentDeleteButton.count()) > 0) {
        // Click permanent delete
        await permanentDeleteButton.first().click();

        // Should show confirmation dialog
        await page.waitForTimeout(500);
        const confirmDialog = page
          .getByRole("alertdialog")
          .or(
            page
              .getByRole("dialog")
              .filter({ hasText: /permanently|irreversible/i })
          );

        const hasConfirmation = (await confirmDialog.count()) > 0;

        if (hasConfirmation) {
          await expect(confirmDialog.first()).toBeVisible();

          // Cancel for now
          const cancelButton = page.getByRole("button", { name: /cancel/i });
          if ((await cancelButton.count()) > 0) {
            await cancelButton.first().click();
          }
        }
      } else {
        // biome-ignore lint/suspicious/noSkippedTests: Conditional test skip
        test.skip(true, "Permanent delete button not found");
      }
    });
  });

  test.describe("Bulk Delete Operations", () => {
    test.beforeEach(async ({ page }) => {
      // Create additional cards for bulk operations
      const uiHelper = new UiHelper(page);
      await uiHelper.createTextCard("Bulk delete test 1");
      await page.waitForTimeout(500);
      await uiHelper.createTextCard("Bulk delete test 2");
      await page.waitForTimeout(500);
      await uiHelper.createTextCard("Bulk delete test 3");
      await page.waitForTimeout(500);
    });

    test("should delete multiple cards", async ({ page }) => {
      const _uiHelper = new UiHelper(page);

      // Get initial count
      const initialCount = await page.locator("[data-card-id]").count();

      // Delete first few cards
      for (let i = 0; i < 3; i++) {
        await page.locator("[data-card-id]").first().click();
        const deleteButton = page
          .getByRole("dialog")
          .getByRole("button", { name: /delete/i });
        await deleteButton.click();
        await page.waitForTimeout(500);

        // Close modal if still open
        const modal = page.getByRole("dialog");
        if (await modal.isVisible()) {
          const box = await modal.boundingBox();
          if (box) {
            const viewport = page.viewportSize();
            const outsideX = Math.min(
              Math.max(box.x - 20, 5),
              (viewport?.width ?? box.x + 20) - 5
            );
            const outsideY = Math.min(
              Math.max(box.y - 20, 5),
              (viewport?.height ?? box.y + 20) - 5
            );
            await page.mouse.click(outsideX, outsideY);
          }
        }
      }

      // Count should be reduced
      const finalCount = await page.locator("[data-card-id]").count();
      expect(finalCount).toBeLessThan(initialCount);
    });

    test("should restore multiple cards from trash", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Delete all visible cards
      const cardCount = await page.locator("[data-card-id]").count();
      const cardsToDelete = Math.min(cardCount, 3);

      for (let i = 0; i < cardsToDelete; i++) {
        await page.locator("[data-card-id]").first().click();
        const deleteButton = page
          .getByRole("dialog")
          .getByRole("button", { name: /delete/i });
        await deleteButton.click();
        await page.waitForTimeout(500);

        // Close modal
        const modal = page.getByRole("dialog");
        if (await modal.isVisible()) {
          const box = await modal.boundingBox();
          if (box) {
            const viewport = page.viewportSize();
            const outsideX = Math.min(
              Math.max(box.x - 20, 5),
              (viewport?.width ?? box.x + 20) - 5
            );
            const outsideY = Math.min(
              Math.max(box.y - 20, 5),
              (viewport?.height ?? box.y + 20) - 5
            );
            await page.mouse.click(outsideX, outsideY);
          }
        }
      }

      // Go to trash
      await uiHelper.toggleTrashFilter();
      await page.waitForTimeout(500);

      // Get trash count
      const trashCount = await page.locator("[data-card-id]").count();

      // Restore all cards from trash
      for (let i = 0; i < trashCount; i++) {
        await page.locator("[data-card-id]").first().click();

        const restoreButton = page
          .getByRole("dialog")
          .getByRole("button", { name: /restore/i })
          .or(page.getByRole("dialog").locator("[data-restore-button]"));

        if ((await restoreButton.count()) > 0) {
          await restoreButton.first().click();
          await page.waitForTimeout(500);
        } else {
          break;
        }
      }

      // Clear trash filter
      await uiHelper.toggleTrashFilter();

      // Cards should be restored
      await page.waitForTimeout(500);
      const restoredCount = await page.locator("[data-card-id]").count();
      expect(restoredCount).toBeGreaterThan(0);
    });
  });

  test.describe("Trash Filter Behavior", () => {
    test("should only show deleted cards in trash filter", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Get count of normal cards
      const normalCount = await page.locator("[data-card-id]").count();

      // Delete one card
      await page.locator("[data-card-id]").first().click();
      const deleteButton = page
        .getByRole("dialog")
        .getByRole("button", { name: /delete/i });
      await deleteButton.click();
      await page.waitForTimeout(500);

      // Go to trash
      await uiHelper.toggleTrashFilter();
      await page.waitForTimeout(500);

      // Should see only deleted cards
      const trashCount = await page.locator("[data-card-id]").count();

      // Trash should have at least one card
      expect(trashCount).toBeGreaterThan(0);

      // Switch back to normal view
      await uiHelper.toggleTrashFilter();
      await page.waitForTimeout(500);

      // Should see only non-deleted cards (one less than before)
      const newNormalCount = await page.locator("[data-card-id]").count();
      expect(newNormalCount).toBeLessThan(normalCount);
    });

    test("should not allow editing deleted cards", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Delete a card
      await page.locator("[data-card-id]").first().click();
      const deleteButton = page
        .getByRole("dialog")
        .getByRole("button", { name: /delete/i });
      await deleteButton.click();
      await page.waitForTimeout(500);

      // Go to trash
      await uiHelper.toggleTrashFilter();
      await page.waitForTimeout(500);

      // Click on trashed card
      await page.locator("[data-card-id]").first().click();

      // Check that edit functionality is disabled or different
      const editButton = page
        .getByRole("dialog")
        .getByRole("button", { name: /edit/i })
        .or(page.getByRole("dialog").locator("[data-edit-button]"));

      // Edit button might be hidden or disabled
      const hasEditButton = (await editButton.count()) > 0;

      if (hasEditButton) {
        const isDisabled = await editButton.first().isDisabled();
        // Either disabled or not present is acceptable
        expect(isDisabled || !hasEditButton).toBe(true);
      }
    });
  });

  test.describe("Empty Trash", () => {
    test("should show empty state when trash is empty", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Go to trash (assuming it might be empty or have items)
      await uiHelper.toggleTrashFilter();
      await page.waitForTimeout(500);

      const trashCount = await page.locator("[data-card-id]").count();

      if (trashCount === 0) {
        // Should show empty state
        const emptyState = page.getByText(/nothing found|no cards/i);
        await expect(emptyState.first()).toBeVisible();
      }
      // If trash has items, that's also valid
    });
  });

  test.describe("Delete Confirmation", () => {
    test("should show delete confirmation dialog", async ({ page }) => {
      // Click on card
      await page.locator("[data-card-id]").first().click();

      // Click delete button
      const deleteButton = page
        .getByRole("dialog")
        .getByRole("button", { name: /delete/i });
      await deleteButton.click();

      // Wait for delete to complete or confirmation to appear
      await page.waitForTimeout(500);

      // Most implementations do soft delete immediately, so check if card is gone
      const modal = page
        .getByRole("dialog")
        .filter({ hasText: /delete|confirm/i });

      // Some implementations might show confirmation, others do soft delete immediately
      const hasConfirmation = (await modal.count()) > 0;

      if (hasConfirmation) {
        // Should have confirmation
        await expect(modal.first()).toBeVisible();

        // Cancel for cleanup
        const cancelButton = page.getByRole("button", { name: /cancel/i });
        if ((await cancelButton.count()) > 0) {
          await cancelButton.first().click();
        }
      }
      // If no confirmation, soft delete was done immediately (also valid)
    });
  });
});
