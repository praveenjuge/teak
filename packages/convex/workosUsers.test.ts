/// <reference types="vite/client" />
import {
  type ApiFromModules,
  type FunctionArgs,
  type FunctionReturnType,
  makeFunctionReference,
} from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import type { linkWorkosUser } from "./workosUsers";

const modules = import.meta.glob("./**/*.ts");
// The new module is not wired to runtime. Generated API changes are deferred to
// main integration; this typed reference invokes the real registered mutation.
type Link = ApiFromModules<{
  workosUsers: { linkWorkosUser: typeof linkWorkosUser };
}>["workosUsers"]["linkWorkosUser"];
const link = makeFunctionReference<
  "mutation",
  FunctionArgs<Link>,
  FunctionReturnType<Link>
>("workosUsers:linkWorkosUser");
const setup = () => convexTest(schema, modules);
type Backend = ReturnType<typeof setup>;
const input = {
  workosUserId: "user_workos_a",
  email: "owner@example.com",
  emailVerified: true,
  source: "import" as const,
};
const seed = (t: Backend, fields: Partial<Doc<"users">> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "owner-a",
      email: "owner@example.com",
      emailVerified: true,
      ...fields,
    })
  );
const snapshot = (t: Backend) =>
  t.run(async (ctx) => ({
    users: await ctx.db.query("users").take(20),
    quarantine: await ctx.db.query("migrationQuarantine").take(20),
    cards: await ctx.db.query("cards").take(20),
  }));

// Failure modes: external-ID fallback stealing another vault; unverified or
// ambiguous email claims; conflicting/duplicate provider and permanent IDs;
// deletion resurrection; retry profile/role/card changes; concurrent duplicate
// linking; quarantine writes rolled back by throws; malformed provider inputs.
describe("transactional WorkOS identity linking", () => {
  test("external ID links an unverified imported user without rewriting their vault or profile", async () => {
    const t = setup();
    const id = await seed(t, {
      emailVerified: false,
      role: "admin",
      lastWorkosEventAt: 123,
    });
    await t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner-a",
        content: "Permanent vault",
        type: "text",
        createdAt: 1,
        updatedAt: 1,
      })
    );
    const before = await snapshot(t);
    expect(
      await t.mutation(link, {
        ...input,
        externalId: "owner-a",
        email: "changed@example.com",
        emailVerified: false,
      })
    ).toEqual({
      status: "linked",
      teakUserId: "owner-a",
      changed: true,
    });
    const after = await snapshot(t);
    expect(after.users).toEqual([
      { ...before.users[0], workosUserId: input.workosUserId },
    ]);
    expect(after.users[0]._id).toBe(id);
    expect(after.cards).toEqual(before.cards);
    expect(after.quarantine).toEqual([]);
  });

  test("verified normalized email links exactly one existing owner", async () => {
    const t = setup();
    await seed(t);
    expect(
      await t.mutation(link, { ...input, email: " OWNER@EXAMPLE.COM " })
    ).toEqual({ status: "linked", teakUserId: "owner-a", changed: true });
    expect((await snapshot(t)).users[0].workosUserId).toBe(input.workosUserId);
  });

  test("null WorkOS external ID uses verified email fallback", async () => {
    const t = setup();
    await seed(t);
    expect(await t.mutation(link, { ...input, externalId: null })).toEqual({
      status: "linked",
      teakUserId: "owner-a",
      changed: true,
    });
  });

  test("verified WorkOS email cannot attach to an unverified legacy owner", async () => {
    const t = setup();
    await seed(t, { emailVerified: false });
    const before = await snapshot(t);
    expect(await t.mutation(link, input)).toEqual({
      status: "quarantined",
      reason: "email_unverified",
    });
    const after = await snapshot(t);
    expect(after.users).toEqual(before.users);
    expect(after.cards).toEqual(before.cards);
    expect(after.quarantine).toMatchObject([
      { reason: "email_unverified", teakUserId: "owner-a" },
    ]);
  });

  test("idempotent retries from import, webhook and bootstrap keep the same link", async () => {
    const t = setup();
    await seed(t);
    await t.mutation(link, { ...input, externalId: "owner-a" });
    const before = await snapshot(t);
    for (const source of [
      "import",
      "webhook",
      "ensureUser",
      "reconcile",
    ] as const) {
      expect(
        await t.mutation(link, {
          ...input,
          email: "drift@example.com",
          emailVerified: false,
          source,
        })
      ).toEqual({ status: "linked", teakUserId: "owner-a", changed: false });
    }
    expect(await snapshot(t)).toEqual(before);
  });

  test.each(["missing-owner", "owner-b"])(
    "external ID %s never falls back to a matching email",
    async (externalId) => {
      const t = setup();
      await seed(t, { workosUserId: input.workosUserId });
      if (externalId === "owner-b") {
        await seed(t, { teakUserId: "owner-b", email: "other@example.com" });
      }
      const before = await snapshot(t);
      expect(await t.mutation(link, { ...input, externalId })).toEqual({
        status: "quarantined",
        reason: "external_id_mismatch",
      });
      const after = await snapshot(t);
      expect(after.users).toEqual(before.users);
      expect(after.quarantine).toMatchObject([
        {
          teakUserId: externalId,
          workosUserId: input.workosUserId,
          reason: "external_id_mismatch",
          source: "import",
        },
      ]);
    }
  );

  test("unknown external ID cannot claim an unlinked matching-email owner", async () => {
    const t = setup();
    await seed(t);
    expect(
      await t.mutation(link, { ...input, externalId: "missing-owner" })
    ).toEqual({ status: "quarantined", reason: "external_id_mismatch" });
    expect((await snapshot(t)).users[0].workosUserId).toBeUndefined();
  });

  test("unverified email cannot link even a unique matching owner", async () => {
    const t = setup();
    await seed(t);
    expect(await t.mutation(link, { ...input, emailVerified: false })).toEqual({
      status: "quarantined",
      reason: "email_unverified",
    });
    const result = await snapshot(t);
    expect(result.users[0].workosUserId).toBeUndefined();
    expect(result.quarantine).toHaveLength(1);
  });

  test("duplicate emails cannot select the first owner", async () => {
    const t = setup();
    await seed(t);
    await seed(t, { teakUserId: "owner-b" });
    expect(await t.mutation(link, input)).toEqual({
      status: "quarantined",
      reason: "ambiguous_email",
    });
    expect(
      (await snapshot(t)).users.every((row) => row.workosUserId === undefined)
    ).toBe(true);
  });

  test("missing email mapping quarantines instead of creating a user or cards", async () => {
    const t = setup();
    expect(await t.mutation(link, input)).toEqual({
      status: "quarantined",
      reason: "missing_mapping",
    });
    expect(await snapshot(t)).toMatchObject({
      users: [],
      cards: [],
      quarantine: [{ reason: "missing_mapping" }],
    });
  });

  test("email fallback cannot ignore a deleted or already linked duplicate", async () => {
    for (const fields of [{ deletedAt: 1 }, { workosUserId: "user_other" }]) {
      const t = setup();
      await seed(t);
      await seed(t, { teakUserId: "owner-b", ...fields });
      const before = (await snapshot(t)).users;
      expect(await t.mutation(link, input)).toEqual({
        status: "quarantined",
        reason: "ambiguous_email",
      });
      expect((await snapshot(t)).users).toEqual(before);
    }
  });

  test("an unlinked deletion tombstone cannot be revived by verified email", async () => {
    const t = setup();
    await seed(t, { deletedAt: 1 });
    expect(await t.mutation(link, input)).toEqual({
      status: "quarantined",
      reason: "deleted_user",
    });
    expect((await snapshot(t)).users[0].workosUserId).toBeUndefined();
  });

  test("even a malformed stored provider link cannot be silently overwritten", async () => {
    const t = setup();
    await seed(t, { workosUserId: "" });
    expect(await t.mutation(link, { ...input, externalId: "owner-a" })).toEqual(
      { status: "quarantined", reason: "link_conflict" }
    );
    expect((await snapshot(t)).users[0].workosUserId).toBe("");
  });

  test.each([undefined, "owner-a"])(
    "existing provider link cannot be overwritten through externalId=%s",
    async (externalId) => {
      const t = setup();
      await seed(t, { workosUserId: "user_other" });
      const before = (await snapshot(t)).users;
      expect(
        await t.mutation(link, {
          ...input,
          ...(externalId ? { externalId } : {}),
        })
      ).toEqual({ status: "quarantined", reason: "link_conflict" });
      expect((await snapshot(t)).users).toEqual(before);
    }
  );

  test.each([undefined, "owner-a"])(
    "tombstones cannot be relinked through externalId=%s",
    async (externalId) => {
      const t = setup();
      await seed(t, { deletedAt: 1, workosUserId: input.workosUserId });
      const before = (await snapshot(t)).users;
      expect(
        await t.mutation(link, {
          ...input,
          ...(externalId ? { externalId } : {}),
        })
      ).toEqual({ status: "quarantined", reason: "deleted_user" });
      expect((await snapshot(t)).users).toEqual(before);
    }
  );

  test("an account undergoing deletion cannot acquire a link", async () => {
    const t = setup();
    await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        userId: "owner-a",
        startedAt: 1,
      })
    );
    expect(await t.mutation(link, { ...input, externalId: "owner-a" })).toEqual(
      { status: "quarantined", reason: "deleting_user" }
    );
    expect((await snapshot(t)).users[0].workosUserId).toBeUndefined();
  });

  test.each(["provider", "owner"])(
    "duplicate %s index entries fail closed and commit quarantine",
    async (kind) => {
      const t = setup();
      await seed(t, { workosUserId: input.workosUserId });
      await seed(t, {
        teakUserId: kind === "owner" ? "owner-a" : "owner-b",
        workosUserId: kind === "provider" ? input.workosUserId : undefined,
      });
      const before = (await snapshot(t)).users;
      expect(
        await t.mutation(link, { ...input, externalId: "owner-a" })
      ).toEqual({ status: "quarantined", reason: "duplicate_mapping" });
      expect((await snapshot(t)).users).toEqual(before);
      expect((await snapshot(t)).quarantine).toHaveLength(1);
    }
  );

  test("concurrent import, webhook and bootstrap converge on one provider link", async () => {
    const t = setup();
    await seed(t);
    const results = await Promise.all(
      (["import", "webhook", "ensureUser"] as const).map((source) =>
        t.mutation(link, { ...input, externalId: "owner-a", source })
      )
    );
    expect(
      results.filter((result) => result.status === "linked" && result.changed)
    ).toHaveLength(1);
    expect(
      results.every(
        (result) =>
          result.status === "linked" && result.teakUserId === "owner-a"
      )
    ).toBe(true);
    const result = await snapshot(t);
    expect(result.users).toHaveLength(1);
    expect(result.users[0].workosUserId).toBe(input.workosUserId);
    expect(result.quarantine).toEqual([]);
  });

  test("concurrent competing provider IDs cannot overwrite the winning owner link", async () => {
    const t = setup();
    await seed(t);
    const results = await Promise.all(
      ["user_workos_a", "user_workos_b"].map((workosUserId) =>
        t.mutation(link, { ...input, externalId: "owner-a", workosUserId })
      )
    );
    expect(results.filter((result) => result.status === "linked")).toHaveLength(
      1
    );
    expect(results.filter((result) => result.status === "quarantined")).toEqual(
      [{ status: "quarantined", reason: "link_conflict" }]
    );
    const result = await snapshot(t);
    expect(result.users).toHaveLength(1);
    expect(result.quarantine).toHaveLength(1);
    expect(result.quarantine[0].workosUserId).not.toBe(
      result.users[0].workosUserId
    );
  });

  test("concurrent claims of one provider ID cannot link two permanent owners", async () => {
    const t = setup();
    await seed(t);
    await seed(t, { teakUserId: "owner-b", email: "other@example.com" });
    const results = await Promise.all(
      ["owner-a", "owner-b"].map((externalId) =>
        t.mutation(link, { ...input, externalId })
      )
    );
    expect(results.filter((result) => result.status === "linked")).toHaveLength(
      1
    );
    expect(results.filter((result) => result.status === "quarantined")).toEqual(
      [{ status: "quarantined", reason: "external_id_mismatch" }]
    );
    expect(
      (await snapshot(t)).users.filter(
        (row) => row.workosUserId === input.workosUserId
      )
    ).toHaveLength(1);
  });

  test.each([
    { workosUserId: "" },
    { externalId: "" },
    { workosUserId: "user\nattack" },
    { email: "" },
    { email: "a".repeat(321) },
  ])(
    "malformed provider input is rejected without writes: %j",
    async (invalid) => {
      const t = setup();
      await seed(t);
      const before = await snapshot(t);
      await expect(t.mutation(link, { ...input, ...invalid })).rejects.toThrow(
        "Invalid WorkOS linking input"
      );
      expect(await snapshot(t)).toEqual(before);
    }
  );
});

// Creation failures: disabled primary/freeze, untrusted sources, external-ID
// conflicts, unverified email, deleted provider, collisions and retry seeding.
describe("trusted new WorkOS owners", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("AUTH_PRIMARY", "workos");
    vi.stubEnv("SIGNUPS_DISABLED", "false");
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  const create = {
    ...input,
    workosUserId: "user_NEW",
    source: "ensureUser" as const,
    allowCreate: true,
  };
  const jobs = (t: Backend) =>
    t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(10));
  test("creates one opaque permanent owner and seeds only once across retries", async () => {
    const t = setup();
    const result = await t.mutation(link, create);
    expect(result).toMatchObject({ status: "linked", changed: true });
    if (result.status !== "linked") {
      throw new Error("Expected new owner");
    }
    expect(result.teakUserId).toMatch(/^teak_[a-f0-9]{32}$/);
    expect(result.teakUserId).not.toBe(create.workosUserId);
    expect((await snapshot(t)).users).toMatchObject([
      {
        teakUserId: result.teakUserId,
        workosUserId: create.workosUserId,
        workosEmail: input.email,
        workosEmailVerified: true,
      },
    ]);
    const scheduled = await jobs(t);
    expect(scheduled).toHaveLength(2);
    expect(
      scheduled.map((job) => ({ name: job.name, args: job.args }))
    ).toEqual([
      {
        name: "card/defaultCards:createDefaultCardsForUser",
        args: [{ userId: result.teakUserId }],
      },
      {
        name: "telemetry/events:emitUserCreated",
        args: [{ userId: result.teakUserId, source: "auth" }],
      },
    ]);
    for (const source of [
      "ensureUser",
      "webhook",
      "import",
      "reconcile",
    ] as const) {
      expect(await t.mutation(link, { ...create, source })).toEqual({
        ...result,
        changed: false,
      });
    }
    expect(await jobs(t)).toEqual(scheduled);
    expect((await snapshot(t)).users).toHaveLength(1);
  });
  test("freeze quarantines without creating and allows the same subject after unfreeze", async () => {
    const t = setup();
    vi.stubEnv("SIGNUPS_DISABLED", "true");
    expect(await t.mutation(link, create)).toEqual({
      status: "quarantined",
      reason: "signups_frozen",
    });
    expect((await snapshot(t)).users).toEqual([]);
    expect(await jobs(t)).toEqual([]);
    vi.stubEnv("SIGNUPS_DISABLED", "false");
    expect(await t.mutation(link, create)).toMatchObject({ status: "linked" });
    expect((await snapshot(t)).quarantine).toMatchObject([
      { reason: "signups_frozen" },
    ]);
  });
  test.each(["import", "reconcile"] as const)(
    "%s cannot create even with the internal discriminator",
    async (source) => {
      const t = setup();
      expect(await t.mutation(link, { ...create, source })).toEqual({
        status: "quarantined",
        reason: "missing_mapping",
      });
      expect((await snapshot(t)).users).toEqual([]);
      expect(await jobs(t)).toEqual([]);
    }
  );
  test.each(["betterauth", undefined])(
    "primary %s cannot create",
    async (primary) => {
      const t = setup();
      vi.stubEnv("AUTH_PRIMARY", primary);
      expect(await t.mutation(link, create)).toEqual({
        status: "quarantined",
        reason: "missing_mapping",
      });
      expect((await snapshot(t)).users).toEqual([]);
    }
  );
  test("webhook without explicit created-event permission cannot create", async () => {
    const t = setup();
    expect(await t.mutation(link, { ...input, source: "webhook" })).toEqual({
      status: "quarantined",
      reason: "missing_mapping",
    });
  });
  test.each([
    { externalId: "unknown-owner", reason: "external_id_mismatch" },
    { emailVerified: false, reason: "email_unverified" },
  ])("creation preserves $reason quarantine", async ({ reason, ...fields }) => {
    const t = setup();
    expect(await t.mutation(link, { ...create, ...fields })).toEqual({
      status: "quarantined",
      reason,
    });
    expect((await snapshot(t)).users).toEqual([]);
    expect(await jobs(t)).toEqual([]);
  });
  test("a terminal provider deletion blocks a fresh owner", async () => {
    const t = setup();
    await t.run((ctx) =>
      ctx.db.insert("workosEvents", {
        workosUserId: create.workosUserId,
        eventId: "deleted",
        type: "user.deleted",
        createdAt: 1,
      })
    );
    expect(await t.mutation(link, create)).toEqual({
      status: "quarantined",
      reason: "workos_deleted_user",
    });
    expect((await snapshot(t)).users).toEqual([]);
  });
  test("bounded allocation collisions preserve the existing owner", async () => {
    const t = setup();
    await seed(t, {
      teakUserId: `teak_${"0".repeat(32)}`,
      email: "other@example.com",
    });
    vi.spyOn(Math, "random").mockReturnValue(0);
    await expect(t.mutation(link, create)).rejects.toThrow("allocate");
    vi.restoreAllMocks();
    expect((await snapshot(t)).users).toHaveLength(1);
    expect(await jobs(t)).toEqual([]);
  });
});
