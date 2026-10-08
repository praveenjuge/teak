/// <reference types="vite/client" />

import workosTest from "@convex-dev/workos-authkit/test";
import type { FunctionReturnType } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  seedComponentUser,
  updateComponentUser,
} from "./__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const setup = () => {
  const t = convexTest(schema, modules);
  workosTest.register(t);
  return t;
};
type Backend = ReturnType<typeof setup>;
const principal = {
  workosUserId: "user_PROVIDER",
  externalId: "legacy-owner",
  consentId: "app_consent_CONSENT",
  clientId: "client_CLIENT",
};
const seed = async (
  t: Backend,
  fields: Partial<Doc<"users">> = {},
  profile: Partial<Parameters<typeof seedComponentUser>[1]> | null = {}
) => {
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "legacy-owner",
      workosUserId: "user_PROVIDER",
      email: "legacy@example.test",
      emailVerified: true,
      ...fields,
    })
  );
  const user = await t.run((ctx) => ctx.db.get("users", owner));
  if (profile !== null && user?.workosUserId) {
    await seedComponentUser(t, {
      id: user.workosUserId,
      email: "provider@example.test",
      externalId: user.teakUserId,
      ...profile,
    });
  }
  return owner;
};

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

const sessionClient = (t: Backend) =>
  t.withIdentity({
    issuer: "https://api.workos.com/user_management/client_SESSION",
    subject: principal.workosUserId,
    sid: "session_SIGNEDIN",
    email_verified: true,
    external_id: "legacy-owner",
  });

// Public failure modes: wrong provider/owner, unverified or deleting identity,
// foreign/duplicate/malformed grants, empty revoked pages, sibling revocation,
// retry timestamps and refreshed credentials resurrecting a disconnected grant.
describe("signed-in Connect management", () => {
  beforeEach(() => {
    vi.stubEnv("WORKOS_CLIENT_ID", "client_SESSION");
    vi.stubEnv("WORKOS_API_KEY", "non-secret-disconnect-test-fixture");
    vi.stubEnv("WORKOS_ENVIRONMENT_ID", "environment_TEST");
    vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", "https://consent-tests.authkit.app");
    vi.stubGlobal("fetch", (_url: unknown, options?: RequestInit) =>
      Promise.resolve(
        options?.method === "DELETE"
          ? new Response(null, { status: 204 })
          : Response.json({
              data: [
                {
                  application: {
                    id: "connect_app_TEST",
                    client_id: principal.clientId,
                  },
                },
              ],
              list_metadata: {},
            })
      )
    );
    for (const surface of ["CLI", "RAYCAST", "CHROME", "FIREFOX", "SAFARI"]) {
      vi.stubEnv(`WORKOS_CONNECT_${surface}_CLIENT_ID`, `client_${surface}`);
    }
  });
  afterEach(() => vi.unstubAllEnvs());

  test("paginates through an empty revoked page without exposing another owner", async () => {
    const t = setup();
    await seed(t);
    await authorize(t, { clientId: "client_CLI" });
    await t.run(async (ctx) => {
      await ctx.db.insert("workosConsents", {
        workosUserId: principal.workosUserId,
        clientId: principal.clientId,
        userId: "legacy-owner",
        consentId: "app_consent_REVOKED",
        firstSeenAt: Date.now() + 10,
        lastSeenAt: Date.now(),
        revokedAt: Date.now(),
      });
      await ctx.db.insert("workosConsents", {
        workosUserId: principal.workosUserId,
        clientId: principal.clientId,
        userId: "foreign-owner",
        consentId: "app_consent_FOREIGN",
        firstSeenAt: Date.now() + 20,
        lastSeenAt: Date.now(),
      });
    });
    const client = sessionClient(t);
    const first = await client.query(api.workosConsents.listConnections, {
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(first.page).toEqual([]);
    expect(first.isDone).toBe(false);
    const second = await client.query(api.workosConsents.listConnections, {
      paginationOpts: { numItems: 1, cursor: first.continueCursor },
    });
    expect(second.isDone).toBe(true);
    expect(second.page).toEqual([
      expect.objectContaining({
        consentId: principal.consentId,
        name: "Teak CLI",
        clientId: "client_CLI",
      }),
    ]);
    expect(second.page[0]).not.toHaveProperty("expiresAt");
    await expect(
      client.query(api.workosConsents.listConnections, {
        paginationOpts: { numItems: 101, cursor: null },
      })
    ).rejects.toThrow("Invalid page size");
  });

  test("disconnects the application while preserving unrelated clients", async () => {
    const t = setup();
    await seed(t);
    await authorize(t);
    const sibling = { consentId: "app_consent_SIBLING" };
    const other = { consentId: "app_consent_OTHER", clientId: "client_OTHER" };
    await authorize(t, other);
    await authorize(t, sibling);
    const client = sessionClient(t);
    expect(
      await client.action(api.workosConsents.disconnectConnection, {
        consentId: principal.consentId,
      })
    ).toBeNull();
    const beforeRetry = await records(t);
    await client.action(api.workosConsents.disconnectConnection, {
      consentId: principal.consentId,
    });
    expect(await records(t)).toEqual(beforeRetry);
    expect(await authorize(t)).toEqual({
      status: "denied",
      reason: "application_disconnected",
    });
    expect(await authorize(t, sibling)).toEqual({
      status: "denied",
      reason: "application_disconnected",
    });
    expect(await authorize(t, other)).toEqual({
      status: "ok",
      teakUserId: "legacy-owner",
    });
  });

  test.each(["foreign", "wrong-provider-owner", "duplicate", "malformed"])(
    "%s target cannot revoke a grant",
    async (failure) => {
      const t = setup();
      await seed(t);
      await authorize(t);
      await t.run(async (ctx) => {
        const row = (await ctx.db.query("workosConsents").take(1))[0];
        if (failure === "foreign") {
          await ctx.db.patch(row._id, { userId: "foreign-owner" });
        } else if (failure === "wrong-provider-owner") {
          await ctx.db.patch(row._id, { workosUserId: "user_FOREIGN" });
        } else if (failure === "duplicate") {
          await ctx.db.insert("workosConsents", {
            consentId: row.consentId,
            userId: row.userId,
            workosUserId: row.workosUserId,
            clientId: row.clientId,
            firstSeenAt: row.firstSeenAt,
            lastSeenAt: row.lastSeenAt,
          });
        }
      });
      const before = await records(t);
      await expect(
        sessionClient(t).action(api.workosConsents.disconnectConnection, {
          consentId:
            failure === "malformed" ? "session_DEVICE" : principal.consentId,
        })
      ).rejects.toThrow();
      expect(await records(t)).toEqual(before);
    }
  );

  test("equal connection timestamps paginate exactly once per grant", async () => {
    const t = setup();
    await seed(t);
    await t.run(async (ctx) => {
      for (const suffix of ["FIRST", "SECOND", "THIRD"]) {
        await ctx.db.insert("workosConsents", {
          consentId: `app_consent_${suffix}`,
          userId: "legacy-owner",
          workosUserId: principal.workosUserId,
          clientId: principal.clientId,
          firstSeenAt: 100,
          lastSeenAt: 100,
        });
      }
    });
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page++) {
      const result: FunctionReturnType<
        typeof api.workosConsents.listConnections
      > = await sessionClient(t).query(api.workosConsents.listConnections, {
        paginationOpts: { numItems: 1, cursor },
      });
      for (const row of result.page) {
        ids.push(row.consentId);
      }
      expect(result.isDone).toBe(page === 2);
      cursor = result.continueCursor;
    }
    expect(new Set(ids)).toEqual(
      new Set(["app_consent_FIRST", "app_consent_SECOND", "app_consent_THIRD"])
    );
  });

  test("concurrent usage cannot resurrect a disconnected consent", async () => {
    const t = setup();
    await seed(t);
    await authorize(t);
    const [disconnect] = await Promise.all([
      sessionClient(t).action(api.workosConsents.disconnectConnection, {
        consentId: principal.consentId,
      }),
      authorize(t),
    ]);
    expect(disconnect).toBeNull();
    expect(await authorize(t)).toEqual({
      status: "denied",
      reason: "application_disconnected",
    });
    const rows = await records(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).toEqual(expect.any(Number));
  });

  test.each(["anonymous", "unverified", "deleted", "deleting"])(
    "%s cannot list or disconnect connections",
    async (failure) => {
      const t = setup();
      await seed(t, failure === "deleted" ? { deletedAt: Date.now() } : {});
      await authorize(t);
      if (failure === "deleting") {
        await t.run((ctx) =>
          ctx.db.insert("accountDeletionStates", {
            userId: "legacy-owner",
            startedAt: Date.now(),
          })
        );
      }
      const client = failure === "anonymous" ? t : sessionClient(t);
      const actor =
        failure === "unverified"
          ? t.withIdentity({
              issuer: "https://api.workos.com/user_management/client_SESSION",
              subject: principal.workosUserId,
              sid: "session_SIGNEDIN",
              email_verified: false,
            })
          : client;
      const before = await records(t);
      await expect(
        actor.query(api.workosConsents.listConnections, {
          paginationOpts: { numItems: 25, cursor: null },
        })
      ).rejects.toThrow();
      await expect(
        actor.action(api.workosConsents.disconnectConnection, {
          consentId: principal.consentId,
        })
      ).rejects.toThrow();
      expect(await records(t)).toEqual(before);
    }
  );
});

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
    await seed(
      t,
      { teakUserId: "other-owner", workosUserId: "user_OTHER" },
      { email: "other@example.test" }
    );
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

  test("a consent cannot switch provider identity while keeping its owner and client", async () => {
    const t = setup();
    const owner = await seed(t);
    await authorize(t);
    const before = await records(t);
    await t.run((ctx) => ctx.db.patch(owner, { workosUserId: "user_CHANGED" }));
    await seedComponentUser(t, {
      id: "user_CHANGED",
      email: "provider@example.test",
      externalId: principal.externalId,
    });
    expect(await authorize(t, { workosUserId: "user_CHANGED" })).toEqual({
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
    [{}, { emailVerified: false }, "verify_email"],
    [{}, null, "verify_email"],
    [{ deletedAt: 1 }, {}, "deleted_user"],
    [{ workosDeletedAt: 1 }, {}, "workos_deleted_user"],
  ] satisfies [Partial<Doc<"users">>, Parameters<typeof seed>[2], string][])(
    "mapping %j with WorkOS profile %j denies without recording",
    async (fields, profile, reason) => {
      const t = setup();
      await seed(t, fields, profile);
      expect(await authorize(t)).toEqual({ status: "denied", reason });
      expect(await records(t)).toEqual([]);
    }
  );

  test("existing consent does not bypass a changed verification or deletion state", async () => {
    const t = setup();
    await seed(t);
    await authorize(t);
    const before = await records(t);
    await updateComponentUser(t, principal.workosUserId, {
      emailVerified: false,
    });
    expect(await authorize(t)).toEqual({
      status: "denied",
      reason: "verify_email",
    });
    await updateComponentUser(t, principal.workosUserId, {
      emailVerified: true,
    });
    await t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        userId: "legacy-owner",
        startedAt: Date.now(),
      })
    );
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
