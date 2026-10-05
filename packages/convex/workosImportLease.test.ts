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
const acquire = (t: ReturnType<typeof setup>) =>
  t.mutation(internal.migration.workosImportLease.acquire, {
    ...pins,
    holder: crypto.randomUUID(),
    runId: "a".repeat(64),
  });
async function seed(t: ReturnType<typeof setup>) {
  const source = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Lease source",
          email: "lease@example.com",
          emailVerified: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    })
  );
  if (!("_id" in source)) {
    throw new Error("Missing source");
  }
  const teakUserId = String(source._id);
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId,
      email: "lease@example.com",
      emailVerified: true,
    })
  );
  const sourceVersion = await t.query(
    internal.migration.workosImportSource.version,
    { ...pins, teakUserId }
  );
  return { teakUserId, sourceVersion };
}
// Failure modes: simultaneous holders; expired heartbeat takeover; old generation;
// source/key drift; unacknowledged process loss; ambiguous rows; premature flags.
test("one invocation holds authority, even after its heartbeat ages; released generations fence old processes", async () => {
  const t = setup(),
    first = await acquire(t);
  await expect(acquire(t)).rejects.toThrow("already active");
  await t.run(async (ctx) => {
    const row = await ctx.db.query("workosImportLeases").first();
    if (!row) {
      throw new Error("Missing lease");
    }
    await ctx.db.patch("workosImportLeases", row._id, { heartbeatAt: 0 });
  });
  await expect(acquire(t)).rejects.toThrow("already active");
  expect(
    await t.query(internal.migration.workosImportLease.quiescence, pins)
  ).toMatchObject({ ready: false, pendingRemote: false });
  await t.mutation(internal.migration.workosImportLease.release, {
    ...pins,
    ...first,
  });
  const second = await acquire(t);
  expect(second.generation).toBe(first.generation + 1);
  await expect(
    t.mutation(internal.migration.workosImportLease.release, {
      ...pins,
      ...first,
    })
  ).rejects.toThrow("Inactive");
  await t.mutation(internal.migration.workosImportLease.release, {
    ...pins,
    ...second,
  });
  expect(
    await t.query(internal.migration.workosImportLease.quiescence, pins)
  ).toMatchObject({ ready: true, generation: second.generation });
});
test("pending remote intent blocks mapping, release, another holder and cutover until acknowledged", async () => {
  const t = setup(),
    owner = await seed(t),
    writer = await acquire(t);
  await t.mutation(internal.migration.workosImportLease.beginRemote, {
    ...pins,
    ...writer,
    ...owner,
    kind: "create",
  });
  await expect(
    t.mutation(internal.migration.workosImportSource.link, {
      ...pins,
      ...writer,
      ...owner,
      user: {
        id: "user_imported",
        externalId: owner.teakUserId,
        email: "lease@example.com",
        emailVerified: true,
      },
    })
  ).rejects.toThrow("uncertain");
  await expect(
    t.mutation(internal.migration.workosImportLease.release, {
      ...pins,
      ...writer,
    })
  ).rejects.toThrow("uncertain");
  await expect(acquire(t)).rejects.toThrow("already active");
  expect(
    await t.query(internal.migration.workosImportLease.quiescence, pins)
  ).toMatchObject({ ready: false, pendingRemote: true });
  await t.mutation(internal.migration.workosImportLease.acknowledgeRemote, {
    ...pins,
    ...writer,
    ...owner,
  });
  await t.mutation(internal.migration.workosImportLease.release, {
    ...pins,
    ...writer,
  });
  vi.stubEnv("AUTH_PRIMARY", "workos");
  expect(
    await t.query(internal.migration.workosImportLease.quiescence, pins)
  ).toMatchObject({ ready: true, pendingRemote: false });
});
test("unacknowledged provider loss stays denied permanently; old holder cannot resolve uncertainty", async () => {
  const t = setup(),
    owner = await seed(t),
    writer = await acquire(t);
  await t.mutation(internal.migration.workosImportLease.beginRemote, {
    ...pins,
    ...writer,
    ...owner,
    kind: "update",
  });
  await t.mutation(internal.migration.workosImportLease.markUncertain, {
    ...pins,
    ...writer,
  });
  await expect(
    t.mutation(internal.migration.workosImportLease.acknowledgeRemote, {
      ...pins,
      ...writer,
      ...owner,
    })
  ).rejects.toThrow("uncertain");
  await expect(acquire(t)).rejects.toThrow("uncertain");
  expect(
    await t.query(internal.migration.workosImportLease.quiescence, pins)
  ).toEqual({
    ready: false,
    pendingRemote: true,
    generation: writer.generation,
    barrierHeld: false,
  });
});
test("source and credential drift stop authorization before a provider dispatch", async () => {
  const t = setup(),
    owner = await seed(t),
    writer = await acquire(t);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("users").first();
    if (!row) {
      throw new Error("Missing owner");
    }
    await ctx.db.patch("users", row._id, { deletedAt: Date.now() });
  });
  await expect(
    t.mutation(internal.migration.workosImportLease.beginRemote, {
      ...pins,
      ...writer,
      ...owner,
      kind: "create",
    })
  ).rejects.toThrow("source changed");
  expect(
    await t.query(internal.migration.workosImportLease.quiescence, pins)
  ).toMatchObject({ pendingRemote: false });
  vi.stubEnv("WORKOS_API_KEY", crypto.randomUUID());
  await expect(
    t.mutation(internal.migration.workosImportLease.beginRemote, {
      ...pins,
      ...writer,
      ...owner,
      kind: "delete",
    })
  ).rejects.toThrow("credential binding");
});
test("ambiguous lease rows cannot authorize a new holder or a clear cutover barrier", async () => {
  const t = setup();
  await acquire(t);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("workosImportLeases").first();
    if (!row) {
      throw new Error("Missing lease");
    }
    const { _id, _creationTime, ...copy } = row;
    await ctx.db.insert("workosImportLeases", copy);
  });
  await expect(acquire(t)).rejects.toThrow("Ambiguous");
  await expect(
    t.query(internal.migration.workosImportLease.quiescence, pins)
  ).rejects.toThrow("Ambiguous");
});

test("concurrent admissions for the same journal authorize exactly one invocation", async () => {
  const t = setup();
  const results = await Promise.allSettled([acquire(t), acquire(t)]);
  expect(
    results.filter((result) => result.status === "fulfilled")
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1
  );
  expect(
    await t.run((ctx) => ctx.db.query("workosImportLeases").take(2))
  ).toHaveLength(1);
});

test("durable quiescence closes the query-to-flag race and survives a primary-mode flip", async () => {
  const t = setup();
  const request = {
    ...pins,
    holder: crypto.randomUUID(),
    runId: "b".repeat(64),
  };
  await expect(
    t.mutation(
      internal.migration.workosImportLease.establishQuiescence,
      request
    )
  ).rejects.toThrow("paused");
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
  const held = await t.mutation(
    internal.migration.workosImportLease.establishQuiescence,
    request
  );
  expect(
    await t.mutation(
      internal.migration.workosImportLease.establishQuiescence,
      request
    )
  ).toEqual(held);
  expect(
    await t.query(internal.migration.workosImportLease.quiescence, pins)
  ).toMatchObject({ barrierHeld: true, pendingRemote: false });
  await expect(acquire(t)).rejects.toThrow("already active");
  await expect(
    t.mutation(internal.migration.workosImportLease.releaseQuiescence, {
      ...pins,
      ...held,
      holder: crypto.randomUUID(),
    })
  ).rejects.toThrow("not held");
  vi.stubEnv("AUTH_PRIMARY", "workos");
  expect(
    await t.query(internal.migration.workosImportLease.verifyQuiescence, {
      ...pins,
      ...held,
    })
  ).toBeNull();
  await t.mutation(internal.migration.workosImportLease.releaseQuiescence, {
    ...pins,
    ...held,
  });
  await expect(
    t.query(internal.migration.workosImportLease.verifyQuiescence, {
      ...pins,
      ...held,
    })
  ).rejects.toThrow("not held");
});
test("barrier cannot replace active or uncertain writer intent", async () => {
  const t = setup(),
    owner = await seed(t),
    writer = await acquire(t);
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
  const request = {
    ...pins,
    holder: crypto.randomUUID(),
    runId: "b".repeat(64),
  };
  await expect(
    t.mutation(
      internal.migration.workosImportLease.establishQuiescence,
      request
    )
  ).rejects.toThrow("cannot drain");
  await t.mutation(internal.migration.workosImportLease.beginRemote, {
    ...pins,
    ...writer,
    ...owner,
    kind: "create",
  });
  await t.mutation(internal.migration.workosImportLease.markUncertain, {
    ...pins,
    ...writer,
  });
  await expect(
    t.mutation(
      internal.migration.workosImportLease.establishQuiescence,
      request
    )
  ).rejects.toThrow("cannot drain");
});

test("barrier ownership, credential pins and pause cannot drift before release", async () => {
  const t = setup();
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
  const held = await t.mutation(
    internal.migration.workosImportLease.establishQuiescence,
    {
      ...pins,
      holder: crypto.randomUUID(),
      runId: "c".repeat(64),
    }
  );
  await expect(
    t.mutation(internal.migration.workosImportLease.releaseQuiescence, {
      ...pins,
      ...held,
      generation: held.generation + 1,
    })
  ).rejects.toThrow("not held");
  vi.stubEnv("SIGNUPS_DISABLED", "false");
  await expect(
    t.mutation(internal.migration.workosImportLease.releaseQuiescence, {
      ...pins,
      ...held,
    })
  ).rejects.toThrow("frozen signups");
  vi.stubEnv("SIGNUPS_DISABLED", "true");
  vi.stubEnv("WORKOS_API_KEY", crypto.randomUUID());
  await expect(
    t.query(internal.migration.workosImportLease.verifyQuiescence, {
      ...pins,
      ...held,
    })
  ).rejects.toThrow("credential binding");
  expect(
    await t.run((ctx) => ctx.db.query("workosImportLeases").first())
  ).toMatchObject({ status: "quiesced", generation: held.generation });
});

test("a simultaneous writer and barrier cannot both receive authority", async () => {
  const t = setup();
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
  const results = await Promise.allSettled([
    acquire(t),
    t.mutation(internal.migration.workosImportLease.establishQuiescence, {
      ...pins,
      holder: crypto.randomUUID(),
      runId: "d".repeat(64),
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled")
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1
  );
  expect(
    await t.run((ctx) => ctx.db.query("workosImportLeases").take(2))
  ).toHaveLength(1);
});
