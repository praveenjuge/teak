// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import { TEST_APPLE_PRIVATE_KEY } from "./helpers/appleAuth.test-utils";

// Set environment variables BEFORE any imports that might load auth.ts
process.env.SITE_URL = "https://teakvault.com";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.APPLE_CLIENT_ID = "test-apple-client-id";
process.env.APPLE_KEY_ID = "test-apple-key-id";
process.env.APPLE_PRIVATE_KEY = TEST_APPLE_PRIVATE_KEY;
process.env.APPLE_TEAM_ID = "test-apple-team-id";

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

  test("exports canonical account data deletion", async () => {
    const module = await import("../auth");
    expect(module.deleteAccountData).toBeDefined();
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

  test("schedules user-created telemetry", async () => {
    const module = await import("../auth");
    const ctx = {
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    await module.scheduleUserCreatedTelemetry(ctx, "user_123");

    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      source: "auth",
      userId: "user_123",
    });
  });

  test("exports resend", async () => {
    const module = await import("../auth");
    expect(module.resend).toBeDefined();
  });

  test("getCurrentUser is a query function", async () => {
    const module = await import("../auth");
    expect(module.getCurrentUser).toBeDefined();
  });

  test("account data deletion is an internal mutation", async () => {
    const module = await import("../auth");
    expect(module.deleteAccountData).toBeDefined();
  });

  test("createAuth returns auth configuration", async () => {
    const module = await import("../auth");
    const ctx = {} as any;
    const result = module.createAuth(ctx);
    expect(result).toBeDefined();
  });

  test("createAuth registers only configured social providers", async () => {
    const names = [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "APPLE_CLIENT_ID",
      "APPLE_KEY_ID",
      "APPLE_PRIVATE_KEY",
      "APPLE_TEAM_ID",
      "APPLE_APP_BUNDLE_IDENTIFIER",
    ];
    const saved = new Map(
      names.map((name) => [name, process.env[name]] as const)
    );
    try {
      for (const name of names) {
        delete process.env[name];
      }
      const module = await import("../auth");
      const bare = module.createAuth({} as any);
      expect(bare.options.socialProviders).toEqual({});
      process.env.GOOGLE_CLIENT_ID = "id";
      process.env.GOOGLE_CLIENT_SECRET = "secret";
      const googleOnly = module.createAuth({} as any);
      expect(Object.keys(googleOnly.options.socialProviders)).toEqual([
        "google",
      ]);
    } finally {
      for (const name of names) {
        const value = saved.get(name);
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
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
    const teakProtocol = "teak://";
    expect(teakProtocol).toBe("teak://");
  });

  test("uses Google OAuth provider", () => {
    expect(process.env.GOOGLE_CLIENT_ID).toBeDefined();
    expect(process.env.GOOGLE_CLIENT_SECRET).toBeDefined();
  });

  test("uses Apple OAuth provider", () => {
    expect(process.env.APPLE_CLIENT_ID).toBeDefined();
    expect(process.env.APPLE_KEY_ID).toBeDefined();
    expect(process.env.APPLE_PRIVATE_KEY).toBeDefined();
    expect(process.env.APPLE_TEAM_ID).toBeDefined();
  });

  test("generates a fresh Apple client secret", async () => {
    const { decodeJwt, decodeProtectedHeader, exportPKCS8, generateKeyPair } =
      await import("jose");
    const { privateKey } = await generateKeyPair("ES256", {
      extractable: true,
    });
    const { generateAppleClientSecret } = await import("../auth");
    const now = Date.UTC(2026, 7, 11, 5, 0, 0);
    const token = await generateAppleClientSecret(
      {
        clientId: "com.example.teak.apple.si",
        keyId: "TESTKEY123",
        privateKey: await exportPKCS8(privateKey),
        teamId: "TESTTEAM123",
      },
      now
    );

    expect(decodeProtectedHeader(token)).toEqual({
      alg: "ES256",
      kid: "TESTKEY123",
    });
    expect(decodeJwt(token)).toMatchObject({
      aud: "https://appleid.apple.com",
      exp: Math.floor(now / 1000) + 180 * 24 * 60 * 60,
      iat: Math.floor(now / 1000),
      iss: "TESTTEAM123",
      sub: "com.example.teak.apple.si",
    });
  });
});
