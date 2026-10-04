/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const setup = () => convexTest(schema, modules);
type Backend = ReturnType<typeof setup>;
const input = {
  workosUserId: "user_provider",
  verification: { kind: "connect" as const },
};
const seed = (t: Backend, fields: Partial<Doc<"users">> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "permanent-owner",
      workosUserId: "user_provider",
      email: "legacy@example.com",
      emailVerified: true,
      workosEmail: "provider@example.com",
      workosEmailVerified: true,
      ...fields,
    })
  );
const resolve = (t: Backend) =>
  t.query(internal.workosIdentity.resolveWorkosOwner, input);
const snapshot = (t: Backend) =>
  t.run(async (ctx) => ({
    users: await ctx.db.query("users").take(10),
    events: await ctx.db.query("workosEvents").take(10),
    quarantine: await ctx.db.query("migrationQuarantine").take(10),
  }));

// Failures: provider subjects become vault owners; legacy verification promotes
// Connect access; missing session evidence passes; duplicate owner/provider rows
// resolve; global deletion does not cover an unpatched third row; external IDs
// drift; active deletion is ignored; a resolver writes or creates mappings.
describe("read-only canonical WorkOS owner resolution", () => {
  test("returns the permanent owner without writes", async () => {
    const t = setup();
    await seed(t);
    const before = await snapshot(t);
    expect(await resolve(t)).toEqual({
      status: "ok",
      teakUserId: "permanent-owner",
    });
    expect(await snapshot(t)).toEqual(before);
  });

  test("missing links deny without creating or quarantining", async () => {
    const t = setup();
    const before = await snapshot(t);
    expect(await resolve(t)).toEqual({
      status: "denied",
      reason: "missing_mapping",
    });
    expect(await snapshot(t)).toEqual(before);
  });

  test.each([false, undefined])(
    "Connect ignores legacy verification when provider evidence is %s",
    async (workosEmailVerified) => {
      const t = setup();
      await seed(t, { emailVerified: true, workosEmailVerified });
      expect(await resolve(t)).toEqual({
        status: "denied",
        reason: "verify_email",
      });
    }
  );

  test("Connect uses provider evidence even if the legacy mirror is unverified", async () => {
    const t = setup();
    await seed(t, { emailVerified: false });
    expect(await resolve(t)).toEqual({
      status: "ok",
      teakUserId: "permanent-owner",
    });
  });

  test.each([true, false])(
    "session verification claim %s is authoritative",
    async (emailVerified) => {
      const t = setup();
      await seed(t, { workosEmailVerified: !emailVerified });
      const result = await t.query(internal.workosIdentity.resolveWorkosOwner, {
        ...input,
        verification: { kind: "session", emailVerified },
      });
      expect(result).toEqual(
        emailVerified
          ? { status: "ok", teakUserId: "permanent-owner" }
          : { status: "denied", reason: "verify_email" }
      );
    }
  );

  test.each([undefined, null, "permanent-owner", "different-owner"])(
    "external ID %s is checked without fallback",
    async (externalId) => {
      const t = setup();
      await seed(t);
      const before = await snapshot(t);
      expect(
        await t.query(internal.workosIdentity.resolveWorkosOwner, {
          ...input,
          ...(externalId === undefined ? {} : { externalId }),
        })
      ).toEqual(
        externalId === "different-owner"
          ? { status: "denied", reason: "external_id_mismatch" }
          : { status: "ok", teakUserId: "permanent-owner" }
      );
      expect(await snapshot(t)).toEqual(before);
    }
  );

  test.each(["provider", "owner"])(
    "duplicate %s mappings cannot resolve",
    async (kind) => {
      const t = setup();
      await seed(t);
      await seed(t, {
        teakUserId: kind === "owner" ? "permanent-owner" : "other-owner",
        workosUserId: kind === "provider" ? "user_provider" : "user_other",
      });
      expect(await resolve(t)).toEqual({
        status: "denied",
        reason: "duplicate_mapping",
      });
    }
  );

  test.each(["deletedAt", "workosDeletedAt"] as const)(
    "%s prevents access with a verified claim",
    async (field) => {
      const t = setup();
      await seed(t, { [field]: 1 });
      expect(
        await t.query(internal.workosIdentity.resolveWorkosOwner, {
          ...input,
          verification: { kind: "session", emailVerified: true },
        })
      ).toEqual({
        status: "denied",
        reason: field === "deletedAt" ? "deleted_user" : "workos_deleted_user",
      });
    }
  );

  test("active Teak account deletion denies both token kinds", async () => {
    const t = setup();
    await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        userId: "permanent-owner",
        startedAt: 1,
      })
    );
    expect(await resolve(t)).toEqual({
      status: "denied",
      reason: "deleting_user",
    });
    expect(
      await t.query(internal.workosIdentity.resolveWorkosOwner, {
        ...input,
        verification: { kind: "session", emailVerified: true },
      })
    ).toEqual({ status: "denied", reason: "deleting_user" });
  });

  test("provider deletion ledger denies all duplicate rows, including an unpatched third row", async () => {
    const t = setup();
    for (const teakUserId of ["permanent-owner", "owner-two", "owner-three"]) {
      await seed(t, { teakUserId });
    }
    await t.mutation(internal.workosLifecycle.applyWorkosEvent, {
      id: "evt_deleted",
      event: "user.deleted",
      createdAt: "2023-11-14T22:13:21.000Z",
      data: { id: "user_provider" },
    });
    const before = await snapshot(t);
    expect(before.users[2].workosDeletedAt).toBeUndefined();
    expect(before.users[2].workosEmailVerified).toBe(true);
    for (const verification of [
      { kind: "connect" as const },
      { kind: "session" as const, emailVerified: true },
    ]) {
      expect(
        await t.query(internal.workosIdentity.resolveWorkosOwner, {
          ...input,
          verification,
        })
      ).toEqual({ status: "denied", reason: "workos_deleted_user" });
    }
    expect(await snapshot(t)).toEqual(before);
  });

  test("provider deletion ledger denies a unique row without supplementary flags", async () => {
    const t = setup();
    await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("workosEvents", {
        eventId: "evt_terminal",
        workosUserId: "user_provider",
        type: "user.deleted",
        createdAt: 1,
      })
    );
    const before = await snapshot(t);
    expect(before.users[0].workosDeletedAt).toBeUndefined();
    expect(await resolve(t)).toEqual({
      status: "denied",
      reason: "workos_deleted_user",
    });
    expect(await snapshot(t)).toEqual(before);
  });
});
