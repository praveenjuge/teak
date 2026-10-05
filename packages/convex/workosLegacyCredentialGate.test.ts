/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { components, internal } from "./_generated/api";
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
const barrier = (t: ReturnType<typeof setup>) =>
  t.mutation(internal.migration.workosImportLease.establishQuiescence, {
    ...pins,
    holder: crypto.randomUUID(),
    runId: "b".repeat(64),
  });
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
    const held = await barrier(t);
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
    await t.mutation(internal.migration.workosImportLease.releaseQuiescence, {
      ...pins,
      ...held,
    });
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
  await barrier(t);
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
  await barrier(t);
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
