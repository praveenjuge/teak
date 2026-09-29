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
