import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import {
  deliverWorkosUserUpdate,
  seedComponentUser,
} from "../__tests__/helpers/workosOwner.test-utils";
import { components, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const setup = () => {
  const t = convexTest(schema, modules);
  workosTest.register(t);
  return t;
};
type Backend = ReturnType<typeof setup>;
const input = {
  workosUserId: "user_provider",
  verification: { kind: "connect" as const },
};
const seed = async (
  t: Backend,
  fields: Partial<Doc<"users">> = {},
  profile: { emailVerified?: boolean; externalId?: string | null } | null = {}
) => {
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "permanent-owner",
      workosUserId: "user_provider",
      email: "legacy@example.com",
      emailVerified: true,
      ...fields,
    })
  );
  const user = await t.run((ctx) => ctx.db.get("users", owner));
  if (profile !== null && user?.workosUserId) {
    await seedComponentUser(t, {
      id: user.workosUserId,
      email: "provider@example.com",
      externalId: user.teakUserId,
      ...profile,
    });
  }
  return owner;
};

const resolve = (t: Backend) =>
  t.query(internal.workosIdentity.resolveWorkosOwner, input);
const snapshot = (t: Backend) =>
  t.run(async (ctx) => ({
    users: await ctx.db.query("users").take(10),
    quarantine: await ctx.db.query("migrationQuarantine").take(10),
    provider: await ctx.runQuery(components.workOSAuthKit.lib.getAuthUser, {
      id: "user_provider",
    }),
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

  test("a WorkOS user deleted before Teak linked it stays unmapped", async () => {
    const t = setup();
    await t.mutation(internal.workosWebhook.syncVerifiedEvent, {
      id: "evt_unlinked_delete",
      event: "user.deleted",
      createdAt: "2026-10-08T00:00:01.000Z",
      data: { object: "user", id: "user_provider" },
    });
    expect(await resolve(t)).toEqual({
      status: "denied",
      reason: "missing_mapping",
    });
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

  test("a verified mapping row admits Connect and sessions before its component profile arrives", async () => {
    const t = setup();
    await seed(t, { emailVerified: true }, null);
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

  test("Connect needs the mapping row verified, whatever the component profile says", async () => {
    const t = setup();
    await seed(t, { emailVerified: false }, { emailVerified: true });
    expect(await resolve(t)).toEqual({
      status: "denied",
      reason: "verify_email",
    });
    await deliverWorkosUserUpdate(t, input.workosUserId, {
      emailVerified: true,
    });
    expect(await resolve(t)).toEqual({
      status: "ok",
      teakUserId: "permanent-owner",
    });
  });

  test("a stored owner resolves before its profile arrives, but not once the webhook says unverified", async () => {
    const t = setup();
    await seed(t, { emailVerified: true }, null);
    const stored = {
      ...input,
      verification: { kind: "stored" as const },
    };
    expect(
      await t.query(internal.workosIdentity.resolveWorkosOwner, stored)
    ).toEqual({ status: "ok", teakUserId: "permanent-owner" });
    await t.mutation(internal.workosWebhook.syncVerifiedEvent, {
      id: "evt_unverified_profile",
      event: "user.updated",
      createdAt: "2026-10-08T00:00:01.000Z",
      data: {
        object: "user",
        id: input.workosUserId,
        email: "owner@example.com",
        emailVerified: false,
        metadata: {},
        createdAt: "2026-10-08T00:00:00.000Z",
        updatedAt: "2026-10-08T00:00:01.000Z",
      },
    });
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

  test.each(["someone-else", "permanent-owner", null])(
    "a component external ID %s never changes which owner resolves",
    async (externalId) => {
      const t = setup();
      await seed(t, {}, { externalId });
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

  test("a provider deletion leaves every duplicate row denied, including an unpatched fourth row", async () => {
    const t = setup();
    for (const teakUserId of [
      "permanent-owner",
      "owner-two",
      "owner-three",
      "owner-four",
    ]) {
      await seed(t, { teakUserId });
    }
    await t.mutation(internal.workosLifecycle.applyWorkosEvent, {
      id: "evt_deleted",
      event: "user.deleted",
      createdAt: "2023-11-14T22:13:21.000Z",
      data: { id: "user_provider" },
    });
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
