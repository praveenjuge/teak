import dotenv from "dotenv";

// Load .env.local for E2E tests
dotenv.config({ path: ".env.local" });

/**
 * Global setup for E2E tests.
 *
 * Email verification is disabled in development, so tests can sign up
 * users directly through the UI without needing pre-creation.
 */
export default function globalSetup(): void {
  // Test credentials are optional - tests will use generated credentials if not configured
  // Email verification is disabled in development mode
  // Tests will sign up users through the UI as needed
}
