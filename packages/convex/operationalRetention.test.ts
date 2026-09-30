/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import {
  AUTH_CODE_RETENTION_GRACE_MS,
  RETENTION_SCAN_LEASE_MS,
} from "./operationalRetention";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const now = Date.parse("2026-09-30T10:00:00Z");
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("OPERATIONAL_RETENTION_ENABLED", "true");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const seedRequests = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    for (const [keyHash, state, expiresAt] of [
      ["expired-completed", "completed", now - 1],
      ["expired-pending", "pending", now - 1],
      ["boundary-completed", "completed", now],
      ["live-completed", "completed", now + 60_000],
    ] as const) {
      await ctx.db.insert("apiIdempotencyKeys", {
        keyHash,
        state,
        expiresAt,
        userId: "customer",
        method: "POST",
        path: "/v1/cards",
        requestHash: "same-body",
        responseBody: { content: "Customer card text" },
        responseStatus: 201,
        createdAt: now - 1000,
        updatedAt: now - 1000,
      });
    }
  });

test("dry run retains every record and identifies only expired completed responses", async () => {
  const t = convexTest(schema, modules);
  await seedRequests(t);
  const before = await t.run((ctx) =>
    ctx.db.query("apiIdempotencyKeys").collect()
  );
  const report = await t.mutation(
    internal.operationalRetention.cleanupExpiredRecords,
    {
      kind: "idempotency",
    }
  );
  expect(report).toMatchObject({
    examined: 2,
    eligible: 1,
    deleted: 0,
    preservedPending: 1,
  });
  expect(
    await t.run((ctx) => ctx.db.query("apiIdempotencyKeys").collect())
  ).toEqual(before);
});

test("cleanup preserves pending and unexpired requests and live response replay", async () => {
  const t = convexTest(schema, modules);
  await seedRequests(t);
  const report = await t.mutation(
    internal.operationalRetention.cleanupExpiredRecords,
    {
      kind: "idempotency",
      dryRun: false,
    }
  );
  expect(report.deleted).toBe(1);
  const rows = await t.run((ctx) =>
    ctx.db.query("apiIdempotencyKeys").collect()
  );
  expect(rows.map((r) => r.keyHash).sort()).toEqual([
    "boundary-completed",
    "expired-pending",
    "live-completed",
  ]);
  const retry = await t.mutation(
    internal.idempotency.beginIdempotencyRequestForUser,
    {
      userId: "customer",
      keyHash: "live-completed",
      requestHash: "same-body",
      method: "POST",
      path: "/v1/cards",
    }
  );
  expect(retry.status).toBe("replay");
  expect(retry.record.responseBody).toEqual({ content: "Customer card text" });
});

test("renewing an expired request before cleanup preserves its reservation", async () => {
  const t = convexTest(schema, modules);
  await seedRequests(t);
  await t.mutation(internal.idempotency.beginIdempotencyRequestForUser, {
    userId: "customer",
    keyHash: "expired-completed",
    requestHash: "new-body",
    method: "POST",
    path: "/v1/cards",
  });
  const report = await t.mutation(
    internal.operationalRetention.cleanupExpiredRecords,
    { kind: "idempotency", dryRun: false }
  );
  expect(report.deleted).toBe(0);
  expect(
    (await t.run((ctx) => ctx.db.query("apiIdempotencyKeys").collect())).length
  ).toBe(4);
});

test("native code cleanup preserves expiry boundary and its full 24-hour grace", async () => {
  const t = convexTest(schema, modules);
  const cutoff = now - AUTH_CODE_RETENTION_GRACE_MS;
  await t.run(async (ctx) => {
    for (const [deviceId, expiresAt] of [
      ["old", cutoff - 1],
      ["boundary", cutoff],
      ["recent", now - 1],
      ["live", now + 1000],
    ] as const) {
      await ctx.db.insert("nativeAuthCodes", {
        deviceId,
        expiresAt,
        sessionId: "live-session",
        userId: "customer",
        codeChallenge: "challenge",
        state: "state",
        surface: "desktop",
        createdAt: now - 1000,
      });
    }
  });
  const report = await t.mutation(
    internal.operationalRetention.cleanupExpiredRecords,
    { kind: "nativeAuthCodes", dryRun: false }
  );
  expect(report.deleted).toBe(1);
  expect(
    (await t.run((ctx) => ctx.db.query("nativeAuthCodes").collect()))
      .map((r) => r.deviceId)
      .sort()
  ).toEqual(["boundary", "live", "recent"]);
});

test("activation and cutoff guards reject unsafe cleanup", async () => {
  const t = convexTest(schema, modules);
  await seedRequests(t);
  vi.stubEnv("OPERATIONAL_RETENTION_ENABLED", "false");
  await expect(
    t.mutation(internal.operationalRetention.cleanupExpiredRecords, {
      kind: "idempotency",
      dryRun: false,
    })
  ).rejects.toThrow("not enabled");
  await expect(
    t.mutation(internal.operationalRetention.cleanupExpiredRecords, {
      kind: "nativeAuthCodes",
      cutoff: now,
    })
  ).rejects.toThrow("unexpired");
  expect(
    (await t.run((ctx) => ctx.db.query("apiIdempotencyKeys").collect())).length
  ).toBe(4);
});

test("a pending first page cannot block expired completed records on later pages", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 102; i++) {
      await ctx.db.insert("apiIdempotencyKeys", {
        keyHash: `request-${i}`,
        userId: "customer",
        method: "POST",
        path: "/v1/cards",
        requestHash: "body",
        state: i < 100 ? "pending" : "completed",
        responseStatus: 201,
        responseBody: null,
        expiresAt: now - 1000 + i,
        createdAt: now - 2000,
        updatedAt: now - 2000,
      });
    }
  });
  const first = await t.mutation(
    internal.operationalRetention.cleanupExpiredRecords,
    { kind: "idempotency", dryRun: false, remainingBatches: 1 }
  );
  expect(first).toMatchObject({
    preservedPending: 100,
    deleted: 0,
    isDone: false,
    continuationScheduled: true,
  });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(
    (await t.run((ctx) => ctx.db.query("apiIdempotencyKeys").collect())).length
  ).toBe(100);
});

test("scheduled bursts carry their cursor past more than 2000 pending reservations", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 2002; i++) {
      await ctx.db.insert("apiIdempotencyKeys", {
        keyHash: `pending-budget-${i}`,
        userId: "customer",
        method: "POST",
        path: "/v1/cards",
        requestHash: "body",
        state: i < 2001 ? "pending" : "completed",
        responseStatus: 201,
        responseBody: null,
        expiresAt: now - 5000 + i,
        createdAt: now - 6000,
        updatedAt: now - 6000,
      });
    }
  });
  await t.mutation(internal.operationalRetention.cleanupExpiredRecords, {
    kind: "idempotency",
    dryRun: false,
  });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const rows = await t.run((ctx) =>
    ctx.db.query("apiIdempotencyKeys").collect()
  );
  expect(rows).toHaveLength(2001);
  expect(rows.every((row) => row.state === "pending")).toBe(true);
});

test("operational cleanup leaves complete customer cards unchanged", async () => {
  const t = convexTest(schema, modules);
  await seedRequests(t);
  await t.run((ctx) =>
    ctx.db.insert("cards", {
      userId: "customer",
      type: "text",
      content: "Original customer content",
      notes: "Private notes",
      tags: ["keep"],
      isFavorited: true,
      aiSummary: "Saved summary",
      createdAt: 10,
      updatedAt: 20,
    })
  );
  const before = await t.run((ctx) => ctx.db.query("cards").collect());
  await t.mutation(internal.operationalRetention.cleanupExpiredRecords, {
    kind: "idempotency",
    dryRun: false,
  });
  await t.mutation(internal.operationalRetention.cleanupExpiredRecords, {
    kind: "nativeAuthCodes",
    dryRun: false,
  });
  expect(await t.run((ctx) => ctx.db.query("cards").collect())).toEqual(before);
});

test("overlapping cron requests skip active scans and stale recovery fences old jobs", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 101; i++) {
      await ctx.db.insert("apiIdempotencyKeys", {
        keyHash: `overlap-${i}`,
        userId: "customer",
        method: "POST",
        path: "/v1/cards",
        requestHash: "body",
        state: i < 100 ? "pending" : "completed",
        responseStatus: 201,
        responseBody: null,
        expiresAt: now - 1000 + i,
        createdAt: now - 2000,
        updatedAt: now - 2000,
      });
    }
  });
  const first = await t.mutation(
    internal.operationalRetention.cleanupExpiredRecords,
    { kind: "idempotency", dryRun: false, remainingBatches: 1 }
  );
  const [state] = await t.run((ctx) =>
    ctx.db.query("operationalRetentionStates").collect()
  );
  const overlap = await t.mutation(
    internal.operationalRetention.cleanupExpiredRecords,
    { kind: "idempotency", dryRun: false }
  );
  expect(overlap).toMatchObject({
    skipped: true,
    examined: 0,
    continueCursor: first.continueCursor,
  });
  vi.setSystemTime(now + RETENTION_SCAN_LEASE_MS + 1);
  const recovered = await t.mutation(
    internal.operationalRetention.cleanupExpiredRecords,
    { kind: "idempotency", dryRun: false }
  );
  expect(recovered).toMatchObject({
    deleted: 1,
    isDone: true,
    skipped: false,
    cutoff: first.cutoff,
  });
  const oldJob = await t.mutation(
    internal.operationalRetention.cleanupExpiredRecords,
    { kind: "idempotency", dryRun: false, runId: state._id }
  );
  expect(oldJob).toMatchObject({ skipped: true, examined: 0 });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(
    await t.run((ctx) => ctx.db.query("operationalRetentionStates").collect())
  ).toEqual([]);
});
