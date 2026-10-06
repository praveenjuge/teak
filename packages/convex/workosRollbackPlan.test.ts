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

// Failure modes: missing approvals or barrier; credential resurrection; deletion
// only in WorkOS shadow; unrelated verification; interrupted page replay.
async function barrier(t: ReturnType<typeof setup>) {
  vi.stubEnv("WORKOS_API_KEY", "rollback-test-key");
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("rollback-test-key")
  );
  const apiKeyFingerprint = [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  await t.run((ctx) =>
    ctx.db.insert("workosImportLeases", {
      scope: "management_import",
      environmentId: pins.environmentId,
      clientId: pins.clientId,
      apiKeyFingerprint,
      holder: "11111111-1111-1111-1111-111111111111",
      generation: 1,
      runId: "a".repeat(64),
      admittedAt: 1,
      heartbeatAt: 1,
      status: "quiesced",
    })
  );
  return {
    ...pins,
    apiKeyFingerprint,
    holder: "11111111-1111-1111-1111-111111111111",
    generation: 1,
    passwordPolicy: "invalidate-all-mapped-legacy-passwords" as const,
    policyApprovalReference: "controlled-test-policy",
    activationApprovalReference: "controlled-test-activation",
  };
}
const applyRollback = (
  await import("convex/server")
).makeFunctionReference<"mutation">("migration/workosRollback:applyPage");
test("rollback invalidates passwords and mirrors same-address verification idempotently", async () => {
  const t = setup();
  const id = await seed(t),
    args = await barrier(t);
  expect(await t.mutation(applyRollback, args)).toMatchObject({
    invalidated: 1,
    verified: 1,
    done: true,
  });
  expect(await t.mutation(applyRollback, args)).toMatchObject({
    invalidated: 0,
    verified: 0,
    done: true,
  });
  const state = await t.run(async (ctx) => ({
    account: await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "account",
      where: [{ field: "userId", value: id }],
    }),
    user: await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "_id", value: id }],
    }),
    owner: await ctx.db.query("users").first(),
  }));
  expect(state.account).toMatchObject({ password: null, userId: id });
  expect(state.user).toMatchObject({ emailVerified: true, _id: id });
  expect(state.owner).toMatchObject({
    teakUserId: id,
    emailVerified: true,
    workosUserId: "user_owner",
  });
});
test("provider deletion becomes a both-mode fence without verification grant", async () => {
  const t = setup();
  await seed(t);
  const args = await barrier(t);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("users").first();
    if (!row) {
      throw new Error("Missing fixture");
    }
    await ctx.db.patch("users", row._id, { workosDeletedAt: 42 });
  });
  expect(
    (await t.query(internal.migration.workosRollbackPlan.page, pins)).owners
  ).toMatchObject([
    {
      deniedDeleted: true,
      promoteDeletion: true,
      markSameEmailVerified: false,
    },
  ]);
  expect(await t.mutation(applyRollback, args)).toMatchObject({
    deletionFences: 1,
    verified: 0,
  });
  expect(await t.run((ctx) => ctx.db.query("users").first())).toMatchObject({
    deletedAt: 42,
    emailVerified: false,
  });
});
test.each(["approvals", "generation", "client", "unpaused", "released"])(
  "rollback rejects %s without changing credentials",
  async (failure) => {
    const t = setup();
    await seed(t);
    const args = await barrier(t);
    if (failure === "approvals") {
      args.policyApprovalReference = "";
    }
    if (failure === "generation") {
      args.generation = 2;
    }
    if (failure === "client") {
      args.clientId = "client_wrong";
    }
    if (failure === "unpaused") {
      vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "false");
    }
    if (failure === "released") {
      await t.run(async (ctx) => {
        const row = await ctx.db.query("workosImportLeases").first();
        if (!row) {
          throw new Error("Missing fixture");
        }
        await ctx.db.patch("workosImportLeases", row._id, {
          status: "released",
        });
      });
    }
    await expect(t.mutation(applyRollback, args)).rejects.toThrow();
    expect(
      await t.run((ctx) =>
        ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: "account",
        })
      )
    ).toMatchObject({ password: "unchanged-legacy-test-hash" });
  }
);
test.each(["email", "external", "profile_owner", "pending", "downgrade"])(
  "rollback blocks %s before changing any owner",
  async (failure) => {
    const t = setup();
    const id = await seed(t),
      args = await barrier(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("workosProfiles").first();
      if (!row?.profile) {
        throw new Error("Missing fixture");
      }
      if (failure === "email") {
        await ctx.db.patch("workosProfiles", row._id, {
          profile: { ...row.profile, email: "other@example.com" },
        });
      }
      if (failure === "external") {
        await ctx.db.patch("workosProfiles", row._id, {
          profile: { ...row.profile, externalId: "other" },
        });
      }
      if (failure === "profile_owner") {
        await ctx.db.patch("workosProfiles", row._id, { teakUserId: "other" });
      }
      if (failure === "pending") {
        await ctx.db.insert("migrationQuarantine", {
          workosUserId: "user_owner",
          email: "owner@example.com",
          reason: "profile_pending",
          source: "webhook",
          createdAt: 1,
        });
      }
      if (failure === "downgrade") {
        await ctx.db.patch("workosProfiles", row._id, {
          profile: { ...row.profile, emailVerified: false },
        });
        await ctx.runMutation(components.betterAuth.adapter.updateOne, {
          input: {
            model: "user",
            where: [{ field: "_id", value: id }],
            update: { emailVerified: true },
          },
        });
      }
    });
    await expect(t.mutation(applyRollback, args)).rejects.toThrow("blockers");
    expect(
      await t.run((ctx) =>
        ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: "account",
        })
      )
    ).toMatchObject({ password: "unchanged-legacy-test-hash" });
  }
);

test.each([
  "raw_external_id",
  "receipt_external_id",
  "external_id_mismatch",
  "link_conflict",
  "duplicate_mapping",
])(
  "provider deletion with %s cannot become a permanent tombstone",
  async (failure) => {
    const t = setup();
    await seed(t);
    const args = await barrier(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("users").first();
      const profile = await ctx.db.query("workosProfiles").first();
      if (!(row && profile?.profile)) {
        throw new Error("Missing fixture");
      }
      await ctx.db.patch("users", row._id, { workosDeletedAt: 42 });
      await ctx.db.patch("workosProfiles", profile._id, {
        deletedAt: 42,
        profile: {
          ...profile.profile,
          externalId:
            failure === "raw_external_id"
              ? "other_owner"
              : profile.profile.externalId,
        },
      });
      if (failure === "receipt_external_id") {
        await ctx.db.insert("workosEvents", {
          workosUserId: "user_owner",
          eventId: "evt_delete",
          type: "user.deleted",
          createdAt: 42,
          externalId: "other_owner",
        });
      }
      if (
        failure === "external_id_mismatch" ||
        failure === "link_conflict" ||
        failure === "duplicate_mapping"
      ) {
        await ctx.db.insert("migrationQuarantine", {
          workosUserId: "user_owner",
          email: "owner@example.com",
          reason: failure,
          source: "webhook",
          createdAt: 1,
        });
      }
    });
    await expect(t.mutation(applyRollback, args)).rejects.toThrow("blockers");
    expect(
      await t.run((ctx) => ctx.db.query("users").first())
    ).not.toHaveProperty("deletedAt");
    expect(
      await t.run((ctx) =>
        ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: "account",
        })
      )
    ).toMatchObject({ password: "unchanged-legacy-test-hash" });
  }
);
