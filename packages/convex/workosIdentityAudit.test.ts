/// <reference types="vite/client" />
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const setup = () => {
  const t = convexTest(schema, modules);
  workosTest.register(t);
  return t;
};
type Backend = ReturnType<typeof setup>;

const componentUser = (
  t: Backend,
  id: string,
  data: { email: string; emailVerified: boolean; firstName?: string }
) =>
  t.mutation(components.workOSAuthKit.lib.onWebhookEvent, {
    event: {
      id: `event_${id}`,
      event: "user.created",
      createdAt: "2026-10-04T00:00:00.000Z",
      data: {
        object: "user",
        id,
        metadata: {},
        createdAt: "2026-10-04T00:00:00.000Z",
        updatedAt: "2026-10-04T00:00:00.000Z",
        ...data,
      },
    },
  });

const owner = (
  t: Backend,
  teakUserId: string,
  fields: {
    workosUserId?: string;
    email?: string;
    workosEmail?: string;
    workosEmailVerified?: boolean;
    deletedAt?: number;
  }
) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId,
      email: fields.email ?? `${teakUserId}@example.com`,
      emailVerified: true,
      ...fields,
    })
  );

const profileCopy = (
  t: Backend,
  workosUserId: string,
  profile: { email: string; firstName?: string | null; name?: string | null }
) =>
  t.run((ctx) =>
    ctx.db.insert("workosProfiles", {
      workosUserId,
      revision: 1,
      source: "event",
      providerUpdatedAt: "2026-10-04T00:00:00Z",
      profile: {
        emailVerified: true,
        externalId: null,
        lastName: null,
        profilePictureUrl: null,
        firstName: null,
        ...profile,
      },
    })
  );

const audit = (t: Backend) =>
  t.query(internal.workosIdentityAudit.page, {
    paginationOpts: { cursor: null, numItems: 100 },
  });

describe("WorkOS identity parity audit", () => {
  test("a matching owner reports nothing", async () => {
    const t = setup();
    await owner(t, "teak_match", {
      workosUserId: "user_MATCH",
      workosEmail: "Match@Example.com",
      workosEmailVerified: true,
    });
    await componentUser(t, "user_MATCH", {
      email: "match@example.com",
      emailVerified: true,
    });
    await profileCopy(t, "user_MATCH", { email: "match@example.com" });
    expect(await audit(t)).toMatchObject({
      checked: 1,
      unlinked: 0,
      issues: [],
      isDone: true,
    });
  });

  test("reports each kind of drift by ID only", async () => {
    const t = setup();
    await owner(t, "teak_missing", { workosUserId: "user_MISSING" });
    await owner(t, "teak_drift", {
      workosUserId: "user_DRIFT",
      workosEmail: "old@example.com",
      workosEmailVerified: true,
    });
    await componentUser(t, "user_DRIFT", {
      email: "new@example.com",
      emailVerified: false,
    });
    await owner(t, "teak_deleted", {
      workosUserId: "user_DELETED",
      deletedAt: 1,
    });
    await componentUser(t, "user_DELETED", {
      email: "deleted@example.com",
      emailVerified: true,
    });
    await owner(t, "legacy_unlinked", {});
    const report = await audit(t);
    expect(report.unlinked).toBe(1);
    expect(report.issues).toEqual([
      {
        teakUserId: "teak_missing",
        workosUserId: "user_MISSING",
        kinds: ["missing_component_user"],
      },
      {
        teakUserId: "teak_drift",
        workosUserId: "user_DRIFT",
        kinds: [
          "email_mismatch",
          "email_verified_mismatch",
          "missing_profile_copy",
        ],
      },
      {
        teakUserId: "teak_deleted",
        workosUserId: "user_DELETED",
        kinds: ["deleted_but_component_user_present"],
      },
    ]);
    expect(JSON.stringify(report)).not.toContain("@example.com");
  });

  test("compares Teak's profile copy with the component user", async () => {
    const t = setup();
    await owner(t, "teak_profile", {
      workosUserId: "user_PROFILE",
      workosEmail: "same@example.com",
      workosEmailVerified: true,
    });
    await componentUser(t, "user_PROFILE", {
      email: "same@example.com",
      emailVerified: true,
      firstName: "Component",
    });
    await profileCopy(t, "user_PROFILE", {
      email: "same@example.com",
      firstName: "Teak copy",
    });
    expect((await audit(t)).issues).toEqual([
      {
        teakUserId: "teak_profile",
        workosUserId: "user_PROFILE",
        kinds: ["profile_mismatch"],
      },
    ]);
  });

  test("reports duplicate copies and full-name drift", async () => {
    const t = setup();
    for (const id of ["DUPE", "NAME"]) {
      await owner(t, `teak_${id.toLowerCase()}`, {
        workosUserId: `user_${id}`,
        workosEmail: "same@example.com",
        workosEmailVerified: true,
      });
      await componentUser(t, `user_${id}`, {
        email: "same@example.com",
        emailVerified: true,
      });
    }
    await profileCopy(t, "user_DUPE", { email: "same@example.com" });
    await profileCopy(t, "user_DUPE", { email: "same@example.com" });
    await profileCopy(t, "user_NAME", {
      email: "same@example.com",
      name: "Old Name",
    });
    expect((await audit(t)).issues).toEqual([
      {
        teakUserId: "teak_dupe",
        workosUserId: "user_DUPE",
        kinds: ["duplicate_profile_copies"],
      },
      {
        teakUserId: "teak_name",
        workosUserId: "user_NAME",
        kinds: ["profile_mismatch"],
      },
    ]);
  });

  test("counts open quarantine receipts by reason", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (const reason of [
        "link_conflict",
        "link_conflict",
        "signups_frozen",
      ]) {
        await ctx.db.insert("migrationQuarantine", {
          workosUserId: "user_Q",
          email: "q@example.com",
          reason,
          source: "webhook",
          createdAt: 0,
        });
      }
      await ctx.db.insert("migrationQuarantine", {
        workosUserId: "user_Q",
        email: "q@example.com",
        reason: "missing_mapping",
        source: "webhook",
        createdAt: 0,
        resolvedAt: 1,
      });
    });
    expect(
      await t.query(internal.workosIdentityAudit.openQuarantine, {})
    ).toEqual({
      total: 3,
      byReason: { link_conflict: 2, signups_frozen: 1 },
      truncated: false,
    });
  });
});
