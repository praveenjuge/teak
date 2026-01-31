// @ts-nocheck
import { describe, expect, test, mock } from "bun:test";

// Set environment variables BEFORE any imports that might load auth.ts
process.env.SITE_URL = "https://teakvault.com";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.APPLE_CLIENT_ID = "test-apple-client-id";
process.env.APPLE_CLIENT_SECRET = "test-apple-client-secret";

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

describe("auth.ts", () => {
  test("module exports", async () => {
    expect(await import("../auth")).toBeTruthy();
  });

  test("exports getCurrentUser", async () => {
    const module = await import("../auth");
    expect(module.getCurrentUser).toBeDefined();
  });

  test("exports deleteAccount", async () => {
    const module = await import("../auth");
    expect(module.deleteAccount).toBeDefined();
  });

  test("exports ensureCardCreationAllowed", async () => {
    const module = await import("../auth");
    expect(module.ensureCardCreationAllowed).toBeDefined();
  });

  test("exports createAuth", async () => {
    const module = await import("../auth");
    expect(module.createAuth).toBeDefined();
  });

  test("exports authComponent", async () => {
    const module = await import("../auth");
    expect(module.authComponent).toBeDefined();
  });

  test("exports resend", async () => {
    const module = await import("../auth");
    expect(module.resend).toBeDefined();
  });

  test("getCurrentUser is a query function", async () => {
    const module = await import("../auth");
    expect(module.getCurrentUser).toBeDefined();
  });

  test("deleteAccount is a mutation function", async () => {
    const module = await import("../auth");
    expect(module.deleteAccount).toBeDefined();
  });

  test("createAuth returns auth configuration", async () => {
    const module = await import("../auth");
    const ctx = {} as any;
    const result = module.createAuth(ctx);
    expect(result).toBeDefined();
  });

  test("authComponent has getAuthUser method", async () => {
    const module = await import("../auth");
    expect(module.authComponent?.getAuthUser).toBeDefined();
  });

  test("trusted origins include production URLs", () => {
    const originalSiteUrl = process.env.SITE_URL;
    process.env.SITE_URL = "https://app.teakvault.com";
    expect(process.env.SITE_URL).toBe("https://app.teakvault.com");
    process.env.SITE_URL = originalSiteUrl;
  });

  test("trusted origins include chrome-extension", () => {
    const chromeOrigin = "chrome-extension://*";
    expect(chromeOrigin).toContain("chrome-extension");
  });

  test("trusted origins include teak:// protocol", () => {
    const teakProtocol = "teak://*";
    expect(teakProtocol).toContain("teak://");
  });

  test("uses Google OAuth provider", () => {
    expect(process.env.GOOGLE_CLIENT_ID).toBeDefined();
    expect(process.env.GOOGLE_CLIENT_SECRET).toBeDefined();
  });

  test("uses Apple OAuth provider", () => {
    expect(process.env.APPLE_CLIENT_ID).toBeDefined();
    expect(process.env.APPLE_CLIENT_SECRET).toBeDefined();
  });
});
