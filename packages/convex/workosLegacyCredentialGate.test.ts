/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { components } from "./_generated/api";
import { authComponent, createAuth } from "./auth";
import schema from "./schema";
import { mintDedicatedSession } from "./shared/dedicatedSessions";

const modules = import.meta.glob("./**/*.ts");
const pins = {
  environmentId: "environment_expected",
  clientId: "client_expected",
  apiKeyFingerprint:
    "0cd3cf5f74c92c94559c4397065417ee80f45c5115d28889b9872049ea5533aa",
};
beforeEach(() => {
  vi.stubEnv("AUTH_PRIMARY", "betterauth");
  vi.stubEnv("SIGNUPS_DISABLED", "true");
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", pins.environmentId);
  vi.stubEnv("WORKOS_CLIENT_ID", pins.clientId);
  vi.stubEnv("WORKOS_API_KEY", "test-workos-reconciliation-key");
});
afterEach(() => vi.unstubAllEnvs());
function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  return t;
}
// Under WorkOS the gate stops every Better Auth credential write.
const selectWorkos = () => vi.stubEnv("AUTH_PRIMARY", "workos");
const write = (
  t: ReturnType<typeof setup>,
  model: "session" | "oauthAccessToken"
) =>
  t.run(async (ctx) => {
    const adapter = authComponent.adapter(ctx)(createAuth(ctx).options);
    return await adapter.create({
      model,
      data:
        model === "session"
          ? {
              userId: "permanent",
              token: crypto.randomUUID(),
              expiresAt: new Date(Date.now() + 60_000),
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : {
              userId: "permanent",
              accessToken: crypto.randomUUID(),
              refreshToken: crypto.randomUUID(),
              createdAt: new Date(),
              updatedAt: new Date(),
            },
    });
  });
// Failure modes: legacy HTTP admitted before durable pause; token refresh/update
// after the barrier; direct native mint bypass; normal BA behavior regresses;
// released barrier or WorkOS-primary incorrectly reopening old credentials.
test.each(["session", "oauthAccessToken"] as const)(
  "%s adapter creates and refreshes before barrier, but trigger rolls back writes afterward",
  async (model) => {
    const t = setup();
    const created = await write(t, model);
    await t.run(async (ctx) => {
      const adapter = authComponent.adapter(ctx)(createAuth(ctx).options);
      await adapter.update({
        model,
        where: [{ field: "id", value: created.id }],
        update: { updatedAt: new Date() },
      });
    });
    const before = await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.adapter.findOne, {
        model,
        where: [{ field: "_id", value: created.id }],
      })
    );
    selectWorkos();
    await expect(write(t, model)).rejects.toThrow(
      "credential writes are stopped"
    );
    await expect(
      t.run(async (ctx) => {
        const adapter = authComponent.adapter(ctx)(createAuth(ctx).options);
        return await adapter.update({
          model,
          where: [{ field: "id", value: created.id }],
          update: { updatedAt: new Date("2030-01-01T00:00:00Z") },
        });
      })
    ).rejects.toThrow("credential writes are stopped");
    await expect(
      t.run(async (ctx) => {
        const adapter = authComponent.adapter(ctx)(createAuth(ctx).options);
        return await adapter.updateMany({
          model,
          where: [{ field: "id", value: created.id }],
          update: { updatedAt: new Date("2030-01-01T00:00:00Z") },
        });
      })
    ).rejects.toThrow("credential writes are stopped");
    expect(
      await t.run((ctx) =>
        ctx.runQuery(components.betterAuth.adapter.findOne, {
          model,
          where: [{ field: "_id", value: created.id }],
        })
      )
    ).toEqual(before);
    expect(
      (
        await t.run((ctx) =>
          ctx.runQuery(components.betterAuth.adapter.findMany, {
            model,
            paginationOpts: { cursor: null, numItems: 20 },
          })
        )
      ).page
    ).toHaveLength(1);
    vi.stubEnv("AUTH_PRIMARY", "betterauth");
    expect(await write(t, model)).toHaveProperty("id");
    vi.stubEnv("AUTH_PRIMARY", "workos");
    await expect(write(t, model)).rejects.toThrow(
      "credential writes are stopped"
    );
  }
);
test("direct dedicated session mint joins the same durable barrier transaction", async () => {
  const t = setup();
  expect(
    await t.run((ctx) =>
      mintDedicatedSession(ctx, { userId: "permanent", userAgent: "Teak Test" })
    )
  ).toHaveProperty("sessionToken");
  selectWorkos();
  await expect(
    t.run((ctx) =>
      mintDedicatedSession(ctx, { userId: "permanent", userAgent: "Teak Test" })
    )
  ).rejects.toThrow("credential writes are stopped");
  expect(
    (
      await t.run((ctx) =>
        ctx.runQuery(components.betterAuth.adapter.findMany, {
          model: "session",
          paginationOpts: { cursor: null, numItems: 20 },
        })
      )
    ).page
  ).toHaveLength(1);
});

test("an adapter admitted before quiescence cannot commit a credential after the barrier", async () => {
  const t = setup();
  let admitted:
    | ReturnType<ReturnType<typeof authComponent.adapter>>
    | undefined;
  await t.run((ctx) => {
    admitted = authComponent.adapter(ctx)(createAuth(ctx).options);
    return Promise.resolve(null);
  });
  const getAdmitted = () => {
    if (!admitted) {
      throw new Error("Missing admitted adapter");
    }
    return admitted;
  };
  selectWorkos();
  await expect(
    t.run(() =>
      getAdmitted().create({
        model: "session",
        data: {
          userId: "permanent",
          token: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    )
  ).rejects.toThrow("credential writes are stopped");
  await expect(
    t.run(() =>
      getAdmitted().create({
        model: "oauthAccessToken",
        data: {
          userId: "permanent",
          accessToken: crypto.randomUUID(),
          refreshToken: crypto.randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    )
  ).rejects.toThrow("credential writes are stopped");
  for (const model of ["session", "oauthAccessToken"] as const) {
    expect(
      (
        await t.run((ctx) =>
          ctx.runQuery(components.betterAuth.adapter.findMany, {
            model,
            paginationOpts: { cursor: null, numItems: 20 },
          })
        )
      ).page
    ).toHaveLength(0);
  }
});

async function seedLegacyAccount(
  t: ReturnType<typeof setup>,
  providerId = "credential"
) {
  return await t.run(async (ctx) => {
    const user = await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Profile Owner",
          email: "profile@example.com",
          emailVerified: false,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });
    if (!("_id" in user)) {
      throw new Error("Missing legacy owner");
    }
    const userId = String(user._id);
    await ctx.db.insert("users", {
      teakUserId: userId,
      email: "profile@example.com",
      emailVerified: false,
    });
    const account = await ctx.runMutation(
      components.betterAuth.adapter.create,
      {
        input: {
          model: "account",
          data: {
            accountId: userId,
            providerId,
            userId,
            ...(providerId === "credential"
              ? { password: "original-legacy-hash" }
              : {}),
            createdAt: 1,
            updatedAt: 1,
          },
        },
      }
    );
    if (!("_id" in account)) {
      throw new Error("Missing credential");
    }
    return { userId, accountId: String(account._id) };
  });
}

test("password reset admitted before pause cannot update the account or link another provider", async () => {
  const t = setup(),
    owner = await seedLegacyAccount(t);
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "false");
  let admitted:
    | ReturnType<ReturnType<typeof authComponent.adapter>>
    | undefined;
  await t.run((ctx) => {
    admitted = authComponent.adapter(ctx)(createAuth(ctx).options);
    return Promise.resolve(null);
  });
  const getAdmitted = () => {
    if (!admitted) {
      throw new Error("Missing admitted adapter");
    }
    return admitted;
  };
  await t.run(() =>
    getAdmitted().update({
      model: "account",
      where: [{ field: "id", value: owner.accountId }],
      update: { password: "latest-approved-hash" },
    })
  );
  expect(
    await t.run(() =>
      getAdmitted().create({
        model: "account",
        data: {
          accountId: "existing-google",
          providerId: "google",
          userId: owner.userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    )
  ).toHaveProperty("id");
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
  await expect(
    t.run(() =>
      getAdmitted().update({
        model: "account",
        where: [{ field: "id", value: owner.accountId }],
        update: { password: "late-reset-hash" },
      })
    )
  ).rejects.toThrow("account changes are paused");
  await expect(
    t.run(() =>
      getAdmitted().create({
        model: "account",
        data: {
          accountId: "google-account",
          providerId: "google",
          userId: owner.userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    )
  ).rejects.toThrow("account changes are paused");
  const account = await t.run((ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "account",
      where: [{ field: "_id", value: owner.accountId }],
    })
  );
  expect(account).toMatchObject({
    password: "latest-approved-hash",
    providerId: "credential",
  });
  expect(
    (
      await t.run((ctx) =>
        ctx.runQuery(components.betterAuth.adapter.findMany, {
          model: "account",
          paginationOpts: { cursor: null, numItems: 20 },
        })
      )
    ).page
  ).toHaveLength(2);
  selectWorkos();
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "false");
  await expect(
    t.run(() =>
      getAdmitted().update({
        model: "account",
        where: [{ field: "id", value: owner.accountId }],
        update: { password: "late-reset-hash" },
      })
    )
  ).rejects.toThrow("credential writes are stopped");
  vi.stubEnv("AUTH_PRIMARY", "workos");
  await expect(
    t.run(() =>
      getAdmitted().create({
        model: "account",
        data: {
          accountId: "google-account",
          providerId: "google",
          userId: owner.userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    )
  ).rejects.toThrow("credential writes are stopped");
});

test.each([
  { email: "changed@example.com" },
  { emailVerified: false },
  { emailVerified: true },
])(
  "protected profile update %j rolls back across pause while harmless login updates still mirror",
  async (update) => {
    const t = setup(),
      owner = await seedLegacyAccount(t);
    const verified = !(
      "emailVerified" in update && update.emailVerified === true
    );
    vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "false");
    let admitted:
      | ReturnType<ReturnType<typeof authComponent.adapter>>
      | undefined;
    await t.run((ctx) => {
      admitted = authComponent.adapter(ctx)(createAuth(ctx).options);
      return Promise.resolve(null);
    });
    const getAdmitted = () => {
      if (!admitted) {
        throw new Error("Missing admitted adapter");
      }
      return admitted;
    };
    await t.run(() =>
      getAdmitted().update({
        model: "user",
        where: [{ field: "id", value: owner.userId }],
        update: { emailVerified: verified },
      })
    );
    vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
    await expect(
      t.run(() =>
        getAdmitted().update({
          model: "user",
          where: [{ field: "id", value: owner.userId }],
          update,
        })
      )
    ).rejects.toThrow("account changes are paused");
    await expect(
      t.run(() =>
        getAdmitted().updateMany({
          model: "user",
          where: [{ field: "id", value: owner.userId }],
          update,
        })
      )
    ).rejects.toThrow("account changes are paused");
    await t.run(() =>
      getAdmitted().update({
        model: "user",
        where: [{ field: "id", value: owner.userId }],
        update: { name: "Login refreshed", updatedAt: new Date() },
      })
    );
    expect(
      await t.run((ctx) =>
        ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: "user",
          where: [{ field: "_id", value: owner.userId }],
        })
      )
    ).toMatchObject({
      email: "profile@example.com",
      emailVerified: verified,
      name: "Login refreshed",
    });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("users")
          .withIndex("by_teakUserId", (q) => q.eq("teakUserId", owner.userId))
          .unique()
      )
    ).toMatchObject({ email: "profile@example.com", emailVerified: verified });
    selectWorkos();
    vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "false");
    await expect(
      t.run(() =>
        getAdmitted().update({
          model: "user",
          where: [{ field: "id", value: owner.userId }],
          update,
        })
      )
    ).rejects.toThrow("credential writes are stopped");
    // Deletion remains the canonical workflow's authority, not a blanket trigger
    // denial: its existing user-delete trigger preserves a durable tombstone.
    await t.run(() =>
      getAdmitted().delete({
        model: "user",
        where: [{ field: "id", value: owner.userId }],
      })
    );
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("users")
          .withIndex("by_teakUserId", (q) => q.eq("teakUserId", owner.userId))
          .unique()
      )
    ).toMatchObject({
      deletedAt: expect.any(Number),
      email: "",
      emailVerified: false,
    });
  }
);

test("user provisioning admitted before pause/barrier cannot create legacy owner, mirror or scheduled defaults", async () => {
  vi.useFakeTimers();
  try {
    const t = setup();
    vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "false");
    let admitted:
      | ReturnType<ReturnType<typeof authComponent.adapter>>
      | undefined;
    await t.run((ctx) => {
      admitted = authComponent.adapter(ctx)(createAuth(ctx).options);
      return Promise.resolve(null);
    });
    const getAdmitted = () => {
      if (!admitted) {
        throw new Error("Missing admitted adapter");
      }
      return admitted;
    };
    const data = (email: string) => ({
      name: "E2E Owner",
      email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const owner = await t.run(() =>
      getAdmitted().create({
        model: "user",
        data: data("e2e-normal@example.com"),
      })
    );
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("users")
          .withIndex("by_teakUserId", (q) => q.eq("teakUserId", owner.id))
          .unique()
      )
    ).toMatchObject({ email: "e2e-normal@example.com", emailVerified: true });
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(10)
    );
    expect(scheduled.length).toBeGreaterThan(0);
    vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
    await expect(
      t.run(() =>
        getAdmitted().create({
          model: "user",
          data: data("e2e-paused@example.com"),
        })
      )
    ).rejects.toThrow("account changes are paused");
    selectWorkos();
    vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "false");
    await expect(
      t.run(() =>
        getAdmitted().create({
          model: "user",
          data: data("e2e-barrier@example.com"),
        })
      )
    ).rejects.toThrow("credential writes are stopped");
    expect(
      (
        await t.run((ctx) =>
          ctx.runQuery(components.betterAuth.adapter.findMany, {
            model: "user",
            paginationOpts: { cursor: null, numItems: 20 },
          })
        )
      ).page
    ).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("users").take(20))).toHaveLength(
      1
    );
    expect(
      await t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(10))
    ).toEqual(scheduled);
  } finally {
    vi.useRealTimers();
  }
});

test.each(["google", "apple"])(
  "existing %s credential refresh works during pause while authority changes and post-barrier refresh stay denied",
  async (providerId) => {
    const t = setup(),
      owner = await seedLegacyAccount(t, providerId);
    const update = (changes: Record<string, string | Date>) =>
      t.run((ctx) =>
        authComponent
          .adapter(ctx)(createAuth(ctx).options)
          .update({
            model: "account",
            where: [{ field: "id", value: owner.accountId }],
            update: changes,
          })
      );
    expect(
      await update({
        accessToken: "rotated-access",
        refreshToken: "rotated-refresh",
        idToken: "rotated-id",
        scope: "openid email",
        accessTokenExpiresAt: new Date(Date.now() + 60_000),
        refreshTokenExpiresAt: new Date(Date.now() + 120_000),
        updatedAt: new Date(),
      })
    ).toMatchObject({
      accessToken: "rotated-access",
      refreshToken: "rotated-refresh",
      idToken: "rotated-id",
    });
    const protectedChanges: Record<string, string>[] = [
      { password: "changed-password" },
      { providerId: "other-provider" },
      { accountId: "other-provider-account" },
      { userId: "other-owner" },
    ];
    for (const changes of protectedChanges) {
      await expect(update(changes)).rejects.toThrow(
        "account changes are paused"
      );
    }
    expect(
      await t.run((ctx) =>
        ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: "account",
          where: [{ field: "_id", value: owner.accountId }],
        })
      )
    ).toMatchObject({
      providerId,
      accountId: owner.userId,
      userId: owner.userId,
      accessToken: "rotated-access",
      refreshToken: "rotated-refresh",
    });
    selectWorkos();
    await expect(
      update({ accessToken: "post-barrier-access" })
    ).rejects.toThrow("credential writes are stopped");
    expect(
      await t.run((ctx) =>
        ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: "account",
          where: [{ field: "_id", value: owner.accountId }],
        })
      )
    ).toMatchObject({ accessToken: "rotated-access" });
  }
);
