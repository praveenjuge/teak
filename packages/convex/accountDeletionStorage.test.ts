/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const setup = async (keyCount = 7) => {
  const t = convexTest(schema, modules);
  const keys = Array.from(
    { length: keyCount },
    (_, index) => `users/owner/object-${index}`
  );
  const { card, stateId } = await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      teakUserId: "owner",
      email: "owner@example.com",
      emailVerified: true,
    });
    const card = await ctx.db.insert("cards", {
      userId: "owner",
      type: "text",
      content: "private",
      workflowArtifactKeys: keys,
      createdAt: 1,
      updatedAt: 1,
    });
    const stateId = await ctx.db.insert("accountDeletionStates", {
      userId: "owner",
      startedAt: 1,
      stage: 3,
      generation: 1,
      writersPrepared: true,
    });
    return { card, stateId };
  });
  return {
    t,
    card,
    stateId,
    keys,
    binding: { stateId, generation: 1, kind: "cards" as const },
  };
};
beforeEach(() => {
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const worker = (
  onFreeze?: (key: string) => Promise<void>,
  failDelete = false
) => {
  const freezes: string[] = [],
    deleted: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, options: RequestInit) => {
      const body = JSON.parse(options.body as string) as {
        op: string;
        params: { key: string; keys: string[] };
      };
      if (body.op === "freeze-object") {
        freezes.push(body.params.key);
        await onFreeze?.(body.params.key);
        return Response.json({ ok: true, data: { frozen: true } });
      }
      deleted.push(...body.params.keys);
      if (failDelete) {
        return new Response("unavailable", { status: 503 });
      }
      return Response.json({
        ok: true,
        data: { deleted: body.params.keys.length },
      });
    })
  );
  return { freezes, deleted };
};
// Fault modes: unbounded metadata keys; lost delete replies; source mutation
// during external IO; ambiguous write outcome; stale owner/generation admission.
test("many keys drain at most three per invocation before source deletion", async () => {
  const { t, card, binding, keys } = await setup();
  const proof = worker();
  for (const expected of [3, 6, 7]) {
    expect(
      await t.action(internal.accountDeletionData.drainStorageBatch, binding)
    ).toBe(false);
    expect(proof.freezes).toHaveLength(expected);
    const remaining = await t.run((ctx) => ctx.db.get(card));
    if (expected === 7) {
      expect(remaining).toBeNull();
    } else {
      expect(remaining).not.toBeNull();
    }
  }
  expect(proof.deleted).toEqual(keys);
  expect(
    await t.action(internal.accountDeletionData.drainStorageBatch, binding)
  ).toBe(true);
});
test("lost delete reply retains source and retries the exact same keys", async () => {
  const { t, card, stateId, binding } = await setup();
  worker(undefined, true);
  await expect(
    t.action(internal.accountDeletionData.drainStorageBatch, binding)
  ).rejects.toThrow();
  expect(await t.run((ctx) => ctx.db.get(card))).not.toBeNull();
  expect(
    (await t.run((ctx) => ctx.db.get(stateId)))?.storageProgress?.offset
  ).toBe(0);
  const proof = worker();
  expect(
    await t.action(internal.accountDeletionData.drainStorageBatch, binding)
  ).toBe(false);
  expect(proof.deleted).toEqual([
    "users/owner/object-0",
    "users/owner/object-1",
    "users/owner/object-2",
  ]);
});
test("source changes during freeze cannot delete its row or advance captured progress", async () => {
  const { t, card, stateId, binding, keys } = await setup();
  let changed = false;
  worker(async () => {
    if (!changed) {
      changed = true;
      await t.run((ctx) =>
        ctx.db.patch(card, {
          workflowArtifactKeys: ["users/owner/new-object", ...keys.slice(1)],
        })
      );
    }
  });
  await expect(
    t.action(internal.accountDeletionData.drainStorageBatch, binding)
  ).rejects.toThrow("deletion_storage_source_changed");
  expect(
    (await t.run((ctx) => ctx.db.get(card)))?.workflowArtifactKeys
  ).toEqual(["users/owner/new-object", ...keys.slice(1)]);
  expect(
    (await t.run((ctx) => ctx.db.get(stateId)))?.storageProgress?.offset
  ).toBe(0);
});
test("unknown write outcome and stale generations retain the entire source", async () => {
  const { t, card, binding } = await setup();
  worker(() => {
    throw new Error("unknown_write_outcome");
  });
  await expect(
    t.action(internal.accountDeletionData.drainStorageBatch, binding)
  ).rejects.toThrow();
  expect(await t.run((ctx) => ctx.db.get(card))).not.toBeNull();
  const proof = worker();
  await expect(
    t.action(internal.accountDeletionData.drainStorageBatch, {
      ...binding,
      generation: 2,
    })
  ).rejects.toThrow("stale_deletion_generation");
  expect(proof.freezes).toEqual([]);
});

test("a persisted unfinished R2 writer keeps deletion pending without deleting objects", async () => {
  const { t, card, stateId, binding } = await setup();
  let deletes = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: unknown, options: RequestInit) => {
      const body = JSON.parse(options.body as string) as { op: string };
      if (body.op === "delete-objects") {
        deletes++;
      }
      return Response.json({ ok: true, data: { frozen: false } });
    })
  );
  await expect(
    t.action(internal.accountDeletionData.drainStorageBatch, binding)
  ).rejects.toThrow("deletion_object_write_pending");
  expect(deletes).toBe(0);
  expect(await t.run((ctx) => ctx.db.get(card))).not.toBeNull();
  expect(
    (await t.run((ctx) => ctx.db.get(stateId)))?.storageProgress?.offset
  ).toBe(0);
});

test.each(["imports", "uploads"] as const)(
  "%s multipart sources delete one captured row per action",
  async (kind) => {
    const { t, stateId, binding } = await setup(0);
    const ids = await t.run(async (ctx) => {
      const inserted: (Id<"importJobs"> | Id<"fileUploadSessions">)[] = [];
      for (let index = 0; index < 2; index++) {
        if (kind === "imports") {
          inserted.push(
            await ctx.db.insert("importJobs", {
              userId: "owner",
              mode: "archive",
              status: "canceled",
              phase: "done",
              fileName: "test.zip",
              fileSize: 1,
              fileLastModified: 1,
              sourceKey: `users/owner/import-${index}`,
              uploadId: `upload-${index}`,
              parsedCount: 0,
              processedCount: 0,
              createdCount: 0,
              skippedCount: 0,
              failedCount: 0,
              createdAt: index,
              updatedAt: index,
            })
          );
        } else {
          inserted.push(
            await ctx.db.insert("fileUploadSessions", {
              userId: "owner",
              teakUserId: "owner",
              sourceKey: `users/owner/upload-${index}`,
              uploadId: `upload-${index}`,
              fileName: "test.pdf",
              fileSize: 1,
              fileType: "application/pdf",
              fileLastModified: 1,
              partSize: 1,
              parts: [],
              status: "uploading",
              expiresAt: 1,
              createdAt: index,
              updatedAt: index,
            })
          );
        }
      }
      return inserted;
    });
    let aborts = 0,
      freezes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: unknown, options: RequestInit) => {
        const body = JSON.parse(options.body as string) as {
          op: string;
          params: { keys?: string[] };
        };
        if (body.op === "abort-multipart") {
          aborts++;
          return Response.json({ ok: true, data: {} });
        }
        if (body.op === "freeze-object") {
          freezes++;
          return Response.json({ ok: true, data: { frozen: true } });
        }
        return Response.json({
          ok: true,
          data: { deleted: body.params.keys?.length ?? 0 },
        });
      })
    );
    expect(
      await t.action(internal.accountDeletionData.drainStorageBatch, {
        ...binding,
        kind,
      })
    ).toBe(false);
    expect(aborts).toBe(1);
    expect(freezes).toBe(1);
    expect(await t.run((ctx) => ctx.db.get(ids[0]))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(ids[1]))).not.toBeNull();
    expect(
      (await t.run((ctx) => ctx.db.get(stateId)))?.storageProgress
    ).toBeUndefined();
  }
);

test("storage requests abort at their deadline and preserve the source checkpoint", async () => {
  const { t, card, stateId, binding } = await setup();
  const controller = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => controller.signal);
  let entered!: () => void;
  const pending = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: unknown, options: RequestInit) => {
      entered();
      return new Promise<Response>((resolve, reject) => {
        if (!options.signal) {
          resolve(Response.json({ ok: true, data: { frozen: false } }));
          return;
        }
        options.signal.addEventListener(
          "abort",
          () => reject(new Error("storage_deadline_expired")),
          { once: true }
        );
      });
    })
  );
  const action = t.action(
    internal.accountDeletionData.drainStorageBatch,
    binding
  );
  const rejection = expect(action).rejects.toThrow("storage_deadline_expired");
  await pending;
  controller.abort();
  await rejection;
  expect(await t.run((ctx) => ctx.db.get(card))).not.toBeNull();
  expect(
    (await t.run((ctx) => ctx.db.get(stateId)))?.storageProgress?.offset
  ).toBe(0);
});

test("source disappearance between pages cannot abandon its remaining R2 keys", async () => {
  const { t, card, stateId, binding } = await setup();
  worker();
  expect(
    await t.action(internal.accountDeletionData.drainStorageBatch, binding)
  ).toBe(false);
  await t.run((ctx) => ctx.db.delete(card));
  await expect(
    t.action(internal.accountDeletionData.drainStorageBatch, binding)
  ).rejects.toThrow("deletion_storage_source_changed");
  expect(
    (await t.run((ctx) => ctx.db.get(stateId)))?.storageProgress?.offset
  ).toBe(3);
});

test("source conflicts record an operator-visible pending reason and retry time", async () => {
  const { t, stateId, binding } = await setup();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await t.mutation(internal.accountDeletionJobs.recordFailure, {
    stateId,
    generation: binding.generation,
    stage: 3,
    reason: "storage_source_changed",
  });
  const state = await t.run((ctx) => ctx.db.get(stateId));
  expect(state?.failureCode).toBe(
    "account_deletion_stage_3_storage_source_changed"
  );
  expect(state?.nextAttemptAt).toBeGreaterThan(Date.now());
  expect(state?.stage).toBe(3);
});

test("durable status remains pending until local cleanup finishes and rejects mismatched identity", async () => {
  const { t, stateId } = await setup();
  const ownerId = await t.run(async (ctx) => {
    const owner = await ctx.db.query("users").first();
    if (!owner) {
      throw new Error("fixture owner unavailable");
    }
    await ctx.db.patch(owner._id, {
      workosUserId: "user_e2e",
      workosEmail: "e2e-primary-123-abc@tests.example.com",
    });
    await ctx.db.patch(stateId, { workosUserId: "user_e2e", stage: 5 });
    return owner._id;
  });
  const args = {
    userId: "owner",
    workosUserId: "user_e2e",
    email: "e2e-primary-123-abc@tests.example.com",
  };
  expect(
    await t.query(internal.accountDeletionJobs.getDeletionStatus, args)
  ).toMatchObject({
    status: "pending",
    userId: "owner",
    stage: 5,
  });
  expect(
    await t.query(internal.accountDeletionJobs.getDeletionStatus, {
      ...args,
      email: "another@tests.example.com",
    })
  ).toEqual({ status: "conflict" });
  expect(
    await t.query(internal.accountDeletionJobs.getDeletionStatus, {
      ...args,
      workosUserId: "another",
    })
  ).toEqual({ status: "conflict" });
  await t.run(async (ctx) => {
    await ctx.db.patch(ownerId, { deletedAt: Date.now() });
    await ctx.db.delete(stateId);
  });
  expect(
    await t.query(internal.accountDeletionJobs.getDeletionStatus, args)
  ).toEqual({
    status: "completed",
    userId: "owner",
  });
});
