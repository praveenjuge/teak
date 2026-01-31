import dotenv from "dotenv";

// Load .env.local for E2E tests
dotenv.config({ path: ".env.local" });

const TEST_EMAIL = process.env.E2E_BETTER_AUTH_USER_EMAIL;
const TEST_PASSWORD = process.env.E2E_BETTER_AUTH_USER_PASSWORD;

/**
 * Global setup for E2E tests.
 *
 * Email verification is disabled in development, so tests can sign up
 * users directly through the UI without needing pre-creation.
 */
export default async function globalSetup(): Promise<void> {
  if (!(TEST_EMAIL && TEST_PASSWORD)) {
    console.log(
      "[global.setup] No test credentials configured, tests will use generated credentials"
    );
    return;
  }

  console.log(
    "[global.setup] Test credentials configured. Email verification is disabled in development mode."
  );
  console.log(
    "[global.setup] Tests will sign up users through the UI as needed."
  );
}
