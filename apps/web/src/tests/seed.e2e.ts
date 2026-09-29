import { expect, test } from "@playwright/test";
import { AuthHelper } from "./test-helpers";

// Seed for the Playwright test agents (.claude/agents/playwright-test-*.md):
// planner and generator start every plan from a signed-in home page.
const TEST_EMAIL = process.env.E2E_BETTER_AUTH_USER_EMAIL;
const TEST_PASSWORD = process.env.E2E_BETTER_AUTH_USER_PASSWORD;

test.describe("Seed", () => {
  test.skip(
    !(TEST_EMAIL && TEST_PASSWORD),
    "Set E2E_BETTER_AUTH_USER_EMAIL and E2E_BETTER_AUTH_USER_PASSWORD to run the seed."
  );

  test("seed", async ({ page }) => {
    const auth = new AuthHelper(page);
    // Sign in first: the account usually exists, and signing up an existing
    // account waits out the registration redirect before falling back.
    await auth
      .signInWithEmailAndPassword(TEST_EMAIL as string, TEST_PASSWORD as string)
      .catch(() =>
        auth.signUpWithEmailAndPassword(
          TEST_EMAIL as string,
          TEST_PASSWORD as string
        )
      );

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("textbox", { name: "Markdown content" })
    ).toBeVisible();
  });
});
