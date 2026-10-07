/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import type { Infer } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { components, internal } from "./_generated/api";
import type { rollbackSummary } from "./migration/workosRollbackPlan";
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
async function seed(t: ReturnType<typeof setup>, label = "owner") {
  const user = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          email: `${label}@example.com`,
          name: label,
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
      email: `${label}@example.com`,
      emailVerified: false,
      workosUserId: `user_${label}`,
    });
    await ctx.db.insert("workosProfiles", {
      workosUserId: `user_${label}`,
      teakUserId: id,
      revision: 1,
      source: "event",
      providerUpdatedAt: "2026-10-01T00:00:00Z",
      profile: {
        email: `${label}@example.com`,
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
// What an activation-reviewed dry run hands the writer, read from the real plan.
async function review(t: ReturnType<typeof setup>) {
  type Owner = Infer<typeof rollbackSummary>;
  const { owners }: { owners: Owner[] } = await t.query(
    internal.migration.workosRollbackPlan.page,
    pins
  );
  const ids = (selected: (owner: Owner) => boolean) =>
    owners.filter(selected).map((owner) => owner.teakUserId);
  return {
    invalidate: ids((owner) => owner.invalidateLegacyPassword),
    verify: ids((owner) => owner.markSameEmailVerified),
    fences: ids((owner) => owner.promoteDeletion),
    denied: ids((owner) => owner.deniedDeleted),
    mappings: owners.flatMap(({ teakUserId, workosUserId }) =>
      workosUserId ? [{ teakUserId, workosUserId }] : []
    ),
  };
}
test("rollback invalidates passwords and mirrors same-address verification idempotently", async () => {
  const t = setup();
  const id = await seed(t),
    args = { ...(await barrier(t)), reviewed: await review(t) };
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
  const reviewed = { ...args, reviewed: await review(t) };
  expect(await t.mutation(applyRollback, reviewed)).toMatchObject({
    deletionFences: 1,
    verified: 0,
  });
  expect(await t.run((ctx) => ctx.db.query("users").first())).toMatchObject({
    deletedAt: 42,
    emailVerified: false,
  });
  // A resume sees the reviewed fence as denied and stays in scope.
  expect(await t.mutation(applyRollback, reviewed)).toMatchObject({
    deletionFences: 0,
  });
});
test.each(["approvals", "generation", "client", "unpaused", "released"])(
  "rollback rejects %s without changing credentials",
  async (failure) => {
    const t = setup();
    await seed(t);
    const args = { ...(await barrier(t)), reviewed: await review(t) };
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

// Provider events land while account changes are paused, between the reviewed
// dry run and a page's write. The writer must refuse the whole page.
const passwords = (t: ReturnType<typeof setup>) =>
  t.run(async (ctx) => {
    const page = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "account",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    return (page.page as { password?: string | null }[]).map(
      (account) => account.password
    );
  });
test("the writer has no path without a reviewed scope", async () => {
  const t = setup();
  await seed(t);
  const { reviewed: _scope, ...unreviewed } = {
    ...(await barrier(t)),
    reviewed: await review(t),
  };
  await expect(t.mutation(applyRollback, unreviewed)).rejects.toThrow(
    "Missing required field `reviewed`"
  );
  expect(await passwords(t)).toEqual(["unchanged-legacy-test-hash"]);
});
test("a mapped owner without reviewed entries fails the page with nothing written", async () => {
  const t = setup();
  const first = await seed(t);
  await seed(t, "second");
  const args = { ...(await barrier(t)), reviewed: await review(t) };
  const only = (ids: string[]) => ids.filter((id) => id === first);
  const firstOnly = {
    invalidate: only(args.reviewed.invalidate),
    verify: only(args.reviewed.verify),
    fences: only(args.reviewed.fences),
    denied: only(args.reviewed.denied),
    mappings: args.reviewed.mappings.filter(
      (link) => link.teakUserId === first
    ),
  };
  await expect(
    t.mutation(applyRollback, { ...args, reviewed: firstOnly })
  ).rejects.toThrow("outside the reviewed dry run");
  expect(await passwords(t)).toEqual([
    "unchanged-legacy-test-hash",
    "unchanged-legacy-test-hash",
  ]);
});
async function patchProfile(
  t: ReturnType<typeof setup>,
  workosUserId: string,
  emailVerified: boolean
) {
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("workosProfiles")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .unique();
    if (!row?.profile) {
      throw new Error("Missing fixture");
    }
    await ctx.db.patch("workosProfiles", row._id, {
      profile: { ...row.profile, emailVerified },
    });
  });
}
const secondPassword = (t: ReturnType<typeof setup>, password: string | null) =>
  t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: "account",
        where: [{ field: "accountId", value: "second-account" }],
        update: { password },
      },
    })
  );
test.each([
  "same-count swap",
  "relink",
  "provider deletion",
  "restored password",
  "started deletion",
  "provider deletion of a deleting owner",
])(
  "a %s after the reviewed dry run fails the page with nothing written",
  async (change) => {
    const t = setup();
    await seed(t);
    const second = await seed(t, "second");
    await patchProfile(t, "user_second", false);
    await t.run(async (ctx) => {
      const account = await ctx.runQuery(
        components.betterAuth.adapter.findOne,
        { model: "account", where: [{ field: "userId", value: second }] }
      );
      if (!account) {
        throw new Error("Missing fixture");
      }
      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: "account",
          where: [{ field: "userId", value: second }],
          update: { accountId: "second-account" },
        },
      });
    });
    if (change === "restored password") {
      await secondPassword(t, null);
    }
    if (change === "provider deletion of a deleting owner") {
      await t.run((ctx) =>
        ctx.db.insert("accountDeletionStates", { userId: second, startedAt: 1 })
      );
    }
    const args = { ...(await barrier(t)), reviewed: await review(t) };
    expect(args.reviewed.verify).toHaveLength(1);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("users")
        .withIndex("by_teakUserId", (q) => q.eq("teakUserId", second))
        .unique();
      if (!row) {
        throw new Error("Missing fixture");
      }
      if (change === "started deletion") {
        await ctx.db.insert("accountDeletionStates", {
          userId: second,
          startedAt: 1,
        });
      }
      if (change === "relink") {
        await ctx.db.patch("users", row._id, { workosUserId: "user_relinked" });
        await ctx.db.insert("workosProfiles", {
          workosUserId: "user_relinked",
          teakUserId: second,
          revision: 1,
          source: "event",
          providerUpdatedAt: "2026-10-02T00:00:00Z",
          profile: {
            email: "second@example.com",
            emailVerified: false,
            externalId: second,
            firstName: null,
            lastName: null,
            profilePictureUrl: null,
          },
        });
      }
      if (change.startsWith("provider deletion")) {
        await ctx.db.patch("users", row._id, { workosDeletedAt: 42 });
      }
    });
    if (change === "restored password") {
      // An out-of-band credential write: invalidation grows past the review.
      await secondPassword(t, "unchanged-legacy-test-hash");
    }
    if (change === "same-count swap") {
      // One owner's verification drops while another's lands: same size.
      await patchProfile(t, "user_owner", false);
      await patchProfile(t, "user_second", true);
      expect((await review(t)).verify).toEqual([second]);
    }
    await expect(t.mutation(applyRollback, args)).rejects.toThrow(
      "outside the reviewed dry run"
    );
    expect(await passwords(t)).toEqual([
      "unchanged-legacy-test-hash",
      "unchanged-legacy-test-hash",
    ]);
    const state = await t.run(async (ctx) => ({
      owners: await ctx.db.query("users").collect(),
      verified: await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "_id", value: second }],
      }),
    }));
    expect(state.owners.every((row) => row.deletedAt === undefined)).toBe(true);
    expect(state.verified).toMatchObject({ emailVerified: false });
  }
);
test.each(["email", "external", "profile_owner", "pending", "downgrade"])(
  "rollback blocks %s before changing any owner",
  async (failure) => {
    const t = setup();
    const id = await seed(t),
      args = { ...(await barrier(t)), reviewed: await review(t) };
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
    const args = { ...(await barrier(t)), reviewed: await review(t) };
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
