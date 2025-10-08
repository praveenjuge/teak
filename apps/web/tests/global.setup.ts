import { clerkSetup } from "@clerk/testing/playwright";
import type { FullConfig } from "@playwright/test";

export default async function globalSetup(_: FullConfig) {
  try {
    await clerkSetup();
  } catch (error) {
    process.env.PLAYWRIGHT_CLERK_SETUP_SKIPPED = "true";
    const message =
      error instanceof Error ? error.message : JSON.stringify(error);
    console.warn(
      "[playwright] clerkSetup skipped — ensure Clerk testing credentials are configured.",
      message,
    );
  }
}
