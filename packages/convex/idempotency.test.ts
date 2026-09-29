/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const TTL_MS = 60_000;
const request = {
  keyHash: "key-hash-1",
  method: "POST",
  path: "/v1/cards",
  requestHash: "body-hash-1",
  ttlMs: TTL_MS,
  userId: "idempotency-user",
};

const begin = (t: ReturnType<typeof convexTest>, overrides = {}) =>
  t.mutation(internal.idempotency.beginIdempotencyRequestForUser, {
    ...request,
    ...overrides,
  });

const complete = (t: ReturnType<typeof convexTest>, overrides = {}) =>
  t.mutation(internal.idempotency.completeIdempotencyRequestForUser, {
    keyHash: request.keyHash,
    requestHash: request.requestHash,
    responseBody: { cardId: "card_1", status: "created" },
    responseStatus: 201,
    ttlMs: TTL_MS,
    userId: request.userId,
    ...overrides,
  });

describe("idempotency keys", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("a retry after completion replays the stored response", async () => {
    const t = convexTest(schema, modules);

    expect((await begin(t)).status).toBe("started");
    await complete(t);
    const retry = await begin(t);

    expect(retry.status).toBe("replay");
    expect(retry.record.responseStatus).toBe(201);
    expect(retry.record.responseBody).toEqual({
      cardId: "card_1",
      status: "created",
    });
  });

  test("a concurrent retry sees the request as in progress", async () => {
    const t = convexTest(schema, modules);

    await begin(t);

    expect((await begin(t)).status).toBe("in_progress");
  });

  test.each([
    ["a different body", { requestHash: "body-hash-2" }],
    ["a different path", { path: "/v1/cards/bulk" }],
    ["a different method", { method: "PATCH" }],
  ])("reusing a key with %s is a conflict", async (_label, overrides) => {
    const t = convexTest(schema, modules);

    await begin(t);
    await complete(t);

    expect((await begin(t, overrides)).status).toBe("conflict");
  });

  test("keys are scoped per user", async () => {
    const t = convexTest(schema, modules);

    await begin(t);
    await complete(t);

    expect((await begin(t, { userId: "someone-else" })).status).toBe("started");
  });

  test("an expired key starts a fresh request instead of replaying", async () => {
    const t = convexTest(schema, modules);

    await begin(t);
    await complete(t);
    vi.advanceTimersByTime(TTL_MS + 1);
    const again = await begin(t, { requestHash: "body-hash-2" });

    expect(again.status).toBe("started");
    expect(again.record.state).toBe("pending");
    expect(again.record.requestHash).toBe("body-hash-2");
    const rows = await t.run((ctx) =>
      ctx.db.query("apiIdempotencyKeys").collect()
    );
    expect(rows).toHaveLength(1);
  });

  test("releasing a pending request lets the client retry from scratch", async () => {
    const t = convexTest(schema, modules);

    await begin(t);
    await t.mutation(internal.idempotency.releaseIdempotencyRequestForUser, {
      keyHash: request.keyHash,
      requestHash: request.requestHash,
      userId: request.userId,
    });

    expect((await begin(t)).status).toBe("started");
  });

  test("releasing never discards a completed response", async () => {
    const t = convexTest(schema, modules);

    await begin(t);
    await complete(t);
    await t.mutation(internal.idempotency.releaseIdempotencyRequestForUser, {
      keyHash: request.keyHash,
      requestHash: request.requestHash,
      userId: request.userId,
    });

    expect((await begin(t)).status).toBe("replay");
  });

  test("completing a request that was never reserved fails", async () => {
    const t = convexTest(schema, modules);

    await expect(complete(t)).rejects.toThrow(
      "Idempotency reservation not found"
    );
  });
});
