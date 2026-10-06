/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const pins = {
  environmentId: "environment_expected",
  clientId: "client_expected",
  cursor: null,
};
const setup = () => {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  return t;
};
beforeEach(() => {
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", pins.environmentId);
  vi.stubEnv("WORKOS_CLIENT_ID", pins.clientId);
  vi.stubEnv("AUTH_PRIMARY", "workos");
  vi.stubEnv("SIGNUPS_DISABLED", "true");
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
});
afterEach(() => vi.unstubAllEnvs());
async function seed(t: ReturnType<typeof setup>) {
  const user = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          email: "owner@example.com",
          name: "Owner",
          emailVerified: false,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    })
  );
  if (!("_id" in user)) {
    throw new Error("Missing id");
  }
  const id = String(user._id);
  await t.run(async (ctx) => {
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "account",
        data: {
          providerId: "credential",
          accountId: id,
          userId: id,
          password: "unchanged-legacy-test-hash",
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });
    await ctx.db.insert("users", {
      teakUserId: id,
      email: "owner@example.com",
      emailVerified: false,
      workosUserId: "user_owner",
    });
    await ctx.db.insert("workosProfiles", {
      workosUserId: "user_owner",
      teakUserId: id,
      revision: 1,
      source: "event",
      providerUpdatedAt: "2026-10-01T00:00:00Z",
      profile: {
        email: "owner@example.com",
        emailVerified: true,
        externalId: id,
        firstName: null,
        lastName: null,
        profilePictureUrl: null,
      },
    });
  });
  return id;
}
// Failure modes: read-only plan accidentally invalidates password; wrong pins or
// unpaused changes; stale/pending canonical evidence grants verification.
test("plans conservative reset and same-address verification without changing credentials", async () => {
  const t = setup(),
    id = await seed(t);
  expect(
    (await t.query(internal.migration.workosRollbackPlan.page, pins)).owners
  ).toMatchObject([
    {
      teakUserId: id,
      invalidateLegacyPassword: true,
      markSameEmailVerified: true,
      deniedDeleted: false,
    },
  ]);
  const accounts = await t.run((ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "account",
      paginationOpts: { cursor: null, numItems: 2 },
    })
  );
  expect(accounts.page).toMatchObject([
    { password: "unchanged-legacy-test-hash" },
  ]);
  expect(
    await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "_id", value: id }],
      })
    )
  ).toMatchObject({ emailVerified: false });
});
test("pending verification and deleted owners never plan a verification grant", async () => {
  const t = setup();
  await seed(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("migrationQuarantine", {
      workosUserId: "user_owner",
      email: "owner@example.com",
      reason: "profile_pending",
      source: "webhook",
      createdAt: 1,
    });
    const owner = await ctx.db.query("users").first();
    if (!owner) {
      throw new Error("Missing owner");
    }
    await ctx.db.patch("users", owner._id, { deletedAt: 2 });
  });
  expect(
    (await t.query(internal.migration.workosRollbackPlan.page, pins)).owners
  ).toMatchObject([{ markSameEmailVerified: false, deniedDeleted: true }]);
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "false");
  await expect(
    t.query(internal.migration.workosRollbackPlan.page, pins)
  ).rejects.toThrow("pinned paused");
});

test("active pending profiles and verification downgrades remain explicit rollback blockers", async () => {
  const t = setup();
  const id = await seed(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("migrationQuarantine", {
      workosUserId: "user_owner",
      email: "owner@example.com",
      reason: "profile_pending",
      source: "webhook",
      createdAt: 1,
    });
  });
  expect(
    (await t.query(internal.migration.workosRollbackPlan.page, pins)).owners
  ).toMatchObject([
    { canonicalProfileUnavailable: true, markSameEmailVerified: false },
  ]);
  await t.run(async (ctx) => {
    const conflict = await ctx.db.query("migrationQuarantine").first();
    const profile = await ctx.db.query("workosProfiles").first();
    if (!(conflict && profile?.profile)) {
      throw new Error("Missing fixture");
    }
    await ctx.db.patch("migrationQuarantine", conflict._id, { resolvedAt: 2 });
    await ctx.db.patch("workosProfiles", profile._id, {
      profile: { ...profile.profile, emailVerified: false },
    });
    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: "user",
        where: [{ field: "_id", value: id }],
        update: { emailVerified: true },
      },
    });
  });
  expect(
    (await t.query(internal.migration.workosRollbackPlan.page, pins)).owners
  ).toMatchObject([
    {
      canonicalProfileUnavailable: false,
      verificationDowngradeRequired: true,
      markSameEmailVerified: false,
    },
  ]);
});
