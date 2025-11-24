import type { FullConfig } from "@playwright/test";

// No global auth seeding required yet for Better Auth Playwright runs.
export default async function globalSetup(_: FullConfig) {
  return;
}
