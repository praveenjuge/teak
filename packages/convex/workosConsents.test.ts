/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const setup = () => convexTest(schema, modules);
type Backend = ReturnType<typeof setup>;
const principal = {
  workosUserId: "user_PROVIDER",
  externalId: "legacy-owner",
  consentId: "app_consent_CONSENT",
  clientId: "client_CLIENT",
};
const seed = (t: Backend, fields: Partial<Doc<"users">> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "legacy-owner",
      workosUserId: principal.workosUserId,
      email: "legacy@example.test",
      emailVerified: true,
      workosEmail: "provider@example.test",
      workosEmailVerified: true,
      ...fields,
    })
  );
const authorize = (t: Backend, fields: Partial<typeof principal> = {}) =>
  t.mutation(internal.workosConsents.authorizeConnectConsent, {
    ...principal,
    ...fields,
  });
const revoke = (t: Backend, teakUserId = "legacy-owner") =>
  t.mutation(internal.workosConsents.revokeConnectConsent, {
    consentId: principal.consentId,
    teakUserId,
  });
const records = (t: Backend) =>
  t.run((ctx) => ctx.db.query("workosConsents").take(10));

afterEach(() => vi.useRealTimers());

// Failures: consent IDs become vault owners; duplicate credentials cross owners;
// refreshed tokens undo revocation; another owner revokes an app; missing,
// unverified, tombstoned or deleting mappings gain access; every request writes.
describe("durable Connect consent authorization", () => {
  test("records the canonical permanent owner and deduplicates repeated use", async () => {
    const t = setup();
    await seed(t);
    expect(await authorize(t)).toEqual({
      status: "ok",
      teakUserId: "legacy-owner",
    });
    const before = await records(t);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      userId: "legacy-owner",
      workosUserId: principal.workosUserId,
      clientId: principal.clientId,
      consentId: principal.consentId,
    });
    expect(await authorize(t)).toEqual({
      status: "ok",
      teakUserId: "legacy-owner",
    });
    expect(await records(t)).toEqual(before);
  });

  test("revocation survives old and refreshed credentials without clearing its timestamp", async () => {
    const t = setup();
    await seed(t);
    await authorize(t);
    expect(await revoke(t)).toBe(true);
    const revoked = await records(t);
    expect(revoked[0].revokedAt).toEqual(expect.any(Number));
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await authorize(t)).toEqual({
        status: "denied",
        reason: "revoked_consent",
      });
    }
    expect(await revoke(t)).toBe(true);
    expect(await records(t)).toEqual(revoked);
  });

  test("another owner cannot revoke or take over a consent", async () => {
    const t = setup();
    await seed(t);
    await authorize(t);
    const before = await records(t);
    expect(await revoke(t, "other-owner")).toBe(false);
    await seed(t, {
      teakUserId: "other-owner",
      workosUserId: "user_OTHER",
      workosEmail: "other@example.test",
    });
    expect(
      await authorize(t, {
        workosUserId: "user_OTHER",
        externalId: "other-owner",
      })
    ).toEqual({ status: "denied", reason: "consent_binding_conflict" });
    expect(await records(t)).toEqual(before);
  });

  test("a consent cannot switch OAuth clients", async () => {
    const t = setup();
    await seed(t);
    await authorize(t);
    const before = await records(t);
    expect(await authorize(t, { clientId: "client_OTHER" })).toEqual({
      status: "denied",
      reason: "consent_binding_conflict",
    });
    expect(await records(t)).toEqual(before);
  });

  test("different consents remain independently revocable", async () => {
    const t = setup();
    await seed(t);
    await authorize(t);
    await authorize(t, { consentId: "app_consent_SECOND" });
    await revoke(t);
    expect(await authorize(t)).toEqual({
      status: "denied",
      reason: "revoked_consent",
    });
    expect(await authorize(t, { consentId: "app_consent_SECOND" })).toEqual({
      status: "ok",
      teakUserId: "legacy-owner",
    });
  });

  test("missing mapping and unknown revocation create nothing", async () => {
    const t = setup();
    expect(await authorize(t)).toEqual({
      status: "denied",
      reason: "missing_mapping",
    });
    expect(await revoke(t)).toBe(false);
    expect(await records(t)).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("users").take(10))).toEqual([]);
  });

  test.each([
    [{ workosEmailVerified: false }, "verify_email"],
    [{ workosEmailVerified: undefined }, "verify_email"],
    [{ deletedAt: 1 }, "deleted_user"],
    [{ workosDeletedAt: 1 }, "workos_deleted_user"],
  ] satisfies [Partial<Doc<"users">>, string][])(
    "mapping state %j denies without recording",
    async (fields, reason) => {
      const t = setup();
      await seed(t, fields);
      expect(await authorize(t)).toEqual({ status: "denied", reason });
      expect(await records(t)).toEqual([]);
    }
  );

  test("existing consent does not bypass a changed verification or deletion state", async () => {
    const t = setup();
    const owner = await seed(t);
    await authorize(t);
    const before = await records(t);
    await t.run((ctx) => ctx.db.patch(owner, { workosEmailVerified: false }));
    expect(await authorize(t)).toEqual({
      status: "denied",
      reason: "verify_email",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(owner, { workosEmailVerified: true });
      await ctx.db.insert("accountDeletionStates", {
        userId: "legacy-owner",
        startedAt: Date.now(),
      });
    });
    expect(await authorize(t)).toEqual({
      status: "denied",
      reason: "deleting_user",
    });
    expect(await records(t)).toEqual(before);
  });

  test("provider deletion ledger denies an otherwise unchanged mapping", async () => {
    const t = setup();
    await seed(t);
    await authorize(t);
    const before = await records(t);
    await t.run((ctx) =>
      ctx.db.insert("workosEvents", {
        eventId: "event_DELETE",
        workosUserId: principal.workosUserId,
        type: "user.deleted",
        createdAt: 1,
      })
    );
    expect(await authorize(t)).toEqual({
      status: "denied",
      reason: "workos_deleted_user",
    });
    expect(await records(t)).toEqual(before);
  });

  test("external ID mismatch denies without recording", async () => {
    const t = setup();
    await seed(t);
    expect(await authorize(t, { externalId: "other-owner" })).toEqual({
      status: "denied",
      reason: "external_id_mismatch",
    });
    expect(await records(t)).toEqual([]);
  });

  test("duplicate consent records deny authorization and owner revocation", async () => {
    const t = setup();
    await seed(t);
    await authorize(t);
    const [record] = await records(t);
    await t.run((ctx) =>
      ctx.db.insert("workosConsents", {
        consentId: record.consentId,
        userId: record.userId,
        workosUserId: record.workosUserId,
        clientId: record.clientId,
        firstSeenAt: record.firstSeenAt,
        lastSeenAt: record.lastSeenAt,
      })
    );
    const before = await records(t);
    expect(await authorize(t)).toEqual({
      status: "denied",
      reason: "duplicate_consent",
    });
    expect(await revoke(t)).toBe(false);
    expect(await records(t)).toEqual(before);
  });

  test("updates last seen at most once per five minutes while checking revocation every time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T14:00:00Z"));
    const t = setup();
    await seed(t);
    await authorize(t);
    const [first] = await records(t);
    vi.setSystemTime(first.lastSeenAt + 299_999);
    await authorize(t);
    expect(await records(t)).toEqual([first]);
    vi.setSystemTime(first.lastSeenAt + 300_000);
    await authorize(t);
    const [updated] = await records(t);
    expect(updated.firstSeenAt).toBe(first.firstSeenAt);
    expect(updated.lastSeenAt).toBe(first.lastSeenAt + 300_000);
    await revoke(t);
    expect(await authorize(t)).toEqual({
      status: "denied",
      reason: "revoked_consent",
    });
  });

  test.each([
    { consentId: "session_SESSION" },
    { workosUserId: "client_MACHINE" },
    { clientId: "" },
  ])("malformed internal principal %j denies", async (fields) => {
    const t = setup();
    await seed(t);
    expect(await authorize(t, fields)).toEqual({
      status: "denied",
      reason: "invalid_credential",
    });
    expect(await records(t)).toEqual([]);
  });
});
