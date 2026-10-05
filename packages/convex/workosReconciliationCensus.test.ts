/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const setup = () => {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  return t;
};
const identity = {
  environmentId: "environment_expected",
  clientId: "client_expected",
  apiKeyFingerprint:
    "0cd3cf5f74c92c94559c4397065417ee80f45c5115d28889b9872049ea5533aa",
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", identity.environmentId);
  vi.stubEnv("WORKOS_CLIENT_ID", identity.clientId);
  vi.stubEnv("WORKOS_API_KEY", "test-workos-reconciliation-key");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function start(t: ReturnType<typeof setup>) {
  const runId = await t.mutation(internal.workosReconciliation.admit, {
    ...identity,
    runKey: "census",
    providerWitnessUserId: "user_witness",
    mode: "audit",
    rangeStart: new Date(Date.now() - 86_400_000).toISOString(),
    rangeEnd: new Date().toISOString(),
  });
  await t.run((ctx) =>
    ctx.db.patch("workosReconciliationRuns", runId, { phase: "census" })
  );
  return runId;
}
// Failure modes: unmapped owners skipped; global quarantine hidden by reason;
// cross-page duplicate email/provider ids; historical scans shown as zero;
// repeated checkpoint double-counting; key rotation mid-page.
test("counts missing mappings, duplicate identities and all unresolved quarantine across pages while preserving vaults", async () => {
  const t = setup();
  await t.run(async (ctx) => {
    for (let i = 0; i < 25; i++) {
      await ctx.db.insert("users", {
        teakUserId: `owner_${i}`,
        email: `${i}@example.com`,
        emailVerified: true,
      });
    }
    for (let i = 0; i < 2; i++) {
      await ctx.db.insert("users", {
        teakUserId: `dup_${i}`,
        email: "same@example.com",
        emailVerified: true,
        workosUserId: "same_provider",
      });
    }
    for (let i = 0; i < 25; i++) {
      await ctx.db.insert("migrationQuarantine", {
        email: `${i}@example.com`,
        reason: "unknown_future_reason",
        source: "preflight",
        createdAt: Date.now(),
      });
    }
    await ctx.db.insert("cards", {
      userId: "owner_0",
      type: "text",
      content: "Keep vault",
      createdAt: 1,
      updatedAt: 1,
    });
  });
  const runId = await start(t);
  for (let i = 0; i < 10; i++) {
    const run = await t.mutation(internal.workosReconciliation.claim, {
      ...identity,
      runId,
    });
    if (!run) {
      break;
    }
    await t.mutation(internal.workosReconciliationCensus.checkpoint, {
      runId,
      generation: run.generation,
    });
  }
  expect(
    await t.query(internal.workosReconciliationCensus.readiness, { runId })
  ).toMatchObject({
    complete: true,
    zero: false,
    counts: {
      ownerRowsScanned: 27,
      missingWorkosMapping: 25,
      duplicateEmailRows: 2,
      duplicateWorkosMappingRows: 2,
      unresolvedQuarantine: 25,
      missingBetterAuthOwner: 27,
    },
  });
  expect(await t.run((ctx) => ctx.db.query("cards").take(10))).toMatchObject([
    { userId: "owner_0", content: "Keep vault" },
  ]);
  expect(await t.run((ctx) => ctx.db.query("users").take(100))).toHaveLength(
    27
  );
});
test("old complete scans and repair completion do not prove zero", async () => {
  const t = setup(),
    runId = await start(t);
  await t.run((ctx) =>
    ctx.db.patch("workosReconciliationRuns", runId, {
      phase: "complete",
      censusVersion: undefined,
    })
  );
  expect(
    await t.query(internal.workosReconciliationCensus.readiness, { runId })
  ).toMatchObject({ complete: false, zero: false });
  await t.run((ctx) =>
    ctx.db.patch("workosReconciliationRuns", runId, {
      mode: "repair",
      censusVersion: 1,
      censusComplete: true,
    })
  );
  expect(
    await t.query(internal.workosReconciliationCensus.readiness, { runId })
  ).toMatchObject({ complete: false, zero: false });
});
test("rejects redelivered pages and rotated credentials", async () => {
  const t = setup(),
    runId = await start(t);
  const run = await t.mutation(internal.workosReconciliation.claim, {
    ...identity,
    runId,
  });
  if (!run) {
    throw new Error("Run not claimed");
  }
  await t.mutation(internal.workosReconciliationCensus.checkpoint, {
    runId,
    generation: run.generation,
  });
  await expect(
    t.mutation(internal.workosReconciliationCensus.checkpoint, {
      runId,
      generation: run.generation,
    })
  ).rejects.toThrow("Inactive");
  const next = await t.mutation(internal.workosReconciliation.claim, {
    ...identity,
    runId,
  });
  if (!next) {
    throw new Error("Run not claimed");
  }
  vi.stubEnv("WORKOS_API_KEY", "rotated-census-test-key");
  await expect(
    t.mutation(internal.workosReconciliationCensus.checkpoint, {
      runId,
      generation: next.generation,
    })
  ).rejects.toThrow("credential mismatch");
});

test("unset and off schedules do not start a run; repair cannot be scheduled", async () => {
  const t = setup();
  vi.stubEnv("WORKOS_RECONCILIATION_MODE", "");
  expect(
    await t.action(internal.workosReconciliationSchedule.dailyAudit, {})
  ).toEqual({ status: "disabled" });
  vi.stubEnv("WORKOS_RECONCILIATION_MODE", "off");
  expect(
    await t.action(internal.workosReconciliationSchedule.dailyAudit, {})
  ).toEqual({ status: "disabled" });
  expect(
    await t.run((ctx) => ctx.db.query("workosReconciliationRuns").take(10))
  ).toEqual([]);
  vi.stubEnv("WORKOS_RECONCILIATION_MODE", "repair");
  await expect(
    t.action(internal.workosReconciliationSchedule.dailyAudit, {})
  ).rejects.toThrow("only permits audit");
});

test("completed repairs do not advance the audit watermark; repeated dispatch resumes one audit", async () => {
  const t = setup(),
    repairId = await start(t);
  await t.run((ctx) =>
    ctx.db.patch("workosReconciliationRuns", repairId, {
      phase: "complete",
      mode: "repair",
      rangeEnd: new Date(
        Math.floor(Date.now() / 86_400_000) * 86_400_000
      ).toISOString(),
    })
  );
  vi.stubEnv("WORKOS_RECONCILIATION_MODE", "audit");
  vi.stubEnv("WORKOS_RECONCILIATION_WITNESS_ID", "user_witness");
  vi.stubGlobal("fetch", (input: string | URL | Request) => {
    const path = new URL(input instanceof Request ? input.url : String(input))
      .pathname;
    if (path === "/user_management/users/user_witness") {
      return Promise.resolve(
        Response.json({
          object: "user",
          id: "user_witness",
          email: "witness@example.com",
          email_verified: true,
          external_id: null,
          first_name: null,
          last_name: null,
          profile_picture_url: null,
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-02T00:00:00Z",
          last_sign_in_at: null,
        })
      );
    }
    if (path === "/events" || path === "/user_management/users") {
      return Promise.resolve(
        Response.json({
          data: [],
          list_metadata: { before: null, after: null },
        })
      );
    }
    throw new Error(`Unexpected provider path ${path}`);
  });
  const first = await t.action(
    internal.workosReconciliationSchedule.dailyAudit,
    {}
  );
  expect(first.status).toBe("admitted");
  expect(first.runId).not.toBe(repairId);
  const second = await t.action(
    internal.workosReconciliationSchedule.dailyAudit,
    {}
  );
  expect(second).toEqual({ status: "resumed", runId: first.runId });
  const runs = await t.run((ctx) =>
    ctx.db.query("workosReconciliationRuns").take(10)
  );
  expect(runs).toHaveLength(2);
  expect(runs.find((run) => run._id === first.runId)?.mode).toBe("audit");
});

test("explicit WorkOS-origin owners are distinguished from unproven missing Better Auth owners", async () => {
  const t = setup();
  vi.stubEnv("AUTH_PRIMARY", "workos");
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      identityOrigin: "workos",
      teakUserId: "native_owner",
      email: "native@example.com",
      emailVerified: true,
      workosUserId: "user_native",
    });
    await ctx.db.insert("users", {
      teakUserId: "unproven_owner",
      email: "old@example.com",
      emailVerified: true,
      workosUserId: "user_old",
    });
  });
  const runId = await start(t),
    run = await t.mutation(internal.workosReconciliation.claim, {
      ...identity,
      runId,
    });
  if (!run) {
    throw new Error("Run not claimed");
  }
  await t.mutation(internal.workosReconciliationCensus.checkpoint, {
    runId,
    generation: run.generation,
  });
  expect(
    (await t.query(internal.workosReconciliationCensus.readiness, { runId }))
      .counts
  ).toMatchObject({ workosOriginOwners: 1, missingBetterAuthOwner: 1 });
});
