import type { Locator, Page } from "@playwright/test";

const DEFAULT_TIMEOUT = 30_000;

/**
 * Better Auth Test Helper for E2E testing
 *
 * Provides helper methods for authentication flows in Playwright tests.
 */
export class AuthHelper {
  constructor(private readonly page: Page) {}

  /**
   * Navigate to the login page
   */
  async goToLoginPage(): Promise<void> {
    await this.page.goto("/login");
    // Wait for the page to be loaded by checking for a key element
    await this.page
      .getByLabel("Email")
      .waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
  }

  /**
   * Navigate to the register page
   */
  async goToRegisterPage(): Promise<void> {
    await this.page.goto("/register");
    await this.page
      .getByLabel("Email")
      .waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
  }

  /**
   * Sign up with email and password (for E2E tests)
   * If user already exists, will attempt to sign in instead
   */
  async signUpWithEmailAndPassword(
    email: string,
    password: string,
    name = "E2E Test User"
  ): Promise<void> {
    await this.goToRegisterPage();

    // Fill in name field if present
    const nameField = this.page.getByLabel("Name");
    if (await nameField.isVisible().catch(() => false)) {
      await nameField.fill(name);
    }

    // Fill in email
    await this.page.getByLabel("Email").fill(email);

    // Fill in password
    await this.page.getByLabel("Password").fill(password);

    // Submit form
    await this.page
      .getByRole("button", { name: /create an account|sign up/i })
      .click();

    // Wait for navigation - either to home (if no email verification) or back to register (with error)
    // In development with email verification disabled, we should go to home
    try {
      await this.page.waitForURL("/", { timeout: DEFAULT_TIMEOUT });

      // Wait for the main page element to be visible
      await this.page
        .getByPlaceholder("Write or add a link...")
        .waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
      return;
    } catch {
      // If not at home, check what happened
      const currentUrl = this.page.url();
      if (currentUrl.includes("/register")) {
        // Check for error message - user might already exist
        const errorLocator = this.page.getByText(
          /already exists|user with this email/i
        );
        const hasError = await errorLocator
          .isVisible({ timeout: 2000 })
          .catch(() => false);

        if (hasError) {
          // User already exists, just sign in instead
          console.log("[TestHelper] User already exists, signing in instead");
          await this.signInWithEmailAndPassword(email, password);
          return;
        }

        // Check for other errors
        const otherError = await this.page
          .getByText(/error/i)
          .textContent()
          .catch(() => null);
        if (otherError) {
          throw new Error(`Sign-up failed: ${otherError}`);
        }
      }
    }

    // Wait for the main page element to be visible
    await this.page
      .getByPlaceholder("Write or add a link...")
      .waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
  }

  /**
   * Sign in with email and password
   * If the user doesn't exist, will attempt to sign up first (in dev mode)
   */
  async signInWithEmailAndPassword(
    email: string,
    password: string
  ): Promise<void> {
    await this.goToLoginPage();

    // Fill in email
    await this.page.getByLabel("Email").fill(email);

    // Fill in password
    await this.page.getByLabel("Password").fill(password);

    // Submit form
    await this.page.getByRole("button", { name: /login|sign in/i }).click();

    // Wait for either navigation to home page OR an error message
    // Use Promise.race to handle both success and failure cases
    try {
      // First, wait a bit to see if there's an error message
      const errorLocator = this.page.getByText(
        /invalid email or password|email not verified/i
      );

      const hasError = await errorLocator
        .isVisible({ timeout: 2000 })
        .catch(() => false);
      if (hasError) {
        const errorText = await errorLocator.textContent();
        throw new Error(`Login failed: ${errorText}`);
      }

      // Wait for navigation to home page
      await this.page.waitForURL("/", { timeout: DEFAULT_TIMEOUT });

      // Wait for the main page element to be visible
      await this.page
        .getByPlaceholder("Write or add a link...")
        .waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
    } catch (error) {
      // Provide more context for debugging
      const currentUrl = this.page.url();
      throw new Error(
        `Sign in failed. Current URL: ${currentUrl}. ` +
          `Expected to be at "/" but still at login. ` +
          `Original error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Sign out from the current session
   */
  async signOut(): Promise<void> {
    // Navigate to settings
    await this.page.goto("/settings");

    // Click sign out button
    await this.page.getByRole("button", { name: "Sign out" }).click();

    // Wait for navigation to login page
    await this.page.waitForURL("/login", { timeout: DEFAULT_TIMEOUT });
  }

  /**
   * Check if user is authenticated by checking current URL
   */
  async isAuthenticated(): Promise<boolean> {
    const url = this.page.url();
    return !(url.includes("/login") || url.includes("/register"));
  }

  /**
   * Get the current user's email from settings page
   */
  async getCurrentUserEmail(): Promise<string> {
    await this.page.goto("/settings");
    const emailButton = this.page.getByRole("button", { name: /@/ });
    await emailButton.waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
    return (await emailButton.textContent()) || "";
  }

  /**
   * Set session cookie directly (for faster tests without going through UI)
   * This is useful when you want to skip the login flow in tests
   */
  async setSessionCookie(sessionToken: string): Promise<void> {
    const cookies = [
      {
        name: "better-auth.session_token",
        value: sessionToken,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      },
    ];
    await this.page.context().addCookies(cookies);
  }
}

/**
 * Helper class for common UI interactions in tests
 */
export class UiHelper {
  constructor(private readonly page: Page) {}

  /**
   * Get the main composer textarea
   */
  getComposer(): Locator {
    return this.page.getByPlaceholder("Write or add a link...");
  }

  /**
   * Get the save button in the composer
   */
  getSaveButton(): Locator {
    return this.page.getByRole("button", { name: "Save", exact: true });
  }

  /**
   * Create a text card
   */
  async createTextCard(content: string): Promise<void> {
    const composer = this.getComposer();
    await composer.fill(content);
    await this.getSaveButton().click();

    // Wait for the card to appear
    await this.page.getByRole("main").getByText(content).waitFor({
      state: "visible",
      timeout: DEFAULT_TIMEOUT,
    });
  }

  /**
   * Create a link card
   */
  async createLinkCard(url: string): Promise<void> {
    const composer = this.getComposer();
    await composer.fill(url);
    await this.getSaveButton().click();

    // Wait a bit for link metadata to be fetched
    await this.page.waitForTimeout(2000);
  }

  /**
   * Get the search input
   */
  getSearchInput(): Locator {
    return this.page.getByPlaceholder("Search for anything...");
  }

  /**
   * Search for a query
   */
  async search(query: string): Promise<void> {
    const searchInput = this.getSearchInput();
    await searchInput.fill(query);
    await searchInput.press("Enter");
    await this.page.waitForTimeout(500); // Wait for search to execute
  }

  /**
   * Clear all filters
   */
  async clearAllFilters(): Promise<void> {
    const clearButton = this.page.getByRole("button", { name: "Clear All" });
    if (await clearButton.isVisible()) {
      await clearButton.click();
    }
  }

  /**
   * Toggle favorites filter
   */
  async toggleFavoritesFilter(): Promise<void> {
    const favoritesButton = this.page
      .getByRole("button", { name: /favorites/i })
      .first();
    await favoritesButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Toggle trash filter
   */
  async toggleTrashFilter(): Promise<void> {
    const trashButton = this.page
      .getByRole("button", { name: /trash/i })
      .first();
    await trashButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Add type filter
   */
  async addTypeFilter(type: string): Promise<void> {
    const filterButton = this.page.getByRole("button", { name: type }).first();
    await filterButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Navigate to settings
   */
  async goToSettings(): Promise<void> {
    const settingsButton = this.page.getByRole("link", { name: /settings/i });
    await settingsButton.click();
    await this.page.waitForURL("/settings");
  }

  /**
   * Navigate to home
   */
  async goToHome(): Promise<void> {
    await this.page.goto("/");
    // Wait for page to be ready by checking for a key element
    await this.page
      .getByPlaceholder("Write or add a link...")
      .waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
  }

  /**
   * Wait for cards to load
   */
  async waitForCards(): Promise<void> {
    await this.page.waitForSelector("[data-card-id]", {
      timeout: DEFAULT_TIMEOUT,
    });
  }

  /**
   * Get all visible card IDs
   */
  async getVisibleCardIds(): Promise<string[]> {
    await this.waitForCards();
    const cards = await this.page.locator("[data-card-id]").all();
    const ids: string[] = [];
    for (const card of cards) {
      const id = await card.getAttribute("data-card-id");
      if (id) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * Click on a card with specific text
   */
  async clickCardWithText(text: string): Promise<void> {
    const card = this.page.getByRole("main").getByText(text);
    await card.click();
  }

  /**
   * Click on the first card
   */
  async clickFirstCard(): Promise<void> {
    const firstCard = this.page.locator("[data-card-id]").first();
    await firstCard.click();
  }

  /**
   * Close modal/dialog by clicking outside
   */
  async closeModal(): Promise<void> {
    const modal = this.page.getByRole("dialog");
    const box = await modal.boundingBox();
    if (!box) {
      throw new Error("Unable to determine dialog bounds");
    }

    const viewport = this.page.viewportSize();
    const rawOutsideX = box.x > 40 ? box.x - 20 : box.x + box.width + 20;
    const rawOutsideY = box.y > 40 ? box.y - 20 : box.y + box.height + 20;
    const outsideX = Math.min(
      Math.max(rawOutsideX, 5),
      (viewport?.width ?? rawOutsideX + 5) - 5
    );
    const outsideY = Math.min(
      Math.max(rawOutsideY, 5),
      (viewport?.height ?? rawOutsideY + 5) - 5
    );
    await this.page.mouse.click(outsideX, outsideY);
  }

  /**
   * Check if empty state is showing
   */
  async isEmptyState(): Promise<boolean> {
    const emptyStateText = this.page.getByText(
      /let's add your first card|nothing found/i
    );
    return await emptyStateText.isVisible().catch(() => false);
  }
}

/**
 * Generate a unique test email
 */
export function generateTestEmail(): string {
  const timestamp = Date.now();
  return `e2e-test-${timestamp}@example.com`;
}

/**
 * Generate a unique test content string
 */
export function generateTestContent(prefix = "Test"): string {
  const timestamp = Date.now();
  return `${prefix} content ${timestamp}`;
}
