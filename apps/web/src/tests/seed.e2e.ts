import { expect, test } from "@playwright/test";
import { AuthHelper } from "./test-helpers";

// Signed-in smoke check: the configured E2E account reaches the home page
// composer. Also the seed for `playwright init-agents` if agents are added.
const TEST_EMAIL = process.env.E2E_BETTER_AUTH_USER_EMAIL;
const TEST_PASSWORD = process.env.E2E_BETTER_AUTH_USER_PASSWORD;

test.describe("Seed", () => {
  test.skip(
    !(TEST_EMAIL && TEST_PASSWORD),
    "Set E2E_BETTER_AUTH_USER_EMAIL and E2E_BETTER_AUTH_USER_PASSWORD to run the seed."
  );

  test("seed", async ({ page }) => {
    const auth = new AuthHelper(page);
    const email = TEST_EMAIL as string;
    const password = TEST_PASSWORD as string;
    // Sign in first: the account usually exists, and signing up an existing
    // account waits out the registration redirect before falling back. Auth
    // answers "invalid email or password" for both a missing account and a
    // wrong password, so fall back to sign-up, but report both failures.
    try {
      await auth.signInWithEmailAndPassword(email, password);
    } catch (signInError) {
      try {
        await auth.signUpWithEmailAndPassword(email, password);
      } catch (signUpError) {
        throw new Error(
          `Could not sign in (${String(signInError)}) or sign up (${String(signUpError)}). Check E2E_BETTER_AUTH_USER_PASSWORD.`
        );
      }
    }

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("textbox", { name: "Markdown content" })
    ).toBeVisible();
  });
});
