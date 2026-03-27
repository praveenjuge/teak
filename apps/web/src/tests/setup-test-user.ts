#!/usr/bin/env bun

/**
 * Script to create a verified test user for E2E testing.
 * Usage: bun run src/tests/setup-test-user.ts (from apps/web)
 */

import { resolveTeakDevAppUrl } from "@teak/config/dev-urls";
import dotenv from "dotenv";

dotenv.config({ path: "../../.env.local" });

const APP_URL =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL || resolveTeakDevAppUrl(process.env);
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const TEST_EMAIL = "e2e-test@teakvault.local";
const TEST_PASSWORD = "TestPassword123!";
const TEST_NAME = "E2E Test User";

async function setupTestUser() {
  // Step 1: Sign up the user via Better Auth
  // Use the app URL which proxies to Convex
  let signUpUrl = `${APP_URL}/api/auth/sign-up`;
  if (APP_URL.includes("convex.site")) {
    // For Convex site, use the correct URL structure
    signUpUrl = `${APP_URL}/api/auth/sign-up`;
  }

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

  // Step 2: Mark the user as verified
  const verifyResponse = await fetch(
    `${CONVEX_URL}/api/internal/testSetup:markUserVerified`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: TEST_EMAIL,
      }),
    }
  );

  if (!verifyResponse.ok) {
    const errorText = await verifyResponse.text();
    console.error(
      `[setup-test-user] Verification failed (${verifyResponse.status}): ${errorText}`
    );
    process.exit(1);
  }

  const result = (await verifyResponse.json()) as {
    found: boolean;
    verified: boolean;
  };
  if (!result.found) {
    console.error("[setup-test-user] User not found after sign-up");
    process.exit(1);
  }
}

setupTestUser().catch((error) => {
  console.error("[setup-test-user] Error:", error);
  process.exit(1);
});
