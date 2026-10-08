/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const setup = () => {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  return t;
};
type TestBackend = ReturnType<typeof setup>;

beforeEach(() => {
  vi.stubEnv("SIGNUPS_DISABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// Retained Better Auth rows, seeded the way pre-WorkOS sign-ups left them.
const retainedUser = (t: TestBackend, email: string) =>
  t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Backup proof",
          email,
          emailVerified: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    })
  );

test("public auth mode reports WorkOS and the pause flags without exposing credentials", async () => {
  vi.stubEnv("WORKOS_CLIENT_ID", "client_TEST");
  vi.stubEnv("WORKOS_API_KEY", "must-not-reach-clients");
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
  const t = setup();
  expect(await t.query(api.auth.getAuthMode, {})).toEqual({
    primary: "workos",
    signupsDisabled: true,
    accountChangesPaused: true,
    authKitClientId: "client_TEST",
  });
  vi.stubEnv("SIGNUPS_DISABLED", "false");
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", undefined);
  expect(await t.query(api.auth.getAuthMode, {})).toEqual({
    primary: "workos",
    signupsDisabled: false,
    accountChangesPaused: false,
    authKitClientId: "client_TEST",
  });
});

test.each(["SIGNUPS_DISABLED", "ACCOUNT_CHANGES_PAUSED"])(
  "public auth mode fails closed on malformed %s",
  async (name) => {
    vi.stubEnv(name, "invalid");
    await expect(setup().query(api.auth.getAuthMode, {})).rejects.toThrow(name);
  }
);

test("the backup exports retained Better Auth rows unchanged", async () => {
  const t = setup();
  const retainedCredential = "retained-credential-fixture";
  const user = await retainedUser(t, "backup-proof@example.com");
  await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "account",
        data: {
          accountId: user._id,
          providerId: "credential",
          userId: user._id,
          password: retainedCredential,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    })
  );
  const retainedSecret = "retained-totp-secret-fixture";
  await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "twoFactor",
        data: {
          userId: user._id,
          secret: retainedSecret,
          backupCodes: "retained-backup-codes-fixture",
        },
      },
    })
  );
  for (const model of [
    "user",
    "account",
    "session",
    "verification",
    "twoFactor",
    "oauthApplication",
    "oauthAccessToken",
    "oauthConsent",
    "jwks",
  ] as const) {
    const exported = await t.action(internal.migration.exportBetterAuth.page, {
      model,
      cursor: null,
    });
    const original = await t.query(components.betterAuth.adapter.findMany, {
      model,
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(exported.page).toEqual(original.page);
    expect(exported.isDone).toBe(true);
  }
  const accounts = await t.action(internal.migration.exportBetterAuth.page, {
    model: "account",
    cursor: null,
  });
  expect(accounts.page).toEqual([
    expect.objectContaining({ userId: user._id, password: retainedCredential }),
  ]);
  const secrets = await t.action(internal.migration.exportBetterAuth.page, {
    model: "twoFactor",
    cursor: null,
  });
  expect(secrets.page).toEqual([
    expect.objectContaining({ userId: user._id, secret: retainedSecret }),
  ]);
});

test("the backup resumes across user pages without omissions or duplicates", async () => {
  const t = setup();
  const ids: string[] = [];
  for (let index = 0; index < 101; index += 1) {
    ids.push((await retainedUser(t, `backup-${index}@example.com`))._id);
  }
  const first = await t.action(internal.migration.exportBetterAuth.page, {
    model: "user",
    cursor: null,
  });
  expect(first.page).toHaveLength(100);
  expect(first.isDone).toBe(false);
  const second = await t.action(internal.migration.exportBetterAuth.page, {
    model: "user",
    cursor: first.continueCursor,
  });
  expect(second.page).toHaveLength(1);
  expect(second.isDone).toBe(true);
  expect(
    [...first.page, ...second.page].map((user) => user._id).sort()
  ).toEqual(ids.sort());
});
