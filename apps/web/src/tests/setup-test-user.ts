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
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const TEST_EMAIL = "e2e-test@teakvault.local";
const TEST_PASSWORD = "TestPassword123!";
const TEST_FIRST_NAME = "E2E";
const TEST_LAST_NAME = "Test User";
const CLERK_API_BASE_URL = "https://api.clerk.com/v1";

function getClerkHeaders() {
  if (!CLERK_SECRET_KEY) {
    throw new Error("Missing CLERK_SECRET_KEY");
  }

  return {
    Authorization: `Bearer ${CLERK_SECRET_KEY}`,
    "Content-Type": "application/json",
  };
}

async function fetchExistingUserId(): Promise<string | null> {
  const url = new URL(`${CLERK_API_BASE_URL}/users`);
  url.searchParams.append("email_address[]", TEST_EMAIL);

  const response = await fetch(url, {
    method: "GET",
    headers: getClerkHeaders(),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to list Clerk users (${response.status}): ${await response.text()}`
    );
  }

  const result = (await response.json()) as {
    data?: Array<{ id?: string }>;
  };

  return result.data?.[0]?.id ?? null;
}

async function deleteExistingUser(userId: string): Promise<void> {
  const response = await fetch(`${CLERK_API_BASE_URL}/users/${userId}`, {
    method: "DELETE",
    headers: getClerkHeaders(),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to delete Clerk user (${response.status}): ${await response.text()}`
    );
  }
}

async function createTestUser(): Promise<void> {
  const response = await fetch(`${CLERK_API_BASE_URL}/users`, {
    method: "POST",
    headers: getClerkHeaders(),
    body: JSON.stringify({
      email_address: [TEST_EMAIL],
      password: TEST_PASSWORD,
      first_name: TEST_FIRST_NAME,
      last_name: TEST_LAST_NAME,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to create Clerk user (${response.status}): ${await response.text()}`
    );
  }
}

async function setupTestUser() {
  console.log(`[setup-test-user] Creating test user: ${TEST_EMAIL}`);
  console.log(`[setup-test-user] App URL: ${APP_URL}`);
  console.log("[setup-test-user] Provisioning via Clerk Backend API");

  const existingUserId = await fetchExistingUserId();
  if (existingUserId) {
    console.log(
      `[setup-test-user] Removing existing Clerk user: ${existingUserId}`
    );
    await deleteExistingUser(existingUserId);
  }

  await createTestUser();

  console.log("[setup-test-user] Clerk user created successfully");
  console.log(`[setup-test-user] Email: ${TEST_EMAIL}`);
  console.log(`[setup-test-user] Password: ${TEST_PASSWORD}`);

  console.log("[setup-test-user] Done!");
}

setupTestUser().catch((error) => {
  console.error("[setup-test-user] Error:", error);
  process.exit(1);
});
