/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const pins = {
  environmentId: "environment_expected",
  clientId: "client_expected",
  apiKeyFingerprint:
    "0cd3cf5f74c92c94559c4397065417ee80f45c5115d28889b9872049ea5533aa",
};
const setup = () => {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  return t;
};
beforeEach(() => {
  vi.stubEnv("AUTH_PRIMARY", "betterauth");
  vi.stubEnv("SIGNUPS_DISABLED", "true");
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", pins.environmentId);
  vi.stubEnv("WORKOS_CLIENT_ID", pins.clientId);
  vi.stubEnv("WORKOS_API_KEY", "test-workos-reconciliation-key");
});
afterEach(() => vi.unstubAllEnvs());
async function seed(t: ReturnType<typeof setup>) {
  const source = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Import source",
          email: "import@example.com",
          emailVerified: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    })
  );
  if (!("_id" in source)) {
    throw new Error("Source user missing id");
  }
  const id = String(source._id);
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: id,
      email: "import@example.com",
      emailVerified: false,
    })
  );
  return id;
}
async function writer(t: ReturnType<typeof setup>) {
  return await t.mutation(internal.migration.workosImportLease.acquire, {
    ...pins,
    holder: crypto.randomUUID(),
    runId: "a".repeat(64),
  });
}
// Failure modes: wrong environment/key; unpaused/WorkOS source; missing explicit
// verification; unresolved quarantine; immutable source changes before mapping.
test("pages exact unverified Better Auth source and links a proven external owner without rewriting the vault", async () => {
  const t = setup(),
    id = await seed(t);
  const page = await t.query(internal.migration.workosImportSource.page, {
    ...pins,
    cursor: null,
  });
  expect(page.owners).toMatchObject([
    {
      teakUserId: id,
      emailVerified: false,
      passwordHash: null,
      deletedAt: null,
    },
  ]);
  const owner = page.owners[0];
  expect(
    await t.mutation(internal.migration.workosImportSource.link, {
      ...pins,
      ...(await writer(t)),
      teakUserId: id,
      sourceVersion: owner.sourceVersion,
      user: {
        id: "user_imported",
        externalId: id,
        email: owner.email,
        emailVerified: false,
      },
    })
  ).toBe("linked");
  expect(await t.run((ctx) => ctx.db.query("users").first())).toMatchObject({
    teakUserId: id,
    workosUserId: "user_imported",
    emailVerified: false,
  });
});
test("wrong provider pins and active quarantine stop source export", async () => {
  const t = setup();
  await seed(t);
  await expect(
    t.query(internal.migration.workosImportSource.page, {
      ...pins,
      environmentId: "other",
      cursor: null,
    })
  ).rejects.toThrow("pinned");
  await expect(
    t.query(internal.migration.workosImportSource.page, {
      ...pins,
      apiKeyFingerprint: "other",
      cursor: null,
    })
  ).rejects.toThrow("credential");
  await t.run((ctx) =>
    ctx.db.insert("migrationQuarantine", {
      email: "unknown@example.com",
      reason: "any_reason",
      source: "preflight",
      createdAt: Date.now(),
    })
  );
  expect(
    await t.query(internal.migration.workosImportSource.page, {
      ...pins,
      cursor: null,
    })
  ).toEqual({
    owners: [],
    done: false,
    cursor: null,
    unresolvedQuarantine: true,
  });
});
test("owner deletion after reading a page prevents its later mapping", async () => {
  const t = setup(),
    id = await seed(t),
    page = await t.query(internal.migration.workosImportSource.page, {
      ...pins,
      cursor: null,
    });
  await t.run(async (ctx) => {
    const row = await ctx.db.query("users").first();
    if (!row) {
      throw new Error("Missing owner");
    }
    await ctx.db.patch("users", row._id, { deletedAt: Date.now() });
  });
  await expect(
    t.mutation(internal.migration.workosImportSource.link, {
      ...pins,
      ...(await writer(t)),
      teakUserId: id,
      sourceVersion: page.owners[0].sourceVersion,
      user: {
        id: "user_imported",
        externalId: id,
        email: "import@example.com",
        emailVerified: false,
      },
    })
  ).rejects.toThrow("owner changed");
  expect(
    await t.run((ctx) => ctx.db.query("users").first())
  ).not.toHaveProperty("workosUserId");
});

test("source admission requires configured witness and rejects credential drift before export", async () => {
  const t = setup();
  await expect(
    t.query(internal.migration.workosImportSource.admission, pins)
  ).rejects.toThrow("witness binding");
  vi.stubEnv("WORKOS_RECONCILIATION_WITNESS_ID", "user_controlledwitness");
  expect(
    await t.query(internal.migration.workosImportSource.admission, pins)
  ).toEqual({ witnessUserId: "user_controlledwitness" });
  await expect(
    t.query(internal.migration.workosImportSource.admission, {
      ...pins,
      apiKeyFingerprint: "wrong",
    })
  ).rejects.toThrow("witness binding");
});

// Failure modes: oversized write, provider pin drift, repeated collision runs,
// and collision evidence not fencing later secret-bearing source export.
test("bounded preflight receipts persist collision fences once and stop later import pages", async () => {
  const t = setup();
  await seed(t);
  const lease = await writer(t);
  const receipts = [
    {
      email: "import@example.com",
      reason: "duplicate_email" as const,
      teakUserId: "conflicting_owner",
    },
  ];
  await expect(
    t.mutation(internal.migration.workosImportSource.quarantinePreflight, {
      ...pins,
      ...lease,
      apiKeyFingerprint: "wrong",
      receipts,
    })
  ).rejects.toThrow("credential");
  await expect(
    t.mutation(internal.migration.workosImportSource.quarantinePreflight, {
      ...pins,
      ...lease,
      receipts: Array.from({ length: 21 }, () => receipts[0]),
    })
  ).rejects.toThrow("receipt budget");
  expect(
    await t.run((ctx) => ctx.db.query("migrationQuarantine").collect())
  ).toEqual([]);
  expect(
    await t.mutation(
      internal.migration.workosImportSource.quarantinePreflight,
      { ...pins, ...lease, receipts }
    )
  ).toBe(1);
  expect(
    await t.mutation(
      internal.migration.workosImportSource.quarantinePreflight,
      { ...pins, ...lease, receipts }
    )
  ).toBe(0);
  expect(
    await t.run((ctx) => ctx.db.query("migrationQuarantine").collect())
  ).toMatchObject([
    {
      email: "import@example.com",
      reason: "duplicate_email",
      source: "import_preflight",
      teakUserId: "conflicting_owner",
    },
  ]);
  expect(
    await t.query(internal.migration.workosImportSource.page, {
      ...pins,
      cursor: null,
    })
  ).toMatchObject({ owners: [], unresolvedQuarantine: true });
});

// A signed create webhook can win the race to map an imported owner. Only that
// exact mapping change may satisfy the original source compare-and-swap.
test.each(["none", "email", "verification", "name", "credential", "mapping"])(
  "concurrent provider link preserves the source guard with %s drift",
  async (drift) => {
    const t = setup(),
      id = await seed(t);
    const cardId = await t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: id,
        type: "text",
        content: "Preserved vault",
        createdAt: 1,
        updatedAt: 1,
      })
    );
    const page = await t.query(internal.migration.workosImportSource.page, {
      ...pins,
      cursor: null,
    });
    const owner = page.owners[0];
    await t.mutation(internal.workosUsers.linkWorkosUser, {
      workosUserId: "user_imported",
      externalId: id,
      email: owner.email,
      emailVerified: owner.emailVerified,
      source: "webhook",
    });
    await t.run(async (ctx) => {
      if (drift === "credential") {
        await ctx.runMutation(components.betterAuth.adapter.create, {
          input: {
            model: "account",
            data: {
              accountId: id,
              userId: id,
              providerId: "credential",
              password: "new-hash",
              createdAt: Date.now(),
              updatedAt: Date.now() + 1,
            },
          },
        });
      } else if (drift === "mapping") {
        const row = await ctx.db.query("users").first();
        if (!row) {
          throw new Error("Missing owner");
        }
        await ctx.db.patch("users", row._id, { workosUserId: "user_other" });
      } else if (drift !== "none") {
        let update: { email?: string; emailVerified?: boolean; name?: string } =
          {
            name: "Changed",
          };
        if (drift === "email") {
          update = { email: "changed@example.com" };
        } else if (drift === "verification") {
          update = { emailVerified: true };
        }
        await ctx.runMutation(components.betterAuth.adapter.updateOne, {
          input: {
            model: "user",
            where: [{ field: "_id", value: id }],
            update,
          },
        });
      }
    });
    const result = t.mutation(internal.migration.workosImportSource.link, {
      ...pins,
      ...(await writer(t)),
      teakUserId: id,
      sourceVersion: owner.sourceVersion,
      user: {
        id: "user_imported",
        externalId: id,
        email: owner.email,
        emailVerified: owner.emailVerified,
      },
    });
    if (drift === "none") {
      await expect(result).resolves.toBe("linked");
      expect(await t.run((ctx) => ctx.db.query("users").first())).toMatchObject(
        {
          teakUserId: id,
          workosUserId: "user_imported",
        }
      );
    } else {
      await expect(result).rejects.toThrow("source changed");
    }
    expect((await t.run((ctx) => ctx.db.get(cardId)))?.userId).toBe(id);
  }
);

test.each(["deleted", "duplicate"])(
  "webhook-first mapping still quarantines %s provider state",
  async (state) => {
    const t = setup(),
      id = await seed(t);
    const page = await t.query(internal.migration.workosImportSource.page, {
      ...pins,
      cursor: null,
    });
    const owner = page.owners[0];
    await t.mutation(internal.workosUsers.linkWorkosUser, {
      workosUserId: "user_imported",
      externalId: id,
      email: owner.email,
      emailVerified: false,
      source: "webhook",
    });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("users").first();
      if (!row) {
        throw new Error("Missing owner");
      }
      if (state === "deleted") {
        await ctx.db.patch("users", row._id, { workosDeletedAt: Date.now() });
      } else {
        await ctx.db.insert("users", {
          teakUserId: "other-owner",
          email: "other@example.com",
          emailVerified: true,
          workosUserId: "user_imported",
        });
      }
    });
    await expect(
      t.mutation(internal.migration.workosImportSource.link, {
        ...pins,
        ...(await writer(t)),
        teakUserId: id,
        sourceVersion: owner.sourceVersion,
        user: {
          id: "user_imported",
          externalId: id,
          email: owner.email,
          emailVerified: false,
        },
      })
    ).resolves.toBe("quarantined");
    expect(
      await t.run((ctx) => ctx.db.query("migrationQuarantine").first())
    ).toMatchObject({
      reason: state === "deleted" ? "workos_deleted_user" : "duplicate_mapping",
    });
  }
);
