/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { phaseRReadinessFixture as fixture } from "./migration/workosReadinessFixtures";
import schema from "./schema";
import { currentWorkosDeletionTarget } from "./workosDeletionCompletion";

const modules = import.meta.glob("./**/*.ts");
const email = `${fixture.marker}@example.com`;
const eventAt = fixture.lastObservedAt + 1000;
const eventId = "event_01M43GS9THTK7FTPPGWJNDRRTX";
const pins = {
  environmentId: fixture.environmentId,
  clientId: fixture.clientId,
  apiKeyFingerprint:
    "0cd3cf5f74c92c94559c4397065417ee80f45c5115d28889b9872049ea5533aa",
};
const resolve = makeFunctionReference<
  "mutation",
  typeof pins & {
    deletedQuarantineId: Id<"migrationQuarantine">;
    deletedQuarantineCreatedAt: number;
    deletedEventId: string;
    deletedEventAt: number;
  },
  { resolvedAt: number; alreadyResolved: boolean }
>("migration/workosReadinessFixtures:resolveRetiredPhaseRFixture");
beforeEach(() => {
  vi.stubEnv("AUTH_PRIMARY", "betterauth");
  vi.stubEnv("SIGNUPS_DISABLED", "true");
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
  vi.stubEnv("CONVEX_CLOUD_URL", fixture.cloudUrl);
  vi.stubEnv("CONVEX_SITE_URL", fixture.siteUrl);
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", fixture.environmentId);
  vi.stubEnv("WORKOS_CLIENT_ID", fixture.clientId);
  vi.stubEnv("WORKOS_API_KEY", "test-workos-reconciliation-key");
});
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  const target = (await currentWorkosDeletionTarget())!;
  const rows = await t.run(async (ctx) => ({
    audit: await ctx.db.insert("migrationQuarantine", {
      workosUserId: fixture.workosUserId,
      email,
      reason: "workos_user_deleted",
      source: "webhook",
      createdAt: eventAt,
      workosDeletionEventAt: eventAt,
      workosDeletionTarget: target,
    }),
    event: await ctx.db.insert("workosEvents", {
      workosUserId: fixture.workosUserId,
      eventId,
      type: "user.deleted",
      createdAt: eventAt,
      email,
      externalId: fixture.marker,
    }),
    profile: await ctx.db.insert("workosProfiles", {
      workosUserId: fixture.workosUserId,
      revision: 1,
      source: "event",
      deletionSource: "event",
      deletedAt: eventAt,
      lastEventAt: eventAt,
    }),
  }));
  return {
    t,
    rows,
    args: {
      ...pins,
      deletedQuarantineId: rows.audit,
      deletedQuarantineCreatedAt: eventAt,
      deletedEventId: eventId,
      deletedEventAt: eventAt,
    },
  };
}
// Failure modes: wrong deployment/writer admission/key, forged or stale receipt,
// unexpected conflict/history, owned/live/ambiguous profile, storage or source
// ownership, incomplete bounded census, and trusting a prior resolution.
test("settles only the exact Phase R deletion audit without fabricating an original creation receipt or proxy profile", async () => {
  const { t, rows, args } = await setup();
  const unrelated = await t.run((ctx) =>
    ctx.db.insert("migrationQuarantine", {
      workosUserId: "user_other",
      email: "other@example.test",
      source: "webhook",
      reason: "workos_user_deleted",
      createdAt: eventAt,
    })
  );
  const before = await t.run((ctx) => ctx.db.get(unrelated));
  const result = await t.mutation(resolve, args);
  expect(result.alreadyResolved).toBe(false);
  expect((await t.run((ctx) => ctx.db.get(rows.audit)))?.resolvedAt).toBe(
    result.resolvedAt
  );
  expect(await t.mutation(resolve, args)).toEqual({
    ...result,
    alreadyResolved: true,
  });
  expect(await t.run((ctx) => ctx.db.get(unrelated))).toEqual(before);
  expect(
    await t.run((ctx) => ctx.db.query("workosEvents").collect())
  ).toHaveLength(1);
  expect(
    (await t.run((ctx) => ctx.db.get(rows.profile)))?.profile
  ).toBeUndefined();
});
test.each([
  ["AUTH_PRIMARY", "workos"],
  ["SIGNUPS_DISABLED", "false"],
  ["ACCOUNT_CHANGES_PAUSED", "false"],
  ["ACCOUNT_CHANGES_PAUSED", ""],
  ["ACCOUNT_CHANGES_PAUSED", undefined],
  ["CONVEX_CLOUD_URL", "https://other.convex.cloud"],
  ["CONVEX_SITE_URL", "https://other.convex.site"],
  ["WORKOS_ENVIRONMENT_ID", "environment_other"],
  ["WORKOS_CLIENT_ID", "client_other"],
  ["WORKOS_API_KEY", "rotated"],
])("refuses changed %s operator binding", async (key, value) => {
  const { t, rows, args } = await setup();
  vi.stubEnv(key, value);
  await expect(t.mutation(resolve, args)).rejects.toThrow();
  expect(
    (await t.run((ctx) => ctx.db.get(rows.audit)))?.resolvedAt
  ).toBeUndefined();
});
test.each([
  "event-email",
  "event-marker",
  "event-provider",
  "event-type",
  "event-time",
  "minimal-event",
  "duplicate-event",
  "other-provider-same-event",
  "prior-event",
  "audit-email",
  "audit-owner",
  "audit-source",
  "audit-reason",
  "audit-time",
  "audit-target",
  "duplicate-audit",
  "resolved-history",
  "other-conflict",
  "profile-owner",
  "profile-live",
  "profile-source",
  "profile-time",
  "profile-proxy-email",
  "profile-proxy-marker",
  "duplicate-profile",
  "other-profile-email",
  "other-profile-marker",
  "canonical-email",
  "canonical-marker",
  "canonical-provider",
  "legacy-email",
  "legacy-account",
  "marker-card",
  "provider-card",
  "stale-caller",
  "wrong-caller",
  "invalid-retry",
  "retry-before-audit",
])("refuses %s changed retirement proof atomically", async (failure) => {
  const { t, rows, args } = await setup();
  await t.run(async (ctx) => {
    const event = (await ctx.db.get(rows.event))!;
    const audit = (await ctx.db.get(rows.audit))!;
    if (failure === "event-email") {
      await ctx.db.patch(rows.event, { email: "other@example.com" });
    }
    if (failure === "event-marker") {
      await ctx.db.patch(rows.event, { externalId: "other" });
    }
    if (failure === "event-provider") {
      await ctx.db.patch(rows.event, { workosUserId: "user_other" });
    }
    if (failure === "event-type") {
      await ctx.db.patch(rows.event, { type: "user.updated" });
    }
    if (failure === "event-time") {
      await ctx.db.patch(rows.event, { createdAt: eventAt - 1 });
    }
    if (failure === "minimal-event") {
      await ctx.db.patch(rows.event, {
        email: undefined,
        externalId: undefined,
      });
    }
    if (
      ["duplicate-event", "other-provider-same-event", "prior-event"].includes(
        failure
      )
    ) {
      await ctx.db.insert("workosEvents", {
        workosUserId:
          failure === "other-provider-same-event"
            ? "user_other"
            : fixture.workosUserId,
        eventId:
          failure === "prior-event"
            ? "event_01M43GS9THTK7FTPPGWJNDRRTY"
            : event.eventId,
        type: failure === "prior-event" ? "user.updated" : event.type,
        createdAt: eventAt,
        email,
        externalId: fixture.marker,
      });
    }
    if (failure === "audit-email") {
      await ctx.db.patch(rows.audit, { email: "other@example.com" });
    }
    if (failure === "audit-owner") {
      await ctx.db.patch(rows.audit, { teakUserId: fixture.marker });
    }
    if (failure === "audit-source") {
      await ctx.db.patch(rows.audit, { source: "reconciliation" });
    }
    if (failure === "audit-reason") {
      await ctx.db.patch(rows.audit, { reason: "verification_conflict" });
    }
    if (failure === "audit-time") {
      await ctx.db.patch(rows.audit, { workosDeletionEventAt: eventAt - 1 });
    }
    if (failure === "audit-target") {
      await ctx.db.patch(rows.audit, {
        workosDeletionTarget: {
          ...audit.workosDeletionTarget!,
          credentialFingerprint: "old",
        },
      });
    }
    if (
      ["duplicate-audit", "resolved-history", "other-conflict"].includes(
        failure
      )
    ) {
      await ctx.db.insert("migrationQuarantine", {
        workosUserId: fixture.workosUserId,
        email,
        source: "webhook",
        reason:
          failure === "other-conflict"
            ? "verification_conflict"
            : "workos_user_deleted",
        createdAt: eventAt - 1,
        ...(failure === "resolved-history" ? { resolvedAt: eventAt } : {}),
      });
    }
    if (failure === "profile-owner") {
      await ctx.db.patch(rows.profile, { teakUserId: fixture.marker });
    }
    if (failure === "profile-live") {
      await ctx.db.patch(rows.profile, { deletedAt: undefined });
    }
    if (failure === "profile-source") {
      await ctx.db.patch(rows.profile, {
        deletionSource: "reconciliation_not_found",
      });
    }
    if (failure === "profile-time") {
      await ctx.db.patch(rows.profile, { lastEventAt: eventAt - 1 });
    }
    if (failure.startsWith("profile-proxy")) {
      await ctx.db.patch(rows.profile, {
        profile: {
          email:
            failure === "profile-proxy-email" ? "other@example.com" : email,
          externalId:
            failure === "profile-proxy-marker" ? "other" : fixture.marker,
          emailVerified: true,
          firstName: null,
          lastName: null,
          profilePictureUrl: null,
        },
      });
    }
    if (
      [
        "duplicate-profile",
        "other-profile-email",
        "other-profile-marker",
      ].includes(failure)
    ) {
      await ctx.db.insert("workosProfiles", {
        workosUserId:
          failure === "duplicate-profile" ? fixture.workosUserId : "user_other",
        revision: 1,
        source: "event",
        deletionSource: "event",
        deletedAt: eventAt,
        lastEventAt: eventAt,
        profile: {
          email:
            failure === "other-profile-email"
              ? email.toUpperCase()
              : "other@example.com",
          externalId:
            failure === "other-profile-marker" ? fixture.marker : "other",
          emailVerified: true,
          firstName: null,
          lastName: null,
          profilePictureUrl: null,
        },
      });
    }
    if (failure.startsWith("canonical")) {
      await ctx.db.insert("users", {
        teakUserId: failure === "canonical-marker" ? fixture.marker : "other",
        workosUserId:
          failure === "canonical-provider" ? fixture.workosUserId : undefined,
        email:
          failure === "canonical-email"
            ? email.toUpperCase()
            : "other@example.com",
        emailVerified: true,
      });
    }
    if (failure === "legacy-email") {
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
            accountId: "orphan",
            providerId: "credential",
            userId: fixture.marker,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      });
    }
    if (failure.endsWith("card")) {
      await ctx.db.insert("cards", {
        userId:
          failure === "marker-card" ? fixture.marker : fixture.workosUserId,
        type: "text",
        content: "fixture",
        createdAt: 1,
        updatedAt: 1,
        isDeleted: false,
      });
    }
    if (failure === "stale-caller") {
      args.deletedEventAt = fixture.lastObservedAt;
    }
    if (failure === "wrong-caller") {
      args.deletedEventId = "invalid";
    }
    if (failure === "invalid-retry") {
      await ctx.db.patch(rows.audit, { resolvedAt: 1 });
    }
    if (failure === "retry-before-audit") {
      args.deletedQuarantineCreatedAt = eventAt + 2;
      await ctx.db.patch(rows.audit, {
        createdAt: eventAt + 2,
        resolvedAt: eventAt + 1,
      });
    }
  });
  const before = await t.run((ctx) => ctx.db.get(rows.audit));
  await expect(t.mutation(resolve, args)).rejects.toThrow();
  expect(await t.run((ctx) => ctx.db.get(rows.audit))).toEqual(before);
});
test("strict retry revalidates current tombstone authority", async () => {
  const { t, rows, args } = await setup();
  await t.mutation(resolve, args);
  await t.run((ctx) => ctx.db.patch(rows.profile, { deletedAt: undefined }));
  await expect(t.mutation(resolve, args)).rejects.toThrow();
});
test.each([
  "users",
  "workosProfiles",
  "migrationQuarantine",
  "workosEvents",
] as const)("refuses uncertain %s census at the scan cap", async (table) => {
  const { t, rows, args } = await setup();
  await t.run(async (ctx) => {
    for (let index = 0; index < 1000; index++) {
      if (table === "users") {
        await ctx.db.insert("users", {
          teakUserId: `other-${index}`,
          email: `${index}@example.com`,
          emailVerified: true,
        });
      }
      if (table === "workosProfiles") {
        await ctx.db.insert("workosProfiles", {
          workosUserId: `user_other_${index}`,
          revision: 1,
          source: "event",
        });
      }
      if (table === "migrationQuarantine") {
        await ctx.db.insert("migrationQuarantine", {
          workosUserId: `user_other_${index}`,
          email: `${index}@example.com`,
          reason: "workos_user_deleted",
          source: "webhook",
          createdAt: 1,
        });
      }
      if (table === "workosEvents") {
        await ctx.db.insert("workosEvents", {
          workosUserId: `user_other_${index}`,
          eventId: `other-${index}`,
          type: "user.created",
          createdAt: 1,
        });
      }
    }
  });
  await expect(t.mutation(resolve, args)).rejects.toThrow();
  expect(
    (await t.run((ctx) => ctx.db.get(rows.audit)))?.resolvedAt
  ).toBeUndefined();
});

test("accepts an authentic terminal proxy profile when present", async () => {
  const { t, rows, args } = await setup();
  await t.run((ctx) =>
    ctx.db.patch(rows.profile, {
      profile: {
        email,
        externalId: fixture.marker,
        emailVerified: true,
        firstName: null,
        lastName: null,
        profilePictureUrl: null,
      },
    })
  );
  await expect(t.mutation(resolve, args)).resolves.toMatchObject({
    alreadyResolved: false,
  });
});
test.each(["audit", "event", "profile"] as const)(
  "refuses missing %s proof",
  async (row) => {
    const { t, rows, args } = await setup();
    await t.run((ctx) => ctx.db.delete(rows[row]));
    await expect(t.mutation(resolve, args)).rejects.toThrow();
    if (row !== "audit") {
      expect(
        (await t.run((ctx) => ctx.db.get(rows.audit)))?.resolvedAt
      ).toBeUndefined();
    }
  }
);
test.each([
  "environmentId",
  "clientId",
  "issuer",
  "credentialFingerprint",
] as const)("refuses changed authenticated audit %s target", async (pin) => {
  const { t, rows, args } = await setup();
  await t.run(async (ctx) => {
    const row = (await ctx.db.get(rows.audit))!;
    await ctx.db.patch(rows.audit, {
      workosDeletionTarget: { ...row.workosDeletionTarget!, [pin]: "wrong" },
    });
  });
  await expect(t.mutation(resolve, args)).rejects.toThrow();
  expect(
    (await t.run((ctx) => ctx.db.get(rows.audit)))?.resolvedAt
  ).toBeUndefined();
});
test.each(["marker", "email"])(
  "refuses another provider's %s conflict claim",
  async (claim) => {
    const { t, rows, args } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("migrationQuarantine", {
        workosUserId: "user_other",
        ...(claim === "marker" ? { teakUserId: fixture.marker } : {}),
        email: claim === "email" ? email.toUpperCase() : "other@example.com",
        source: "webhook",
        reason: "verification_conflict",
        createdAt: 1,
      })
    );
    await expect(t.mutation(resolve, args)).rejects.toThrow();
    expect(
      (await t.run((ctx) => ctx.db.get(rows.audit)))?.resolvedAt
    ).toBeUndefined();
  }
);
test.each(["marker", "provider-marker", "email"])(
  "refuses another provider's %s event claim",
  async (claim) => {
    const { t, rows, args } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("workosEvents", {
        workosUserId: "user_other",
        eventId: "event_01M43GS9THTK7FTPPGWJNDRRTZ",
        type: "user.updated",
        createdAt: eventAt - 1,
        ...(claim === "marker" ? { externalId: fixture.marker } : {}),
        ...(claim === "provider-marker"
          ? { externalId: fixture.workosUserId }
          : {}),
        ...(claim === "email" ? { email: ` ${email.toUpperCase()} ` } : {}),
      })
    );
    const before = await t.run((ctx) => ctx.db.get(rows.audit));
    await expect(t.mutation(resolve, args)).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.get(rows.audit))).toEqual(before);
  }
);
test("allows an unrelated historical event without optional identity fields", async () => {
  const { t, rows, args } = await setup();
  const unrelated = await t.run((ctx) =>
    ctx.db.insert("workosEvents", {
      workosUserId: "user_other",
      eventId: "event_01M43GS9THTK7FTPPGWJNDRRTZ",
      type: "user.updated",
      createdAt: eventAt - 1,
    })
  );
  const before = await t.run((ctx) => ctx.db.get(unrelated));
  const result = await t.mutation(resolve, args);
  expect(result.alreadyResolved).toBe(false);
  expect((await t.run((ctx) => ctx.db.get(rows.audit)))?.resolvedAt).toBe(
    result.resolvedAt
  );
  expect(await t.run((ctx) => ctx.db.get(unrelated))).toEqual(before);
});
test.each(["user", "account"] as const)(
  "refuses incomplete legacy %s census",
  async (model) => {
    const { t, rows, args } = await setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < 1001; index++) {
        if (model === "user") {
          await ctx.runMutation(components.betterAuth.adapter.create, {
            input: {
              model,
              data: {
                name: "Other",
                email: `${index}@example.com`,
                emailVerified: true,
                createdAt: 1,
                updatedAt: 1,
              },
            },
          });
        }
        if (model === "account") {
          await ctx.runMutation(components.betterAuth.adapter.create, {
            input: {
              model,
              data: {
                accountId: `${index}`,
                providerId: "credential",
                userId: `other-${index}`,
                createdAt: 1,
                updatedAt: 1,
              },
            },
          });
        }
      }
    });
    await expect(t.mutation(resolve, args)).rejects.toThrow();
    expect(
      (await t.run((ctx) => ctx.db.get(rows.audit)))?.resolvedAt
    ).toBeUndefined();
  }
);
