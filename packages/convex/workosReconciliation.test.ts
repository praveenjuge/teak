/// <reference types="vite/client" />
import authKitTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const setup = () => {
  const t = convexTest(schema, modules);
  authKitTest.register(t);
  return t;
};
type Backend = ReturnType<typeof setup>;
const environmentId = "environment_expected",
  clientId = "client_expected";
const admission = {
  environmentId,
  clientId,
  apiKeyFingerprint: "fingerprint",
  runKey: "run_one",
  providerWitnessUserId: "user_witness",
  mode: "repair" as const,
  rangeStart: "2026-10-01T00:00:00Z",
  rangeEnd: "2026-10-02T00:00:00Z",
};
const userId = "user_missing";
const seed = (t: Backend) =>
  t.run(async (ctx) => {
    await ctx.db.insert("users", {
      teakUserId: "owner",
      email: "legacy@example.com",
      emailVerified: true,
      workosUserId: userId,
      workosEmail: "provider@example.com",
      workosEmailVerified: true,
    });
    await ctx.db.insert("cards", {
      userId: "owner",
      type: "text",
      content: "Preserve vault",
      createdAt: 1,
      updatedAt: 1,
    });
  });
const read = (t: Backend) =>
  t.run(async (ctx) => ({
    users: await ctx.db.query("users").take(10),
    profiles: await ctx.db.query("workosProfiles").take(10),
    cards: await ctx.db.query("cards").take(10),
    events: await ctx.db.query("workosEvents").take(10),
    runs: await ctx.db.query("workosReconciliationRuns").take(10),
  }));
async function claim(t: Backend, fields: Partial<typeof admission> = {}) {
  const runId = await t.mutation(internal.workosReconciliation.admit, {
    ...admission,
    ...fields,
  });
  const run = await t.mutation(internal.workosReconciliation.claim, {
    runId,
    environmentId,
    clientId,
    apiKeyFingerprint: admission.apiKeyFingerprint,
  });
  if (!run) {
    throw new Error("Run not claimed");
  }
  return run as Doc<"workosReconciliationRuns">;
}
const page = (run: Doc<"workosReconciliationRuns">) => ({
  environmentId,
  clientId,
  apiKeyFingerprint: admission.apiKeyFingerprint,
  runId: run._id,
  generation: run.generation,
  phase: "events" as const,
  done: true,
  observations: [],
  events: [],
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", environmentId);
  vi.stubEnv("WORKOS_CLIENT_ID", clientId);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("durable reconciliation", () => {
  test("commits absence denial and cursor atomically while preserving the vault and original receipt ledger", async () => {
    const t = setup();
    await seed(t);
    const run = await claim(t);
    await t.run((ctx) =>
      ctx.db.patch("workosReconciliationRuns", run._id, { phase: "owners" })
    );
    const expectedState = await t.query(
      internal.workosProfileApply.captureWorkosProfileState,
      { workosUserId: userId }
    );
    await t.mutation(internal.workosReconciliation.checkpoint, {
      ...page(run),
      phase: "owners",
      observations: [
        { workosUserId: userId, expectedState, state: { kind: "deleted" } },
      ],
    });
    const state = await read(t);
    expect(state.users[0].workosEmailVerified).toBe(false);
    expect(state.users[0].workosDeletedAt).toBeTypeOf("number");
    expect(state.profiles[0].deletionSource).toBe("reconciliation_not_found");
    expect(state.runs[0].phase).toBe("complete");
    expect(state.cards).toHaveLength(1);
    expect(state.events).toEqual([]);
  });
  test("audit checkpoints never write profile, ownership or denial state", async () => {
    const t = setup();
    await seed(t);
    const before = await read(t);
    const run = await claim(t, { mode: "audit" as never });
    const expectedState = await t.query(
      internal.workosProfileApply.captureWorkosProfileState,
      { workosUserId: userId }
    );
    await t.mutation(internal.workosReconciliation.checkpoint, {
      ...page(run),
      observations: [
        { workosUserId: userId, expectedState, state: { kind: "deleted" } },
      ],
    });
    const after = await read(t);
    expect(after.users).toEqual(before.users);
    expect(after.profiles).toEqual(before.profiles);
    expect(after.events).toEqual([]);
  });
  test("a concurrent owner change rolls back both profile writes and checkpoint", async () => {
    const t = setup();
    await seed(t);
    const run = await claim(t);
    const expectedState = await t.query(
      internal.workosProfileApply.captureWorkosProfileState,
      { workosUserId: userId }
    );
    await t.run(async (ctx) => {
      const row = await ctx.db.query("users").first();
      await ctx.db.patch("users", row!._id, {
        workosEmail: "newer@example.com",
      });
    });
    await expect(
      t.mutation(internal.workosReconciliation.checkpoint, {
        ...page(run),
        observations: [
          { workosUserId: userId, expectedState, state: { kind: "deleted" } },
        ],
      })
    ).rejects.toThrow("state_changed");
    const state = await read(t);
    expect(state.profiles).toEqual([]);
    expect(state.runs[0].phase).toBe("events");
    expect(state.users[0].workosDeletedAt).toBeUndefined();
  });
  test("expired workers cannot commit after a new generation claims the durable page", async () => {
    const t = setup();
    const first = await claim(t);
    await t.run((ctx) =>
      ctx.db.patch("workosReconciliationRuns", first._id, { leaseUntil: 0 })
    );
    const second = await t.mutation(internal.workosReconciliation.claim, {
      runId: first._id,
      environmentId,
      clientId,
      apiKeyFingerprint: admission.apiKeyFingerprint,
    });
    expect(second?.generation).toBe(first.generation + 1);
    await expect(
      t.mutation(internal.workosReconciliation.checkpoint, page(first))
    ).rejects.toThrow("lease");
    expect((await read(t)).runs[0].phase).toBe("events");
  });
  test("rate limiting leaves the cursor resumable and blocks early retries", async () => {
    const t = setup();
    const run = await claim(t);
    await t.mutation(internal.workosReconciliation.interruption, {
      runId: run._id,
      generation: run.generation,
      retryDelayMs: 60_000,
      reason: "provider_429",
    });
    const state = (await read(t)).runs[0];
    expect(state.phase).toBe("events");
    expect(state.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(
      await t.mutation(internal.workosReconciliation.claim, {
        runId: run._id,
        environmentId,
        clientId,
        apiKeyFingerprint: admission.apiKeyFingerprint,
      })
    ).toBeNull();
  });
  test("changed environment or credential fingerprint cannot resume or overlap a run", async () => {
    const t = setup();
    const run = await claim(t);
    await expect(
      t.mutation(internal.workosReconciliation.claim, {
        runId: run._id,
        environmentId,
        clientId,
        apiKeyFingerprint: "other",
      })
    ).rejects.toThrow("mismatch");
    await expect(
      t.mutation(internal.workosReconciliation.admit, {
        ...admission,
        runKey: "other",
      })
    ).rejects.toThrow("already active");
  });
  test("repeating an earlier cursor cannot truncate a multi-page run", async () => {
    const t = setup();
    const run = await claim(t);
    await t.mutation(internal.workosReconciliation.checkpoint, {
      ...page(run),
      done: false,
      nextCursor: "cursor_a",
    });
    await t.run((ctx) =>
      ctx.db.patch("workosReconciliationRuns", run._id, {
        leaseUntil: Date.now() + 10_000,
      })
    );
    await t.mutation(internal.workosReconciliation.checkpoint, {
      ...page(run),
      done: false,
      cursor: "cursor_a",
      nextCursor: "cursor_b",
    });
    await t.run((ctx) =>
      ctx.db.patch("workosReconciliationRuns", run._id, {
        leaseUntil: Date.now() + 10_000,
      })
    );
    await expect(
      t.mutation(internal.workosReconciliation.checkpoint, {
        ...page(run),
        done: false,
        cursor: "cursor_b",
        nextCursor: "cursor_a",
      })
    ).rejects.toThrow("cursor");
    expect((await read(t)).runs[0].eventCursor).toBe("cursor_b");
  });
});

// The network is the only mocked boundary: the installed WorkOS SDK parses the
// real HTTP responses, including its definitive NotFoundException semantics.
const remoteUser = (id: string) => ({
  object: "user",
  id,
  email: "provider@example.com",
  email_verified: true,
  external_id: "owner",
  first_name: "Current",
  last_name: null,
  profile_picture_url: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
  last_sign_in_at: null,
});
async function sdkOwnerRun(
  t: Backend,
  missingStatus: number,
  witnessStatus = 200,
  rotateCredentials = false
) {
  vi.stubEnv("WORKOS_API_KEY", "sk_test_reconciliation");
  let ownerRequested = false;
  vi.stubGlobal("fetch", (input: string | URL) =>
    Promise.resolve().then(() => {
      const path = new URL(String(input)).pathname;
      if (path === `/user_management/users/${userId}`) {
        ownerRequested = true;
        if (rotateCredentials) {
          vi.stubEnv("WORKOS_API_KEY", "sk_rotated");
        }
        return new Response(JSON.stringify({ message: "Provider error" }), {
          status: missingStatus,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path === "/user_management/users/user_witness") {
        return new Response(
          JSON.stringify(
            ownerRequested && witnessStatus !== 200
              ? { message: "Witness refused" }
              : remoteUser("user_witness")
          ),
          {
            status: ownerRequested ? witnessStatus : 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      if (path === "/events") {
        return Response.json({
          data: [],
          list_metadata: { before: null, after: null },
        });
      }
      throw new Error(`Unexpected provider path ${path}`);
    })
  );
  const { apiKeyFingerprint: _fingerprint, ...args } = admission;
  const runId = await t.action(
    internal.workosReconciliationActions.start,
    args
  );
  await t.run((ctx) =>
    ctx.db.patch("workosReconciliationRuns", runId, {
      phase: "owners",
      leaseUntil: 0,
    })
  );
  await t.action(internal.workosReconciliationActions.resume, { runId });
  return read(t);
}

describe("reconciliation failure boundaries", () => {
  test("audit records missing canonical state, profile and mirror drift without mutating owners", async () => {
    const t = setup();
    await seed(t);
    const before = await read(t);
    const run = await claim(t, { mode: "audit" as never });
    await t.run((ctx) =>
      ctx.db.patch("workosReconciliationRuns", run._id, { phase: "provider" })
    );
    const expectedState = await t.query(
      internal.workosProfileApply.captureWorkosProfileState,
      { workosUserId: userId }
    );
    await t.mutation(internal.workosReconciliation.checkpoint, {
      ...page(run),
      phase: "provider",
      observations: [
        {
          workosUserId: userId,
          expectedState,
          state: {
            kind: "active",
            providerUpdatedAt: "2026-10-02T00:00:00Z",
            profile: {
              email: "changed@example.com",
              emailVerified: false,
              externalId: "owner",
              firstName: "Current",
              lastName: null,
              profilePictureUrl: null,
            },
          },
        },
      ],
    });
    const after = await read(t);
    expect(after.runs[0].drifted).toBe(1);
    expect(after.runs[0].auditEvidence).toEqual([
      {
        workosUserId: userId,
        reasons: ["canonical_profile_missing", "mirror_difference"],
      },
    ]);
    expect(after.users).toEqual(before.users);
    expect(after.profiles).toEqual([]);
    expect(after.events).toEqual([]);
  });
  test.each([null, "link_conflict", "profile_pending", "terminal_receipt"])(
    "audit compares normalized provider versions and finds conflicts beyond resolved rows (%s)",
    async (conflict) => {
      const t = setup();
      await seed(t);
      const profile = {
        email: "provider@example.com",
        emailVerified: true,
        externalId: "owner",
        firstName: "Current",
        lastName: null,
        profilePictureUrl: null,
      };
      await t.run(async (ctx) => {
        await ctx.db.insert("workosProfiles", {
          workosUserId: userId,
          teakUserId: "owner",
          profile,
          providerUpdatedAt: "2026-10-02T00:00:00Z",
          revision: 1,
          source: "event",
        });
        if (conflict === "terminal_receipt") {
          await ctx.db.insert("workosEvents", {
            eventId: "evt_terminal",
            workosUserId: userId,
            type: "user.deleted",
            createdAt: 1,
          });
        } else if (conflict) {
          for (let n = 0; n < 25; n += 1) {
            await ctx.db.insert("migrationQuarantine", {
              workosUserId: userId,
              email: profile.email,
              reason: "ambiguous_email",
              source: "test",
              createdAt: 1,
              resolvedAt: 2,
            });
          }
          await ctx.db.insert("migrationQuarantine", {
            workosUserId: userId,
            email: profile.email,
            reason: conflict,
            source: "test",
            createdAt: 3,
          });
        }
      });
      const run = await claim(t, { mode: "audit" as never });
      await t.run((ctx) =>
        ctx.db.patch("workosReconciliationRuns", run._id, { phase: "provider" })
      );
      const expectedState = await t.query(
        internal.workosProfileApply.captureWorkosProfileState,
        { workosUserId: userId }
      );
      await t.mutation(internal.workosReconciliation.checkpoint, {
        ...page(run),
        phase: "provider",
        observations: [
          {
            workosUserId: userId,
            expectedState,
            state: {
              kind: "active",
              providerUpdatedAt: "2026-10-02T05:30:00.000+05:30",
              profile,
            },
          },
        ],
      });
      const report = (await read(t)).runs[0];
      expect(report.drifted).toBe(conflict ? 1 : 0);
      expect(report.auditEvidence).toEqual(
        conflict
          ? [
              {
                workosUserId: userId,
                reasons: [
                  conflict === "terminal_receipt"
                    ? "local_terminal_provider_active"
                    : "unresolved_quarantine",
                ],
              },
            ]
          : []
      );
    }
  );
  test("audit bounds evidence while continuing to count every drifted observation", async () => {
    const t = setup();
    const run = await claim(t, { mode: "audit" as never });
    await t.run((ctx) =>
      ctx.db.patch("workosReconciliationRuns", run._id, { phase: "provider" })
    );
    for (let batch = 0; batch < 2; batch += 1) {
      const observations: {
        workosUserId: string;
        expectedState: { fingerprint: string; externalId: string | null };
        state: { kind: "deleted" };
      }[] = [];
      for (let n = 0; n < (batch === 0 ? 20 : 1); n += 1) {
        const workosUserId = `user_${batch}_${n}`;
        const expectedState = await t.query(
          internal.workosProfileApply.captureWorkosProfileState,
          { workosUserId }
        );
        observations.push({
          workosUserId,
          expectedState,
          state: { kind: "deleted" as const },
        });
      }
      await t.run((ctx) =>
        ctx.db.patch("workosReconciliationRuns", run._id, {
          leaseUntil: Date.now() + 10_000,
        })
      );
      await t.mutation(internal.workosReconciliation.checkpoint, {
        ...page(run),
        phase: "provider",
        done: batch === 1,
        ...(batch === 0 ? { nextCursor: "next" } : { cursor: "next" }),
        observations,
      });
    }
    const report = await t.query(internal.workosReconciliation.report, {
      runId: run._id,
    });
    expect(report?.drifted).toBe(21);
    expect(report?.auditEvidence).toHaveLength(20);
    expect(report?.scanned).toBe(21);
    expect(report?.phase).toBe("owners");
    expect((await read(t)).profiles).toEqual([]);
  });
  test("a changed backend environment blocks a leased audit checkpoint independently of profile application", async () => {
    const t = setup();
    const run = await claim(t, { mode: "audit" as never });
    vi.stubEnv("WORKOS_CLIENT_ID", "client_changed");
    await expect(
      t.mutation(internal.workosReconciliation.checkpoint, page(run))
    ).rejects.toThrow("environment mismatch");
    expect((await read(t)).runs[0].phase).toBe("events");
  });
  test("an admitted credential mismatch rejects checkpoint without changing progress", async () => {
    const t = setup();
    const run = await claim(t);
    await expect(
      t.mutation(internal.workosReconciliation.checkpoint, {
        ...page(run),
        apiKeyFingerprint: "rotated",
      })
    ).rejects.toThrow("credential mismatch");
    expect((await read(t)).runs[0].scanned).toBe(0);
  });
  test("lease expiry alone blocks a page even without a successor generation", async () => {
    const t = setup();
    const run = await claim(t);
    await t.run((ctx) =>
      ctx.db.patch("workosReconciliationRuns", run._id, {
        leaseUntil: Date.now() - 1,
      })
    );
    await expect(
      t.mutation(internal.workosReconciliation.checkpoint, page(run))
    ).rejects.toThrow("lease");
    expect((await read(t)).runs[0].eventCursor).toBeUndefined();
  });
  test("hard crashes leave an expiry wakeup and the last committed cursor reclaimable", async () => {
    const t = setup();
    const first = await claim(t);
    await t.mutation(internal.workosReconciliation.checkpoint, {
      ...page(first),
      done: false,
      nextCursor: "committed",
    });
    const second = await t.mutation(internal.workosReconciliation.claim, {
      runId: first._id,
      environmentId,
      clientId,
      apiKeyFingerprint: admission.apiKeyFingerprint,
    });
    if (!second) {
      throw new Error("No second worker");
    }
    const wakeups = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(10)
    );
    expect(wakeups.some((job) => job.scheduledTime >= second.leaseUntil)).toBe(
      true
    );
    // A process disappearance never reaches interruption; expiry itself is enough.
    await t.run((ctx) =>
      ctx.db.patch("workosReconciliationRuns", first._id, { leaseUntil: 0 })
    );
    const successor = await t.mutation(internal.workosReconciliation.claim, {
      runId: first._id,
      environmentId,
      clientId,
      apiKeyFingerprint: admission.apiKeyFingerprint,
    });
    expect(successor?.eventCursor).toBe("committed");
    expect(successor?.generation).toBe(second.generation + 1);
  });
  test("replaying original created events records receipts without creating owners or vault contents", async () => {
    const t = setup();
    const run = await claim(t);
    const envelope = {
      id: "evt_original",
      createdAt: "2026-10-02T00:00:00Z",
      event: "user.created" as const,
      data: {
        id: "user_new",
        email: "new@example.com",
        emailVerified: true,
        externalId: null,
        firstName: null,
        lastName: null,
        profilePictureUrl: null,
        metadata: {},
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-02T00:00:00Z",
      },
    };
    await t.mutation(internal.workosReconciliation.checkpoint, {
      ...page(run),
      events: [envelope, envelope],
    });
    const state = await read(t);
    expect(state.events).toHaveLength(1);
    expect(state.events[0].eventId).toBe("evt_original");
    expect(state.users).toEqual([]);
    expect(state.cards).toEqual([]);
    expect(state.profiles[0].profile?.email).toBe("new@example.com");
    expect(state.runs[0].phase).toBe("provider");
  });
  test("provider traversal captures an unmapped external owner before the direct GET", async () => {
    const t = setup();
    vi.stubEnv("WORKOS_API_KEY", "sk_test_reconciliation");
    await t.run((ctx) =>
      ctx.db.insert("users", {
        teakUserId: "owner",
        email: "provider@example.com",
        emailVerified: true,
      })
    );
    vi.stubGlobal("fetch", (input: string | URL) =>
      Promise.resolve().then(() => {
        const path = new URL(String(input)).pathname;
        if (path === "/events") {
          return Response.json({
            data: [],
            list_metadata: { before: null, after: null },
          });
        }
        if (path === "/user_management/users") {
          return Response.json({
            data: [remoteUser(userId)],
            list_metadata: { before: null, after: null },
          });
        }
        if (path === `/user_management/users/${userId}`) {
          return Response.json(remoteUser(userId));
        }
        if (path === "/user_management/users/user_witness") {
          return Response.json(remoteUser("user_witness"));
        }
        throw new Error(`Unexpected provider path ${path}`);
      })
    );
    const { apiKeyFingerprint: _fingerprint, ...args } = admission;
    const runId = await t.action(
      internal.workosReconciliationActions.start,
      args
    );
    await t.action(internal.workosReconciliationActions.resume, { runId });
    const state = await read(t);
    expect(state.runs[0].phase).toBe("owners");
    expect(state.runs[0].repaired).toBe(1);
    expect(state.users).toHaveLength(1);
    expect(state.users[0]).toMatchObject({
      teakUserId: "owner",
      workosUserId: userId,
    });
    expect(state.profiles[0]).toMatchObject({
      teakUserId: "owner",
      profile: { externalId: "owner" },
    });
    expect(state.events).toEqual([]);
  });
  test("direct SDK 404 plus a successful credential-bound witness records absence without vault deletion", async () => {
    const t = setup();
    await seed(t);
    const state = await sdkOwnerRun(t, 404);
    expect(state.runs[0].phase).toBe("complete");
    expect(state.runs[0].deleted).toBe(1);
    expect(state.profiles[0].deletionSource).toBe("reconciliation_not_found");
    expect(state.users[0].workosEmailVerified).toBe(false);
    expect(state.cards).toHaveLength(1);
    expect(state.events).toEqual([]);
  });
  test.each([401, 403, 429, 500])(
    "GET %s never proves provider absence",
    async (status) => {
      const t = setup();
      await seed(t);
      const state = await sdkOwnerRun(t, status);
      expect(state.profiles).toEqual([]);
      expect(state.users[0].workosEmailVerified).toBe(true);
      expect(state.users[0].workosDeletedAt).toBeUndefined();
      expect(state.cards).toHaveLength(1);
      expect(state.runs[0].phase).toBe(
        status === 429 || status >= 500 ? "owners" : "failed"
      );
    }
  );
  test("a provider 404 with a failing pinned witness cannot mark owners absent", async () => {
    const t = setup();
    await seed(t);
    const state = await sdkOwnerRun(t, 404, 403);
    expect(state.runs[0].phase).toBe("failed");
    expect(state.profiles).toEqual([]);
    expect(state.users[0].workosDeletedAt).toBeUndefined();
  });
  test("credential rotation between direct GET and checkpoint aborts absence commitment", async () => {
    const t = setup();
    await seed(t);
    const state = await sdkOwnerRun(t, 404, 200, true);
    expect(state.runs[0].phase).toBe("failed");
    expect(state.profiles).toEqual([]);
    expect(state.users[0].workosDeletedAt).toBeUndefined();
  });
});
