#!/usr/bin/env bun
/**
 * Script to create a verified test user for E2E testing.
 * Usage: bun run src/tests/setup-test-user.ts (from apps/web)
 */

import dotenv from "dotenv";

dotenv.config({ path: "../../.env.local" });

const APP_URL =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL || "http://localhost:3000";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const TEST_EMAIL = "e2e-test@teakvault.local";
const TEST_PASSWORD = "TestPassword123!";
const TEST_NAME = "E2E Test User";

async function setupTestUser() {
  console.log(`[setup-test-user] Creating test user: ${TEST_EMAIL}`);
  console.log(`[setup-test-user] App URL: ${APP_URL}`);
  console.log(`[setup-test-user] Convex URL: ${CONVEX_URL}`);

  // Step 1: Sign up the user via Better Auth
  // Use the app URL which proxies to Convex
  let signUpUrl = `${APP_URL}/api/auth/sign-up`;
  if (APP_URL.includes("convex.site")) {
    // For Convex site, use the correct URL structure
    signUpUrl = `${APP_URL}/api/auth/sign-up`;
  }

  console.log(`[setup-test-user] Calling sign-up at: ${signUpUrl}`);

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

  if (signUpResponse.ok) {
    console.log("[setup-test-user] Sign-up successful");
  } else {
    const errorText = await signUpResponse.text();
    if (signUpResponse.status === 400 || signUpResponse.status === 422) {
      if (errorText.includes("already") || errorText.includes("exists")) {
        console.log("[setup-test-user] User already exists, will verify...");
      } else {
        console.log(
          `[setup-test-user] Sign-up validation failed (${signUpResponse.status}): ${errorText}`
        );
        console.log("[setup-test-user] Continuing to verification step...");
      }
    } else {
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
  if (result.found && result.verified) {
    console.log("[setup-test-user] Test user verified successfully!");
    console.log(`[setup-test-user] Email: ${TEST_EMAIL}`);
    console.log(`[setup-test-user] Password: ${TEST_PASSWORD}`);
  } else if (!result.found) {
    console.error("[setup-test-user] User not found after sign-up");
    process.exit(1);
  }

  console.log("[setup-test-user] Done!");
}

setupTestUser().catch((error) => {
  console.error("[setup-test-user] Error:", error);
  process.exit(1);
});
