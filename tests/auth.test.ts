// @ts-nocheck

// Set environment variables BEFORE any imports that might load auth.ts
process.env.SITE_URL = "https://teakvault.com";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.APPLE_CLIENT_ID = "test-apple-client-id";
process.env.APPLE_CLIENT_SECRET = "test-apple-client-secret";

import { describe, expect, test, mock } from "bun:test";

describe("auth.ts", () => {
  test("module exports", async () => {
    mock.module("@convex-dev/resend", () => ({
      Resend: class {
        sendEmail = mock().mockResolvedValue({ id: "test" });
      },
    }));
    mock.module("@convex-dev/better-auth/utils", () => ({
      requireActionCtx: (ctx: any) => ctx,
      isRunMutationCtx: () => true,
      isRunQueryCtx: () => true,
      isActionCtx: () => true,
    }));

    const module = await import("../convex/auth");
    expect(module).toBeTruthy();
  });
});
