import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { setOwnerVerified } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const setup = () => {
  const t = convexTest(schema, modules);
  return t;
};
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
      ...fields,
    })
  );

const resolve = (t: Backend) =>
  t.query(internal.workosIdentity.resolveWorkosOwner, input);
const snapshot = (t: Backend) =>
  t.run(async (ctx) => ({
    users: await ctx.db.query("users").take(10),
  }));

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

  test("each denial logs its exact reason with a hashed subject and nothing else", async () => {
    const t = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await t.query(internal.workosIdentity.resolveWorkosOwner, {
        workosUserId: "user_provider",
        verification: { kind: "session", emailVerified: true },
      });
      await seed(t);
      expect((await resolve(t)).status).toBe("ok");
      const lines = warn.mock.calls.filter(
        (call) => call[0] === "identity_resolver_denial"
      );
      expect(lines).toEqual([
        [
          "identity_resolver_denial",
          {
            provider: "workos",
            reason: "missing_mapping",
            verification: "session",
            emailVerified: true,
            subject: expect.stringMatching(/^s_[0-9a-f]{16}$/),
          },
        ],
      ]);
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(
        /user_provider|@example\.com|permanent-owner/
      );
    } finally {
      warn.mockRestore();
    }
  });

  test("an unverified mapping row denies every token kind despite a verified claim", async () => {
    const t = setup();
    await seed(t, { emailVerified: false });
    for (const verification of [
      { kind: "connect" as const },
      { kind: "session" as const, emailVerified: true },
      { kind: "stored" as const },
    ]) {
      expect(
        await t.query(internal.workosIdentity.resolveWorkosOwner, {
          ...input,
          verification,
        })
      ).toEqual({ status: "denied", reason: "verify_email" });
    }
  });

  test("a verified mapping row admits Connect and sessions", async () => {
    const t = setup();
    await seed(t, { emailVerified: true });
    for (const verification of [
      { kind: "connect" as const },
      { kind: "session" as const, emailVerified: true },
    ]) {
      expect(
        await t.query(internal.workosIdentity.resolveWorkosOwner, {
          ...input,
          verification,
        })
      ).toEqual({ status: "ok", teakUserId: "permanent-owner" });
    }
  });

  test("Connect needs the mapping row verified, and a verified sign-in marks it", async () => {
    const t = setup();
    await seed(t, { emailVerified: false });
    expect(await resolve(t)).toEqual({
      status: "denied",
      reason: "verify_email",
    });
    await t
      .withIdentity({
        issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
        subject: input.workosUserId,
        sid: "session_PROVIDER",
        email: "legacy@example.com",
        email_verified: true,
      })
      .mutation(api.workosBootstrap.ensureUser, {});
    expect(await resolve(t)).toEqual({
      status: "ok",
      teakUserId: "permanent-owner",
    });
  });

  test("a stored owner resolves only while its mapping row is verified", async () => {
    const t = setup();
    await seed(t);
    const stored = {
      ...input,
      verification: { kind: "stored" as const },
    };
    expect(
      await t.query(internal.workosIdentity.resolveWorkosOwner, stored)
    ).toEqual({ status: "ok", teakUserId: "permanent-owner" });
    await setOwnerVerified(t, input.workosUserId, false);
    expect(
      await t.query(internal.workosIdentity.resolveWorkosOwner, stored)
    ).toEqual({ status: "denied", reason: "verify_email" });
  });

  test.each([true, false])(
    "session verification claim %s is authoritative",
    async (emailVerified) => {
      const t = setup();
      await seed(t);
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

  test("duplicate provider mappings cannot resolve", async () => {
    const t = setup();
    await seed(t);
    await seed(t, { teakUserId: "other-owner" });
    expect(await resolve(t)).toEqual({
      status: "denied",
      reason: "duplicate_mapping",
    });
  });

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
    await t.mutation(internal.accountDeletion.beginAccountDataDeletion, {
      userId: "permanent-owner",
    });
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

  test("duplicate rows stay denied when only some carry a WorkOS deletion", async () => {
    const t = setup();
    // The webhook marked at most two rows of a deleted WorkOS user.
    for (const [index, teakUserId] of [
      "permanent-owner",
      "owner-two",
      "owner-three",
      "owner-four",
    ].entries()) {
      await seed(t, {
        teakUserId,
        ...(index < 2 ? { workosDeletedAt: 1 } : {}),
      });
    }
    const before = await snapshot(t);
    expect(before.users[3].workosDeletedAt).toBeUndefined();
    for (const verification of [
      { kind: "connect" as const },
      { kind: "session" as const, emailVerified: true },
    ]) {
      expect(
        await t.query(internal.workosIdentity.resolveWorkosOwner, {
          ...input,
          verification,
        })
      ).toEqual({ status: "denied", reason: "duplicate_mapping" });
    }
    expect(await snapshot(t)).toEqual(before);
  });
});
