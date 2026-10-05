/// <reference types="vite/client" />
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { components, internal } from "./_generated/api";
import schema from "./schema";
import {
  currentWorkosDeletionTarget,
  expectedWorkosDeletionResolution,
} from "./workosDeletionCompletion";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "environment_DELETE");
  vi.stubEnv("WORKOS_CLIENT_ID", "client_DELETE");
  vi.stubEnv("WORKOS_API_KEY", "test-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function fixture(stage = 6) {
  const t = convexTest(schema, modules);
  const target = (await currentWorkosDeletionTarget())!;
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      teakUserId: "owner",
      workosUserId: "user_DELETE",
      email: "owner@example.com",
      emailVerified: true,
      workosDeletedAt: 2000,
    });
    const stateId = await ctx.db.insert("accountDeletionStates", {
      userId: "owner",
      workosUserId: "user_DELETE",
      startedAt: 1000,
      generation: 1,
      stage,
      workosTarget: target,
    });
    return { ownerId, stateId };
  });
  const receipt = {
    workosUserId: "user_DELETE",
    teakUserId: "owner",
    email: "",
    reason: "workos_user_deleted",
    source: "webhook",
    createdAt: 3000,
    workosDeletionEventAt: 2000,
    workosDeletionTarget: target,
  };
  return {
    t,
    target,
    receipt,
    ...ids,
    binding: { stateId: ids.stateId, generation: 1 },
  };
}
test("settles only expected receipts after completed cleanup and retains permanent denial", async () => {
  const { t, receipt, ownerId, binding, stateId } = await fixture();
  await t.run((ctx) => ctx.db.insert("migrationQuarantine", receipt));
  expect(
    await t.run((ctx) => expectedWorkosDeletionResolution(ctx, receipt))
  ).toBeNull();
  await t.mutation(internal.accountDeletionJobs.finalize, binding);
  const result = await t.run(async (ctx) => ({
    owner: await ctx.db.get(ownerId),
    state: await ctx.db.get(stateId),
    receipt: await ctx.db.query("migrationQuarantine").unique(),
  }));
  expect(result.state).toBeNull();
  expect(result.owner).toMatchObject({
    deletedAt: expect.any(Number),
    workosDeletedAt: 2000,
    workosDeletionCompletion: {
      version: 1,
      stateId,
      generation: 1,
      workosUserId: "user_DELETE",
    },
  });
  expect(result.receipt?.resolvedAt).toBe(
    result.owner?.workosDeletionCompletion?.completedAt
  );
});
test("late webhook arrival resolves from retained proof despite lost finalize response", async () => {
  const { t, receipt, binding } = await fixture();
  await t.mutation(internal.accountDeletionJobs.finalize, binding);
  const resolution = await t.run((ctx) =>
    expectedWorkosDeletionResolution(ctx, receipt)
  );
  expect(resolution).toEqual(expect.any(Number));
  await expect(
    t.mutation(internal.accountDeletionJobs.finalize, binding)
  ).rejects.toThrow("stale_deletion_stage");
  expect(
    await t.run((ctx) => expectedWorkosDeletionResolution(ctx, receipt))
  ).toBe(resolution);
});
test.each([
  { workosDeletionEventAt: 999 },
  { workosDeletionEventAt: Number.MAX_SAFE_INTEGER },
  { workosDeletionEventAt: undefined },
  { workosDeletionTarget: undefined },
  { teakUserId: "other-owner" },
  { workosUserId: "user_OTHER" },
  { source: "reconciliation" },
  { reason: "verification_conflict" },
])(
  "keeps historical, uncorrelated and unrelated receipt unresolved: %j",
  async (change) => {
    const { t, receipt, binding } = await fixture();
    const row = { ...receipt, ...change };
    const id = await t.run((ctx) => ctx.db.insert("migrationQuarantine", row));
    await t.mutation(internal.accountDeletionJobs.finalize, binding);
    expect((await t.run((ctx) => ctx.db.get(id)))?.resolvedAt).toBeUndefined();
    expect(
      await t.run((ctx) => expectedWorkosDeletionResolution(ctx, row))
    ).toBeNull();
  }
);
test.each([
  "environmentId",
  "clientId",
  "issuer",
  "credentialFingerprint",
] as const)("wrong %s pin refuses settlement", async (pin) => {
  const { t, receipt, binding, target } = await fixture();
  const row = {
    ...receipt,
    workosDeletionTarget: { ...target, [pin]: "wrong" },
  };
  const id = await t.run((ctx) => ctx.db.insert("migrationQuarantine", row));
  await t.mutation(internal.accountDeletionJobs.finalize, binding);
  expect((await t.run((ctx) => ctx.db.get(id)))?.resolvedAt).toBeUndefined();
});
test("key rotation blocks new receipt settlement without erasing completed proof", async () => {
  const { t, receipt, binding, ownerId } = await fixture();
  await t.mutation(internal.accountDeletionJobs.finalize, binding);
  const proof = (await t.run((ctx) => ctx.db.get(ownerId)))
    ?.workosDeletionCompletion;
  vi.stubEnv("WORKOS_API_KEY", "rotated-key");
  expect(
    await t.run((ctx) => expectedWorkosDeletionResolution(ctx, receipt))
  ).toBeNull();
  expect(
    (await t.run((ctx) => ctx.db.get(ownerId)))?.workosDeletionCompletion
  ).toEqual(proof);
});
test.each([0, 3, 4, 5])(
  "unfinished cleanup stage %s cannot mint completion",
  async (stage) => {
    const { t, binding, ownerId, receipt } = await fixture(stage);
    await expect(
      t.mutation(internal.accountDeletionJobs.finalize, binding)
    ).rejects.toThrow("stale_deletion_stage");
    expect(
      (await t.run((ctx) => ctx.db.get(ownerId)))?.workosDeletionCompletion
    ).toBeUndefined();
    expect(
      await t.run((ctx) => expectedWorkosDeletionResolution(ctx, receipt))
    ).toBeNull();
  }
);
test("ambiguous provider mapping refuses completion and later settlement", async () => {
  const { t, receipt, binding } = await fixture();
  await t.mutation(internal.accountDeletionJobs.finalize, binding);
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "other",
      workosUserId: "user_DELETE",
      email: "other@example.com",
      emailVerified: true,
    })
  );
  expect(
    await t.run((ctx) => expectedWorkosDeletionResolution(ctx, receipt))
  ).toBeNull();
  const next = await fixture();
  await next.t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "other",
      workosUserId: "user_DELETE",
      email: "other@example.com",
      emailVerified: true,
    })
  );
  await expect(
    next.t.mutation(internal.accountDeletionJobs.finalize, next.binding)
  ).rejects.toThrow("deletion_workos_target_unavailable");
  expect(
    (await next.t.run((ctx) => ctx.db.get(next.ownerId)))
      ?.workosDeletionCompletion
  ).toBeUndefined();
});
test("bounded settlement continues until all expected receipts finish", async () => {
  const { t, receipt, binding, stateId, ownerId } = await fixture();
  await t.run(async (ctx) => {
    for (let i = 0; i < 205; i++) {
      await ctx.db.insert("migrationQuarantine", receipt);
    }
  });
  await t.mutation(internal.accountDeletionJobs.finalize, binding);
  const initialProof = (await t.run((ctx) => ctx.db.get(ownerId)))
    ?.workosDeletionCompletion;
  expect(await t.run((ctx) => ctx.db.get(stateId))).not.toBeNull();
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(await t.run((ctx) => ctx.db.get(stateId))).toBeNull();
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("migrationQuarantine")
        .withIndex("by_unresolved", (q) => q.eq("resolvedAt", undefined))
        .take(1)
    )
  ).toEqual([]);
  expect(
    (await t.run((ctx) => ctx.db.get(ownerId)))?.workosDeletionCompletion
  ).toEqual(initialProof);
});

test.each(["before", "after"] as const)(
  "real deleted webhook %s finalize settles without reviving the identity",
  async (order) => {
    const { t, binding, ownerId } = await fixture();
    const event = {
      id: "event_DELETE",
      event: "user.deleted" as const,
      createdAt: "1970-01-01T00:00:02.000Z",
      data: { id: "user_DELETE" },
    };
    if (order === "before") {
      await t.mutation(internal.workosLifecycle.applyWorkosEvent, event);
      expect(
        (await t.run((ctx) => ctx.db.query("migrationQuarantine").unique()))
          ?.resolvedAt
      ).toBeUndefined();
    }
    await t.mutation(internal.accountDeletionJobs.finalize, binding);
    if (order === "after") {
      await t.mutation(internal.workosLifecycle.applyWorkosEvent, event);
    }
    expect(
      (await t.run((ctx) => ctx.db.query("migrationQuarantine").unique()))
        ?.resolvedAt
    ).toEqual(expect.any(Number));
    expect((await t.run((ctx) => ctx.db.get(ownerId)))?.deletedAt).toEqual(
      expect.any(Number)
    );
    expect(
      (await t.run((ctx) => ctx.db.query("workosProfiles").unique()))?.deletedAt
    ).toEqual(expect.any(Number));
    expect(
      (await t.run((ctx) => ctx.db.query("workosEvents").unique()))?.type
    ).toBe("user.deleted");
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("migrationQuarantine")
          .withIndex("by_unresolved", (q) => q.eq("resolvedAt", undefined))
          .take(1)
      )
    ).toEqual([]);
    expect(
      await t.mutation(internal.workosUsers.linkWorkosUser, {
        workosUserId: "user_DELETE",
        email: "owner@example.com",
        emailVerified: true,
        externalId: "owner",
        source: "webhook",
        allowCreate: false,
      })
    ).toMatchObject({ status: "quarantined" });
    expect(
      await t.mutation(internal.workosLifecycle.applyWorkosEvent, event)
    ).toEqual({ status: "duplicate" });
  }
);

test("unexpected metadata-free provider deletion stays blocked despite an owner tombstone", async () => {
  const { t, ownerId } = await fixture(3);
  await t.run((ctx) => ctx.db.patch(ownerId, { deletedAt: Date.now() }));
  await t.mutation(internal.workosLifecycle.applyWorkosEvent, {
    id: "event_UNEXPECTED",
    event: "user.deleted",
    createdAt: "1970-01-01T00:00:02.000Z",
    data: { id: "user_DELETE" },
  });
  expect(
    (await t.run((ctx) => ctx.db.query("migrationQuarantine").unique()))
      ?.resolvedAt
  ).toBeUndefined();
  expect(
    (await t.run((ctx) => ctx.db.query("workosProfiles").unique()))?.deletedAt
  ).toEqual(expect.any(Number));
});

test.each([
  "environmentId",
  "clientId",
  "issuer",
  "credentialFingerprint",
] as const)(
  "finalize refuses %s conflict with already retained completion proof",
  async (pin) => {
    const { t, binding, target, stateId, ownerId, receipt } = await fixture();
    await t.run(async (ctx) => {
      for (let i = 0; i < 101; i++) {
        await ctx.db.insert("migrationQuarantine", receipt);
      }
    });
    await t.mutation(internal.accountDeletionJobs.finalize, binding);
    const proof = (await t.run((ctx) => ctx.db.get(ownerId)))
      ?.workosDeletionCompletion;
    await t.run((ctx) =>
      ctx.db.patch(stateId, { workosTarget: { ...target, [pin]: "wrong" } })
    );
    await expect(
      t.mutation(internal.accountDeletionJobs.finalize, binding)
    ).rejects.toThrow("deletion_completion_conflict");
    expect(
      (await t.run((ctx) => ctx.db.get(ownerId)))?.workosDeletionCompletion
    ).toEqual(proof);
    expect(await t.run((ctx) => ctx.db.get(stateId))).not.toBeNull();
  }
);

test("ambiguous permanent owner cannot acquire expected-deletion proof", async () => {
  const { t, binding, ownerId } = await fixture();
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "owner",
      email: "other@example.com",
      emailVerified: true,
    })
  );
  await expect(
    t.mutation(internal.accountDeletionJobs.finalize, binding)
  ).rejects.toThrow("deletion_binding_changed");
  expect(
    (await t.run((ctx) => ctx.db.get(ownerId)))?.workosDeletionCompletion
  ).toBeUndefined();
});

test("redrive resumes failed detached settlement after the workflow completed", async () => {
  const { t, receipt, binding, stateId, ownerId } = await fixture();
  workflowTest.register(t);
  const workflowId = await t.mutation(components.workflow.workflow.create, {
    workflowName: "completed-deletion",
    workflowHandle: "function://account-deletion-test",
    workflowArgs: binding,
    createOnly: true,
  });
  await t.mutation(components.workflow.workflow.complete, {
    workflowId,
    generationNumber: 0,
    runResult: { kind: "success", returnValue: null },
  });
  const unrelated = await t.run(async (ctx) => {
    await ctx.db.patch(stateId, { workflowId, nextAttemptAt: Date.now() - 1 });
    for (let i = 0; i < 205; i++) {
      await ctx.db.insert("migrationQuarantine", receipt);
    }
    return await ctx.db.insert("migrationQuarantine", {
      ...receipt,
      reason: "verification_conflict",
    });
  });
  await t.mutation(internal.accountDeletionJobs.finalize, binding);
  const proof = (await t.run((ctx) => ctx.db.get(ownerId)))
    ?.workosDeletionCompletion;
  const conflictingOwner = await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "conflicting-owner",
      workosUserId: "user_DELETE",
      email: "conflict@example.com",
      emailVerified: true,
    })
  );
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(await t.run((ctx) => ctx.db.get(stateId))).not.toBeNull();
  await t.run((ctx) => ctx.db.delete(conflictingOwner));
  await t.mutation(internal.accountDeletionJobs.redrive, {});
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(await t.run((ctx) => ctx.db.get(stateId))).toBeNull();
  expect(
    (await t.run((ctx) => ctx.db.get(ownerId)))?.workosDeletionCompletion
  ).toEqual(proof);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("migrationQuarantine")
        .withIndex("by_unresolved", (q) => q.eq("resolvedAt", undefined))
        .take(10)
    )
  ).toMatchObject([{ _id: unrelated, reason: "verification_conflict" }]);
});

test("credential rotation after provider cleanup cannot block terminal completion", async () => {
  const { t, receipt, binding, stateId, ownerId, target } = await fixture(5);
  const receiptId = await t.run(async (ctx) => {
    await ctx.db.patch(stateId, { stage: 6 });
    return await ctx.db.insert("migrationQuarantine", receipt);
  });
  vi.stubEnv("WORKOS_API_KEY", "rotated-after-provider-cleanup");
  await t.mutation(internal.accountDeletionJobs.finalize, binding);
  expect(await t.run((ctx) => ctx.db.get(stateId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(ownerId))).toMatchObject({
    deletedAt: expect.any(Number),
    workosDeletionCompletion: { version: 1, stateId, generation: 1, target },
  });
  expect(
    (await t.run((ctx) => ctx.db.get(receiptId)))?.resolvedAt
  ).toBeUndefined();
  expect(
    await t.run((ctx) => expectedWorkosDeletionResolution(ctx, receipt))
  ).toBeNull();
});

test("retained completion rejects changed workflow start time across receipt pages", async () => {
  const { t, receipt, binding, stateId, ownerId } = await fixture();
  await t.run(async (ctx) => {
    for (let i = 0; i < 101; i++) {
      await ctx.db.insert("migrationQuarantine", receipt);
    }
  });
  await t.mutation(internal.accountDeletionJobs.finalize, binding);
  const proof = (await t.run((ctx) => ctx.db.get(ownerId)))
    ?.workosDeletionCompletion;
  await t.run((ctx) => ctx.db.patch(stateId, { startedAt: 1001 }));
  await expect(
    t.mutation(internal.accountDeletionJobs.finalize, binding)
  ).rejects.toThrow("deletion_completion_conflict");
  expect(
    (await t.run((ctx) => ctx.db.get(ownerId)))?.workosDeletionCompletion
  ).toEqual(proof);
  expect(await t.run((ctx) => ctx.db.get(stateId))).not.toBeNull();
});
