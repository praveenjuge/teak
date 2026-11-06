import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import { IDEMPOTENCY_PENDING_LEASE_MS } from "../idempotency";
import { type Backend, newBackend } from "./helpers";

const TTL_MS = 60_000;
const request = {
  keyHash: "key-hash-1",
  method: "POST",
  path: "/v1/cards",
  requestHash: "body-hash-1",
  ttlMs: TTL_MS,
  userId: "idempotency-user",
};

// The handler holding a reservation presents its lease token, as the
// public API does; the helpers default to the latest one begin handed out.
const leases = new WeakMap<object, string>();

const begin = async (t: Backend, overrides = {}) => {
  const reservation = await t.mutation(
    internal.idempotency.beginIdempotencyRequestForUser,
    { ...request, ...overrides }
  );
  if (reservation.status === "started" && reservation.record.leaseToken) {
    leases.set(t, reservation.record.leaseToken);
  }
  return reservation;
};

const complete = (t: Backend, overrides = {}) =>
  t.mutation(internal.idempotency.completeIdempotencyRequestForUser, {
    keyHash: request.keyHash,
    leaseToken: leases.get(t),
    requestHash: request.requestHash,
    responseBody: { cardId: "card_1", status: "created" },
    responseStatus: 201,
    ttlMs: TTL_MS,
    userId: request.userId,
    ...overrides,
  });

const release = (t: Backend, overrides = {}) =>
  t.mutation(internal.idempotency.releaseIdempotencyRequestForUser, {
    keyHash: request.keyHash,
    leaseToken: leases.get(t),
    requestHash: request.requestHash,
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
    const t = newBackend();

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
    const t = newBackend();

    await begin(t);

    expect((await begin(t)).status).toBe("in_progress");
  });

  test.each([
    ["a different body", { requestHash: "body-hash-2" }],
    ["a different path", { path: "/v1/cards/bulk" }],
    ["a different method", { method: "PATCH" }],
  ])("reusing a key with %s is a conflict", async (_label, overrides) => {
    const t = newBackend();

    await begin(t);
    await complete(t);

    expect((await begin(t, overrides)).status).toBe("conflict");
  });

  test("keys are scoped per user", async () => {
    const t = newBackend();

    await begin(t);
    await complete(t);

    expect((await begin(t, { userId: "someone-else" })).status).toBe("started");
  });

  test("an expired key starts a fresh request instead of replaying", async () => {
    const t = newBackend();

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

  test("a retry takes over a request whose handler died once its lease lapses", async () => {
    const t = newBackend();

    await begin(t, { ttlMs: undefined });
    vi.advanceTimersByTime(IDEMPOTENCY_PENDING_LEASE_MS - 1);
    expect((await begin(t, { ttlMs: undefined })).status).toBe("in_progress");
    vi.advanceTimersByTime(2);
    const retry = await begin(t, { ttlMs: undefined });

    expect(retry.status).toBe("started");
    await complete(t, { ttlMs: undefined });
    vi.advanceTimersByTime(IDEMPOTENCY_PENDING_LEASE_MS * 2);
    expect((await begin(t, { ttlMs: undefined })).status).toBe("replay");
  });

  test("a handler whose lease was taken over can't complete or release the new reservation", async () => {
    const t = newBackend();
    const stale = await begin(t);
    vi.advanceTimersByTime(IDEMPOTENCY_PENDING_LEASE_MS + 1);
    const current = await begin(t);
    expect(current.status).toBe("started");

    await complete(t, {
      leaseToken: stale.record.leaseToken,
      responseBody: { cardId: "stale" },
    });
    await release(t, { leaseToken: stale.record.leaseToken });
    expect((await begin(t)).status).toBe("in_progress");

    await complete(t, { leaseToken: current.record.leaseToken });
    const replay = await begin(t);
    expect(replay.status).toBe("replay");
    expect(replay.record.responseBody).toEqual({
      cardId: "card_1",
      status: "created",
    });
  });

  test("a call without the lease token can't complete or release the reservation", async () => {
    const t = newBackend();
    await begin(t);

    await complete(t, { leaseToken: undefined, responseBody: { cardId: "x" } });
    await release(t, { leaseToken: undefined });
    expect((await begin(t)).status).toBe("in_progress");
  });

  test("releasing a pending request lets the client retry from scratch", async () => {
    const t = newBackend();

    await begin(t);
    await release(t);

    expect((await begin(t)).status).toBe("started");
  });

  test("releasing never discards a completed response", async () => {
    const t = newBackend();

    await begin(t);
    await complete(t);
    await release(t);

    expect((await begin(t)).status).toBe("replay");
  });

  test("completing a request that was never reserved fails", async () => {
    const t = newBackend();

    await expect(complete(t)).rejects.toThrow(
      "Idempotency reservation not found"
    );
  });
});
