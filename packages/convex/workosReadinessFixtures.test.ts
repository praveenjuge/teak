/// <reference types="vite/client" />
import * as betterAuthAdapter from "@convex-dev/better-auth/adapter";
import betterAuthTest from "@convex-dev/better-auth/test";
import {
  type GenericDataModel,
  type GenericQueryCtx,
  makeFunctionReference,
} from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { readinessFixture as fixture } from "./migration/workosReadinessFixtures";
import schema from "./schema";
import { currentWorkosDeletionTarget } from "./workosDeletionCompletion";

const modules = import.meta.glob("./**/*.ts");
const pins = {
  environmentId: fixture.environmentId,
  clientId: fixture.clientId,
  apiKeyFingerprint:
    "0cd3cf5f74c92c94559c4397065417ee80f45c5115d28889b9872049ea5533aa",
};
const deletedEventId = "event_01M43GS9THTK7FTPPGWJNDRRTX";
const deletedEventAt = fixture.quarantineAt + 1000;
const email = `${fixture.marker}@example.test`;
const resolve = makeFunctionReference<
  "mutation",
  typeof pins & {
    quarantineId: Id<"migrationQuarantine">;
    deletedQuarantineId: Id<"migrationQuarantine">;
    deletedQuarantineCreatedAt: number;
    deletedEventId: string;
    deletedEventAt: number;
  },
  { resolvedAt: number; alreadyResolved: boolean }
>("migration/workosReadinessFixtures:resolveRetiredFixture");
beforeEach(() => {
  vi.stubEnv("AUTH_PRIMARY", "betterauth");
  vi.stubEnv("SIGNUPS_DISABLED", "true");
  vi.stubEnv("CONVEX_CLOUD_URL", fixture.cloudUrl);
  vi.stubEnv("CONVEX_SITE_URL", fixture.siteUrl);
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", fixture.environmentId);
  vi.stubEnv("WORKOS_CLIENT_ID", fixture.clientId);
  vi.stubEnv("WORKOS_API_KEY", "test-workos-reconciliation-key");
});
afterEach(() => vi.unstubAllEnvs());
async function setup(strictLegacyIds = false) {
  const t = convexTest(schema, modules);
  if (strictLegacyIds) {
    const adapterPath = Object.keys(betterAuthTest.modules).find((path) =>
      path.endsWith("/adapter.ts")
    );
    if (!adapterPath) {
      throw new Error("Better Auth component adapter is missing");
    }
    const registered = betterAuthAdapter.findMany;
    if (
      !("_handler" in registered) ||
      typeof registered._handler !== "function"
    ) {
      throw new Error("Better Auth adapter handler is missing");
    }
    const originalHandler = registered._handler;
    t.registerComponent("betterAuth", betterAuthTest.schema, {
      ...betterAuthTest.modules,
      [adapterPath]: async () => ({
        ...betterAuthAdapter,
        findMany: {
          ...betterAuthAdapter.findMany,
          _handler: (
            ctx: GenericQueryCtx<GenericDataModel>,
            args: Record<string, unknown>
          ) => {
            // convex-test permits arbitrary IDs. Enforce the production database
            // boundary while executing the actual installed component handler.
            const db = new Proxy(ctx.db, {
              get(target, property, receiver) {
                if (property !== "get") {
                  return Reflect.get(target, property, receiver);
                }
                return (...ids: Parameters<typeof target.get>) => {
                  if (ids.some((id) => id === fixture.marker)) {
                    throw new Error(
                      "Invalid argument to db.get: ID was not valid base32"
                    );
                  }
                  return Reflect.apply(target.get, target, ids);
                };
              },
            });
            return Reflect.apply(originalHandler, undefined, [
              { ...ctx, db },
              args,
            ]);
          },
        },
      }),
    });
  } else {
    betterAuthTest.register(t);
  }
  const target = (await currentWorkosDeletionTarget())!;
  const rows = await t.run(async (ctx) => {
    const quarantineId = await ctx.db.insert("migrationQuarantine", {
      workosUserId: fixture.workosUserId,
      teakUserId: fixture.marker,
      email,
      reason: "external_id_mismatch",
      source: "webhook",
      createdAt: fixture.quarantineAt,
    });
    const createdId = await ctx.db.insert("workosEvents", {
      workosUserId: fixture.workosUserId,
      eventId: fixture.createdEventId,
      type: "user.created",
      createdAt: fixture.createdEventAt,
    });
    const deletedId = await ctx.db.insert("workosEvents", {
      workosUserId: fixture.workosUserId,
      eventId: deletedEventId,
      type: "user.deleted",
      createdAt: deletedEventAt,
      email,
      externalId: fixture.marker,
    });
    const profileId = await ctx.db.insert("workosProfiles", {
      workosUserId: fixture.workosUserId,
      revision: 1,
      source: "event",
      deletionSource: "event",
      deletedAt: deletedEventAt,
      lastEventAt: deletedEventAt,
      profile: {
        email,
        emailVerified: true,
        externalId: fixture.marker,
        firstName: null,
        lastName: null,
        profilePictureUrl: null,
      },
    });
    const auditId = await ctx.db.insert("migrationQuarantine", {
      workosUserId: fixture.workosUserId,
      email,
      reason: "workos_user_deleted",
      source: "webhook",
      createdAt: deletedEventAt,
      workosDeletionEventAt: deletedEventAt,
      workosDeletionTarget: target,
    });
    return { quarantineId, createdId, deletedId, profileId, auditId };
  });
  return {
    t,
    rows,
    args: {
      ...pins,
      quarantineId: rows.quarantineId,
      deletedQuarantineId: rows.auditId,
      deletedQuarantineCreatedAt: deletedEventAt,
      deletedEventId,
      deletedEventAt,
    },
  };
}
// Failure modes: wrong deployment/key or caller row, changed exact fixture,
// missing/duplicate/stale/unexpanded receipts, nonterminal/owned tombstone,
// canonical or legacy ownership, bounded scan uncertainty, loose retry, and
// accidentally clearing unrelated deletion audit/history.
test("resolves exactly both retired fixture receipts atomically and preserves history on strict retry", async () => {
  const { t, rows, args } = await setup();
  const before = await t.run((ctx) => ctx.db.get(rows.quarantineId));
  const result = await t.mutation(resolve, args);
  expect(result.alreadyResolved).toBe(false);
  expect(await t.run((ctx) => ctx.db.get(rows.quarantineId))).toEqual({
    ...before,
    resolvedAt: result.resolvedAt,
  });
  expect(await t.mutation(resolve, args)).toEqual({
    ...result,
    alreadyResolved: true,
  });
  const audit = await t.run((ctx) => ctx.db.get(rows.auditId));
  expect(audit?.reason).toBe("workos_user_deleted");
  expect(audit?.resolvedAt).toBe(result.resolvedAt);
  expect(
    await t.run((ctx) => ctx.db.query("workosEvents").collect())
  ).toHaveLength(2);
});
test.each([
  "CONVEX_CLOUD_URL",
  "CONVEX_SITE_URL",
  "WORKOS_ENVIRONMENT_ID",
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
])("refuses changed %s without resolving", async (key) => {
  const { t, rows, args } = await setup();
  vi.stubEnv(key, "production-or-changed");
  await expect(t.mutation(resolve, args)).rejects.toThrow();
  expect(
    (await t.run((ctx) => ctx.db.get(rows.quarantineId)))?.resolvedAt
  ).toBeUndefined();
});
test.each([
  "minimal-delete",
  "wrong-email",
  "wrong-marker",
  "missing-created",
  "duplicate-created",
  "stale-delete",
  "live-profile",
  "owned-profile",
  "duplicate-quarantine",
  "changed-quarantine",
])("refuses %s proof", async (failure) => {
  const { t, rows, args } = await setup();
  await t.run(async (ctx) => {
    if (failure === "minimal-delete") {
      await ctx.db.patch(rows.deletedId, {
        email: undefined,
        externalId: undefined,
      });
    }
    if (failure === "wrong-email") {
      await ctx.db.patch(rows.deletedId, { email: "other@example.test" });
    }
    if (failure === "wrong-marker") {
      await ctx.db.patch(rows.deletedId, { externalId: "other" });
    }
    if (failure === "missing-created") {
      await ctx.db.delete(rows.createdId);
    }
    if (failure === "duplicate-created") {
      await ctx.db.insert("workosEvents", {
        eventId: fixture.createdEventId,
        workosUserId: fixture.workosUserId,
        type: "user.created",
        createdAt: fixture.createdEventAt,
      });
    }
    if (failure === "stale-delete") {
      await ctx.db.patch(rows.deletedId, { createdAt: fixture.createdEventAt });
    }
    if (failure === "live-profile") {
      await ctx.db.patch(rows.profileId, { deletedAt: undefined });
    }
    if (failure === "owned-profile") {
      await ctx.db.patch(rows.profileId, { teakUserId: "real-owner" });
    }
    if (failure === "duplicate-quarantine") {
      await ctx.db.insert("migrationQuarantine", {
        workosUserId: fixture.workosUserId,
        teakUserId: fixture.marker,
        email,
        reason: "external_id_mismatch",
        source: "webhook",
        createdAt: fixture.quarantineAt,
      });
    }
    if (failure === "changed-quarantine") {
      await ctx.db.patch(rows.quarantineId, { source: "reconciliation" });
    }
  });
  await expect(t.mutation(resolve, args)).rejects.toThrow();
  expect(
    (await t.run((ctx) => ctx.db.get(rows.quarantineId)))?.resolvedAt
  ).toBeUndefined();
});
test.each([
  "canonical-marker",
  "canonical-mapping",
  "normalized-owner",
  "legacy-user",
  "legacy-account",
  "cards",
])("refuses %s ownership", async (failure) => {
  const { t, rows, args } = await setup();
  await t.run(async (ctx) => {
    if (failure.startsWith("canonical") || failure === "normalized-owner") {
      await ctx.db.insert("users", {
        teakUserId:
          failure === "canonical-marker" ? fixture.marker : "real-owner",
        workosUserId:
          failure === "canonical-mapping" ? fixture.workosUserId : undefined,
        email:
          failure === "normalized-owner"
            ? email.toUpperCase()
            : "owner@example.test",
        emailVerified: true,
      });
    }
    if (failure === "legacy-user") {
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "user",
          data: {
            name: "Owner",
            email: email.toUpperCase(),
            emailVerified: true,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      });
    }
    if (failure === "legacy-account") {
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "account",
          data: {
            accountId: "unlinked",
            providerId: "google",
            userId: fixture.marker,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      });
    }
    if (failure === "cards") {
      await ctx.db.insert("cards", {
        userId: fixture.marker,
        type: "text",
        content: "fixture",
        createdAt: 1,
        updatedAt: 1,
      });
    }
  });
  await expect(t.mutation(resolve, args)).rejects.toThrow();
  expect(
    (await t.run((ctx) => ctx.db.get(rows.quarantineId)))?.resolvedAt
  ).toBeUndefined();
});
test("revalidates every proof on retry instead of treating resolvedAt as a bypass", async () => {
  const { t, rows, args } = await setup();
  await t.mutation(resolve, args);
  await t.run((ctx) => ctx.db.patch(rows.deletedId, { externalId: undefined }));
  await expect(t.mutation(resolve, args)).rejects.toThrow();
});

test.each([
  "caller-row",
  "caller-time",
  "created-provider",
  "created-time",
  "created-type",
  "delete-provider",
  "delete-type",
  "duplicate-delete",
  "missing-profile",
  "duplicate-profile",
  "reconciliation-tombstone",
  "profile-event-time",
  "profile-email",
  "profile-marker",
  "quarantine-time",
  "quarantine-marker",
  "quarantine-email",
  "invalid-resolved-time",
])("refuses changed %s exact authority", async (failure) => {
  const { t, rows, args } = await setup();
  await t.run(async (ctx) => {
    if (failure === "caller-row") {
      args.quarantineId = rows.auditId;
    }
    if (failure === "caller-time") {
      args.deletedEventAt += 1;
    }
    if (failure === "created-provider") {
      await ctx.db.patch(rows.createdId, { workosUserId: "user_other" });
    }
    if (failure === "created-time") {
      await ctx.db.patch(rows.createdId, {
        createdAt: fixture.createdEventAt + 1,
      });
    }
    if (failure === "created-type") {
      await ctx.db.patch(rows.createdId, { type: "user.updated" });
    }
    if (failure === "delete-provider") {
      await ctx.db.patch(rows.deletedId, { workosUserId: "user_other" });
    }
    if (failure === "delete-type") {
      await ctx.db.patch(rows.deletedId, { type: "user.updated" });
    }
    if (failure === "duplicate-delete") {
      await ctx.db.insert("workosEvents", {
        workosUserId: fixture.workosUserId,
        eventId: deletedEventId,
        type: "user.deleted",
        createdAt: deletedEventAt,
        email,
        externalId: fixture.marker,
      });
    }
    if (failure === "missing-profile") {
      await ctx.db.delete(rows.profileId);
    }
    if (failure === "duplicate-profile") {
      await ctx.db.insert("workosProfiles", {
        workosUserId: fixture.workosUserId,
        revision: 2,
        source: "event",
        deletedAt: deletedEventAt,
        lastEventAt: deletedEventAt,
        deletionSource: "event",
      });
    }
    if (failure === "reconciliation-tombstone") {
      await ctx.db.patch(rows.profileId, {
        deletionSource: "reconciliation_not_found",
      });
    }
    if (failure === "profile-event-time") {
      await ctx.db.patch(rows.profileId, { lastEventAt: deletedEventAt + 1 });
    }
    if (failure === "profile-email" || failure === "profile-marker") {
      const profile = await ctx.db.get(rows.profileId);
      await ctx.db.patch(rows.profileId, {
        profile: {
          ...profile!.profile!,
          ...(failure === "profile-email"
            ? { email: "other@example.test" }
            : { externalId: "another-marker" }),
        },
      });
    }
    if (failure === "quarantine-time") {
      await ctx.db.patch(rows.quarantineId, {
        createdAt: fixture.quarantineAt + 1,
      });
    }
    if (failure === "quarantine-marker") {
      await ctx.db.patch(rows.quarantineId, { teakUserId: "another-marker" });
    }
    if (failure === "quarantine-email") {
      await ctx.db.patch(rows.quarantineId, { email: "other@example.test" });
    }
    if (failure === "invalid-resolved-time") {
      await ctx.db.patch(rows.quarantineId, { resolvedAt: 1 });
    }
  });
  const before = await t.run(async (ctx) => [
    await ctx.db.get(rows.quarantineId),
    await ctx.db.get(rows.auditId),
  ]);
  await expect(t.mutation(resolve, args)).rejects.toThrow();
  expect(
    await t.run(async (ctx) => [
      await ctx.db.get(rows.quarantineId),
      await ctx.db.get(rows.auditId),
    ])
  ).toEqual(before);
});
test("refuses uncertain canonical coverage at the bounded scan cap", async () => {
  const { t, rows, args } = await setup();
  await t.run(async (ctx) => {
    for (let index = 0; index < 1000; index++) {
      await ctx.db.insert("users", {
        teakUserId: `unrelated-${index}`,
        email: `unrelated-${index}@example.test`,
        emailVerified: true,
      });
    }
  });
  await expect(t.mutation(resolve, args)).rejects.toThrow();
  expect(
    (await t.run((ctx) => ctx.db.get(rows.quarantineId)))?.resolvedAt
  ).toBeUndefined();
});

test("refuses a second canonical profile claiming the fixture under another provider", async () => {
  const { t, args } = await setup();
  await t.run((ctx) =>
    ctx.db.insert("workosProfiles", {
      workosUserId: "user_other",
      teakUserId: fixture.marker,
      revision: 1,
      source: "event",
    })
  );
  await expect(t.mutation(resolve, args)).rejects.toThrow();
});
test("refuses uncertain legacy coverage at the bounded component scan cap", async () => {
  const { t, rows, args } = await setup();
  await t.run(async (ctx) => {
    for (let index = 0; index < 1001; index++) {
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "user",
          data: {
            name: "Other",
            email: `legacy-${index}@example.test`,
            emailVerified: true,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      });
    }
  });
  // Component adapter writes are isolated here and do not invoke Teak mirrors.
  // Keep the canonical cap out of the refusal so this proves legacy coverage.
  expect(await t.run((ctx) => ctx.db.query("users").take(1000))).toEqual([]);
  await expect(t.mutation(resolve, args)).rejects.toThrow();
  expect(
    (await t.run((ctx) => ctx.db.get(rows.quarantineId)))?.resolvedAt
  ).toBeUndefined();
});

// The added settlement cannot treat a deletion reason as globally harmless.
// It must bind the exact authenticated receipt and settle both or neither.
test.each([
  "wrong-row",
  "wrong-created-time",
  "wrong-event-time",
  "wrong-email",
  "wrong-source",
  "claimed-owner",
  "missing-target",
  "missing-row",
  "duplicate-row",
  "older-row",
])(
  "refuses %s deletion audit without partially resolving the original conflict",
  async (failure) => {
    const { t, rows, args } = await setup();
    await t.run(async (ctx) => {
      if (failure === "wrong-row") {
        args.deletedQuarantineId = rows.quarantineId;
      }
      if (failure === "wrong-created-time") {
        args.deletedQuarantineCreatedAt += 1;
      }
      if (failure === "wrong-event-time") {
        await ctx.db.patch(rows.auditId, {
          workosDeletionEventAt: deletedEventAt - 1,
        });
      }
      if (failure === "wrong-email") {
        await ctx.db.patch(rows.auditId, { email: "other@example.test" });
      }
      if (failure === "wrong-source") {
        await ctx.db.patch(rows.auditId, { source: "reconciliation" });
      }
      if (failure === "claimed-owner") {
        await ctx.db.patch(rows.auditId, { teakUserId: fixture.marker });
      }
      if (failure === "missing-target") {
        await ctx.db.patch(rows.auditId, { workosDeletionTarget: undefined });
      }
      if (failure === "missing-row") {
        await ctx.db.delete(rows.auditId);
      }
      if (failure === "duplicate-row" || failure === "older-row") {
        const audit = await ctx.db.get(rows.auditId);
        await ctx.db.insert("migrationQuarantine", {
          workosUserId: fixture.workosUserId,
          email,
          reason: "workos_user_deleted",
          source: "webhook",
          createdAt:
            failure === "older-row" ? deletedEventAt - 1 : deletedEventAt,
          workosDeletionEventAt:
            failure === "older-row" ? deletedEventAt - 1 : deletedEventAt,
          workosDeletionTarget: audit?.workosDeletionTarget,
        });
      }
    });
    await expect(t.mutation(resolve, args)).rejects.toThrow();
    expect(
      (await t.run((ctx) => ctx.db.get(rows.quarantineId)))?.resolvedAt
    ).toBeUndefined();
    expect(
      (await t.run((ctx) => ctx.db.get(rows.auditId)))?.resolvedAt
    ).toBeUndefined();
  }
);
test.each([
  "environmentId",
  "clientId",
  "issuer",
  "credentialFingerprint",
] as const)("refuses changed deletion audit %s target", async (pin) => {
  const { t, rows, args } = await setup();
  await t.run(async (ctx) => {
    const audit = await ctx.db.get(rows.auditId);
    await ctx.db.patch(rows.auditId, {
      workosDeletionTarget: { ...audit!.workosDeletionTarget!, [pin]: "wrong" },
    });
  });
  await expect(t.mutation(resolve, args)).rejects.toThrow();
  expect(
    (await t.run((ctx) => ctx.db.get(rows.quarantineId)))?.resolvedAt
  ).toBeUndefined();
});
test("preserves unrelated and other-provider deletion history while resolving the exact fixture pair", async () => {
  const { t, args } = await setup();
  const otherIds = await t.run(async (ctx) => [
    await ctx.db.insert("migrationQuarantine", {
      workosUserId: "user_OTHER",
      email,
      reason: "workos_user_deleted",
      source: "webhook",
      createdAt: deletedEventAt,
    }),
    await ctx.db.insert("migrationQuarantine", {
      workosUserId: fixture.workosUserId,
      email,
      reason: "verification_conflict",
      source: "webhook",
      createdAt: deletedEventAt,
    }),
  ]);
  const before = await t.run((ctx) =>
    Promise.all(otherIds.map((id) => ctx.db.get(id)))
  );
  await t.mutation(resolve, args);
  expect(
    await t.run((ctx) => Promise.all(otherIds.map((id) => ctx.db.get(id))))
  ).toEqual(before);
});
test.each(["original-only", "audit-only", "different-timestamps"])(
  "refuses partially changed %s resolution on strict retry",
  async (failure) => {
    const { t, rows, args } = await setup();
    const resolvedAt = Date.now();
    await t.run(async (ctx) => {
      if (failure !== "audit-only") {
        await ctx.db.patch(rows.quarantineId, { resolvedAt });
      }
      if (failure !== "original-only") {
        await ctx.db.patch(rows.auditId, {
          resolvedAt:
            failure === "different-timestamps" ? resolvedAt - 1 : resolvedAt,
        });
      }
    });
    await expect(t.mutation(resolve, args)).rejects.toThrow();
  }
);
test("strict retry revalidates the deletion audit rather than trusting paired resolved timestamps", async () => {
  const { t, rows, args } = await setup();
  await t.mutation(resolve, args);
  await t.run((ctx) =>
    ctx.db.patch(rows.auditId, { workosDeletionEventAt: deletedEventAt - 1 })
  );
  await expect(t.mutation(resolve, args)).rejects.toThrow();
});

test.each([
  { key: "AUTH_PRIMARY", value: "workos" },
  { key: "SIGNUPS_DISABLED", value: "false" },
])(
  "refuses fixture fence resolution when writer admission $key=$value",
  async ({ key, value }) => {
    const { t, rows, args } = await setup();
    vi.stubEnv(key, value);
    await expect(t.mutation(resolve, args)).rejects.toThrow();
    expect(
      (await t.run((ctx) => ctx.db.get(rows.quarantineId)))?.resolvedAt
    ).toBeUndefined();
    expect(
      (await t.run((ctx) => ctx.db.get(rows.auditId)))?.resolvedAt
    ).toBeUndefined();
  }
);

test("retires non-ID fixture marker through complete legacy scan with production ID validation", async () => {
  const { t, rows, args } = await setup(true);
  // The real adapter optimizes _id equality into db.get. This demonstrates the
  // exact failing production boundary before exercising the operator mutation.
  await expect(
    t.query(components.betterAuth.adapter.findMany, {
      model: "user",
      where: [{ field: "_id", value: fixture.marker }],
      paginationOpts: { cursor: null, numItems: 1 },
    })
  ).rejects.toThrow("ID was not valid base32");
  const result = await t.mutation(resolve, args);
  expect(result.alreadyResolved).toBe(false);
  expect(
    (await t.run((ctx) => ctx.db.get(rows.quarantineId)))?.resolvedAt
  ).toBe(result.resolvedAt);
  expect((await t.run((ctx) => ctx.db.get(rows.auditId)))?.resolvedAt).toBe(
    result.resolvedAt
  );
});
