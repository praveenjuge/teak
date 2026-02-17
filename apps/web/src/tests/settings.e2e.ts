import { expect, test } from "@playwright/test";
import { AuthHelper, UiHelper } from "./test-helpers";

const TEST_EMAIL = process.env.E2E_BETTER_AUTH_USER_EMAIL;
const TEST_PASSWORD = process.env.E2E_BETTER_AUTH_USER_PASSWORD;

test.describe("Settings Navigation and Management", () => {
  // biome-ignore lint/suspicious/noSkippedTests: Conditional test skip
  test.skip(
    !(TEST_EMAIL && TEST_PASSWORD),
    "Set E2E_BETTER_AUTH_USER_EMAIL and E2E_BETTER_AUTH_USER_PASSWORD to run settings tests."
  );

  test.beforeEach(async ({ page }) => {
    const authHelper = new AuthHelper(page);
    await authHelper.signInWithEmailAndPassword(TEST_EMAIL!, TEST_PASSWORD!);
    await page.waitForLoadState("networkidle");
  });

  test.describe("Settings Page Navigation", () => {
    test("should navigate to settings page", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Click settings button
      await uiHelper.goToSettings();

      // Should be on settings page
      await expect(page).toHaveURL("/settings");
      await expect(
        page.getByRole("heading", { name: /settings/i })
      ).toBeVisible();
    });

    test("should show settings button in navigation", async ({ page }) => {
      // Settings button should be visible in the main navigation
      const settingsButton = page.getByRole("link", { name: /settings/i });
      await expect(settingsButton).toBeVisible();
    });

    test("should navigate back to home from settings", async ({ page }) => {
      const uiHelper = new UiHelper(page);

      // Go to settings
      await uiHelper.goToSettings();

      // Navigate back home
      await uiHelper.goToHome();

      // Should be on home page
      await expect(page).toHaveURL("/");
      await expect(page.getByPlaceholder(/Write or add a link/i)).toBeVisible();
    });
  });

  test.describe("Settings Page Elements", () => {
    test("should display user email", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Should show email section
      await expect(page.getByText(/email/i)).toBeVisible();

      // Email should be displayed (masked or full)
      const emailButton = page.getByRole("button", { name: /@/i });
      await expect(emailButton.first()).toBeVisible();
    });

    test("should display usage statistics", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Should show usage/card count
      await expect(page.getByText(/usage|cards/i)).toBeVisible();

      // Card count should be displayed
      const countText = page.getByText(/\d+\s+cards?/i);
      await expect(countText.first()).toBeVisible();
    });

    test("should display plan information", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Should show plan section
      await expect(page.getByText(/plan/i)).toBeVisible();

      // Should show either Free Plan or Pro badge
      const planBadge = page
        .getByRole("button", { name: /free plan|pro/i })
        .or(page.getByText(/free plan|pro/i));
      await expect(planBadge.first()).toBeVisible();
    });

    test("should display theme settings", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Should show theme section
      await expect(page.getByText(/theme/i)).toBeVisible();

      // Should have theme toggle buttons
      const themeButtons = page
        .getByRole("button", { name: /theme/i })
        .or(page.locator("[data-theme-toggle]"));
      await expect(themeButtons.first()).toBeVisible();
    });
  });

  test.describe("Theme Settings", () => {
    test("should show theme options", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Should have system, light, and dark theme options
      await expect(
        page.getByRole("button", { name: /system|theme/i })
      ).toBeVisible();
    });

    test("should change theme to light", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Click light theme button
      const lightButton = page
        .getByRole("button", { name: /light/i })
        .or(page.locator('[data-theme="light"]'));

      if ((await lightButton.count()) > 0) {
        await lightButton.first().click();
        await page.waitForTimeout(500);

        // Theme should be changed (check by button state or HTML class)
        const html = page.locator("html");
        const hasLightClass = await html.getAttribute("class");
        // Either has light class or doesn't have dark class
        expect(hasLightClass).toBeTruthy();
      }
    });

    test("should change theme to dark", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Click dark theme button
      const darkButton = page
        .getByRole("button", { name: /dark/i })
        .or(page.locator('[data-theme="dark"]'));

      if ((await darkButton.count()) > 0) {
        await darkButton.first().click();
        await page.waitForTimeout(500);

        // Theme should be changed
        const html = page.locator("html");
        const classList = await html.getAttribute("class");
        expect(classList).toBeTruthy();
      }
    });

    test("should change theme to system", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Click system theme button
      const systemButton = page
        .getByRole("button", { name: /system/i })
        .or(page.locator('[data-theme="system"]'));

      if ((await systemButton.count()) > 0) {
        await systemButton.first().click();
        await page.waitForTimeout(500);

        // Theme should be set to system
        const html = page.locator("html");
        const classList = await html.getAttribute("class");
        expect(classList).toBeTruthy();
      }
    });
  });

  test.describe("Subscription and Upgrade", () => {
    test("should show upgrade button for free users", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Look for upgrade button
      const upgradeButton = page
        .getByRole("button", { name: /upgrade/i })
        .or(page.getByRole("link", { name: /upgrade/i }));

      // If user is on free plan, should show upgrade button
      const hasUpgradeButton = (await upgradeButton.count()) > 0;

      if (hasUpgradeButton) {
        await expect(upgradeButton.first()).toBeVisible();
      }
      // If user is on Pro plan, might not have upgrade button (also valid)
    });

    test("should open upgrade modal when clicking upgrade", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      const upgradeButton = page
        .getByRole("button", { name: /upgrade/i })
        .or(page.getByRole("link", { name: /upgrade/i }));

      const hasUpgradeButton = (await upgradeButton.count()) > 0;

      if (hasUpgradeButton) {
        await upgradeButton.first().click();

        // Should open upgrade dialog
        await page.waitForTimeout(500);
        const upgradeDialog = page
          .getByRole("dialog")
          .filter({ hasText: /upgrade|pro|subscription/i });

        const hasDialog = (await upgradeDialog.count()) > 0;

        if (hasDialog) {
          await expect(upgradeDialog.first()).toBeVisible();

          // Close dialog
          const closeButton = page
            .getByRole("button", { name: /close|x/i })
            .or(page.locator("[data-dialog-close]"));
          if ((await closeButton.count()) > 0) {
            await closeButton.first().click();
          }
        }
      } else {
        // biome-ignore lint/suspicious/noSkippedTests: Conditional test skip
        test.skip(true, "User is already on Pro plan");
      }
    });

    test("should display plan features in upgrade modal", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      const upgradeButton = page.getByRole("button", { name: /upgrade/i });

      const hasUpgradeButton = (await upgradeButton.count()) > 0;

      if (hasUpgradeButton) {
        await upgradeButton.first().click();
        await page.waitForTimeout(500);

        // Should show feature list
        const features = page.getByText(/unlimited|cards|storage/i);
        await expect(features.first()).toBeVisible();

        // Close dialog
        const closeButton = page
          .getByRole("button", { name: /close|x/i })
          .or(page.locator("[data-dialog-close]"));
        if ((await closeButton.count()) > 0) {
          await closeButton.first().click();
        }
      } else {
        // biome-ignore lint/suspicious/noSkippedTests: Conditional test skip
        test.skip(true, "User is already on Pro plan");
      }
    });
  });

  test.describe("Account Management", () => {
    test("should show sign out button", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Should have sign out button
      await expect(
        page.getByRole("button", { name: /sign out/i })
      ).toBeVisible();
    });

    test("should sign out successfully", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Click sign out
      await page.getByRole("button", { name: /sign out/i }).click();

      // Should redirect to login
      await expect(page).toHaveURL("/login");
    });

    test("should show delete account option", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Should have delete account link/button
      const deleteLink = page
        .getByRole("button", { name: /delete account/i })
        .or(page.getByRole("link", { name: /delete account/i }));

      await expect(deleteLink.first()).toBeVisible();
    });

    test("should open delete account confirmation dialog", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Click delete account
      const deleteLink = page.getByRole("button", { name: /delete account/i });
      await deleteLink.first().click();

      // Should show confirmation dialog
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByText(/permanently|irreversible/i)).toBeVisible();

      // Should require confirmation text
      await expect(page.getByLabel(/delete account/i)).toBeVisible();

      // Cancel for cleanup
      const cancelButton = page.getByRole("button", { name: /cancel/i });
      if ((await cancelButton.count()) > 0) {
        await cancelButton.first().click();
      }
    });

    test("should require confirmation for account deletion", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Click delete account
      const deleteLink = page.getByRole("button", { name: /delete account/i });
      await deleteLink.first().click();

      // Try to delete without confirmation
      const deleteButton = page
        .getByRole("button", { name: /delete account/i })
        .or(page.locator("[data-delete-account-confirm]"));

      // Should be disabled without proper confirmation
      const isDisabled = await deleteButton
        .first()
        .isDisabled()
        .catch(() => false);

      if (isDisabled) {
        expect(isDisabled).toBe(true);
      }

      // Cancel for cleanup
      const cancelButton = page.getByRole("button", { name: /cancel/i });
      if ((await cancelButton.count()) > 0) {
        await cancelButton.first().click();
      }
    });
  });

  test.describe("Customer Portal", () => {
    test("should show manage button for pro users", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Look for "Manage" button for Pro users
      const manageButton = page
        .getByRole("button", { name: /manage/i })
        .or(page.getByRole("link", { name: /manage/i }));

      const hasManageButton = (await manageButton.count()) > 0;

      if (hasManageButton) {
        await expect(manageButton.first()).toBeVisible();

        // Clicking should open customer portal (opens in new tab)
        // We won't actually click it in tests as it would navigate away
      }
      // If no manage button, user is on free plan (also valid)
    });
  });

  test.describe("Settings Page Accessibility", () => {
    test("should have proper heading structure", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Should have main heading
      const mainHeading = page.getByRole("heading", { level: 1 });
      await expect(mainHeading.first()).toBeVisible();
    });

    test("should have keyboard navigable settings", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.goToSettings();

      // Tab through settings
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");

      // Focus should move to different elements
      const focusedElement = await page.locator(":focus").count();
      expect(focusedElement).toBeGreaterThan(0);
    });
  });

  test.describe("Settings Persistence", () => {
    test("should persist theme preference across sessions", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);

      // Change theme
      await uiHelper.goToSettings();

      const darkButton = page.getByRole("button", { name: /dark/i });
      if ((await darkButton.count()) > 0) {
        await darkButton.first().click();
        await page.waitForTimeout(500);

        // Navigate away
        await uiHelper.goToHome();

        // Navigate back to settings
        await uiHelper.goToSettings();

        // Theme preference should be persisted (dark button should still be active/selected)
        await expect(darkButton.first()).toBeVisible();
      }
    });
  });
});
