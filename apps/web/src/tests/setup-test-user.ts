#!/usr/bin/env bun

/**
 * Script to create a test user for E2E testing.
 * Usage: bun run src/tests/setup-test-user.ts (from apps/web)
 */

import { resolveTeakDevAppUrl } from "@teak/convex/dev-urls";
import dotenv from "dotenv";

// Explicit test scope, then build inputs. Never the legacy root dotenv.
dotenv.config({ path: ".env.e2e.local" });
dotenv.config({ path: ".env.local" });

const APP_URL =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL || resolveTeakDevAppUrl(process.env);
const TEST_EMAIL = "e2e-test@teakvault.local";
const TEST_PASSWORD = "TestPassword123!";
const TEST_NAME = "E2E Test User";

async function setupTestUser() {
  // Step 1: Sign up the user via Better Auth
  // Use the app URL which proxies to Convex
  const signUpUrl = `${APP_URL}/api/auth/sign-up/email`;

  const signUpResponse = await fetch(signUpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      name: TEST_NAME,
    }),
  });

  if (!signUpResponse.ok) {
    const errorText = await signUpResponse.text();
    if (!(signUpResponse.status === 400 || signUpResponse.status === 422)) {
      console.error(
        `[setup-test-user] Sign-up failed (${signUpResponse.status}): ${errorText}`
      );
      process.exit(1);
    }
  }

  // Local sign-in does not require verified email, so sign-up alone
  // provisions a working test user.
  console.log(`[setup-test-user] Test user ready: ${TEST_EMAIL}`);
}

setupTestUser().catch((error) => {
  console.error("[setup-test-user] Error:", error);
  process.exit(1);
});
