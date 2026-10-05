/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const pins = {
  environmentId: "environment_expected",
  clientId: "client_expected",
  apiKeyFingerprint:
    "0cd3cf5f74c92c94559c4397065417ee80f45c5115d28889b9872049ea5533aa",
};
const revoke = makeFunctionReference<
  "mutation",
  typeof pins & {
    holder: string;
    generation: number;
    model: "session" | "oauthAccessToken";
  },
  { deleted: number; done: boolean }
>("migration/workosCutover:revokeLegacyPage");
beforeEach(() => {
  vi.stubEnv("AUTH_PRIMARY", "betterauth");
  vi.stubEnv("SIGNUPS_DISABLED", "true");
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", pins.environmentId);
  vi.stubEnv("WORKOS_CLIENT_ID", pins.clientId);
  vi.stubEnv("WORKOS_API_KEY", "test-workos-reconciliation-key");
});
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  const held = await t.mutation(
    internal.migration.workosImportLease.establishQuiescence,
    {
      ...pins,
      holder: crypto.randomUUID(),
      runId: "f".repeat(64),
    }
  );
  await t.run(async (ctx) => {
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Owner",
          email: "revoke@example.com",
          emailVerified: true,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "account",
        data: {
          accountId: "permanent",
          providerId: "credential",
          userId: "permanent",
          password: "retained-test-hash",
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });
    for (let index = 0; index < 25; index++) {
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "session",
          data: {
            userId: "permanent",
            token: crypto.randomUUID(),
            expiresAt: Date.now() + 60_000,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      });
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "oauthAccessToken",
          data: {
            userId: "permanent",
            accessToken: crypto.randomUUID(),
            refreshToken: crypto.randomUUID(),
          },
        },
      });
    }
  });
  return { t, held };
}
// Failure modes: premature activation, wrong barrier holder/generation or key,
// reopened signup/account writes, pagination skips, retry after response loss,
// deleting permanent owners/passwords/API-key data instead of session tokens.
test("revocation remains inert until the approved flip and exact held barrier", async () => {
  const { t, held } = await setup();
  const args = { ...pins, ...held, model: "session" as const };
  await expect(t.mutation(revoke, args)).rejects.toThrow("WorkOS primary");
  vi.stubEnv("AUTH_PRIMARY", "workos");
  await expect(
    t.mutation(revoke, { ...args, generation: held.generation + 1 })
  ).rejects.toThrow("not held");
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "false");
  await expect(t.mutation(revoke, args)).rejects.toThrow("paused");
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
  vi.stubEnv("SIGNUPS_DISABLED", "false");
  await expect(t.mutation(revoke, args)).rejects.toThrow("frozen signups");
  vi.stubEnv("SIGNUPS_DISABLED", "true");
  vi.stubEnv("WORKOS_API_KEY", crypto.randomUUID());
  await expect(t.mutation(revoke, args)).rejects.toThrow("credential binding");
  expect(
    (
      await t.run((ctx) =>
        ctx.runQuery(components.betterAuth.adapter.findMany, {
          model: "session",
          paginationOpts: { cursor: null, numItems: 100 },
        })
      )
    ).page
  ).toHaveLength(25);
});
test("bounded retries revoke every legacy session and OAuth refresh/access pair while retaining account data", async () => {
  const { t, held } = await setup();
  vi.stubEnv("AUTH_PRIMARY", "workos");
  for (const model of ["session", "oauthAccessToken"] as const) {
    expect(await t.mutation(revoke, { ...pins, ...held, model })).toEqual({
      deleted: 20,
      done: false,
    });
    // The first response can be lost. Retrying drains remaining rows rather than
    // jumping past a cursor or requiring the original response.
    expect(await t.mutation(revoke, { ...pins, ...held, model })).toEqual({
      deleted: 5,
      done: false,
    });
    expect(await t.mutation(revoke, { ...pins, ...held, model })).toEqual({
      deleted: 0,
      done: true,
    });
    expect(await t.mutation(revoke, { ...pins, ...held, model })).toEqual({
      deleted: 0,
      done: true,
    });
  }
  const account = await t.run((ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "account",
      where: [{ field: "userId", value: "permanent" }],
    })
  );
  expect(account).toMatchObject({
    password: "retained-test-hash",
    userId: "permanent",
  });
  expect(
    await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: "revoke@example.com" }],
      })
    )
  ).toMatchObject({ emailVerified: true });
});
