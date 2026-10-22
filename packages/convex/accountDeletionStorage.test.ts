import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mockActionCtx } from "./__tests__/helpers/convex.test-utils";
import {
  convexForWorker,
  loadFilesWorker,
} from "./__tests__/helpers/filesWorker.test-utils";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ACCOUNT_DELETION_KEY_PAGE as PAGE } from "./accountDeletionBatch";
import schema from "./schema";
import { ensureObjectOwnership } from "./storage/ownership";

vi.mock("@resvg/resvg-wasm/index_bg.wasm", () => ({ default: null }));
const filesWorker = await loadFilesWorker();
const modules = import.meta.glob("./**/*.ts");

type Kind = "cards" | "exports" | "imports" | "objects" | "uploads";
interface OpSpec {
  op: string;
  params: Record<string, unknown>;
}

const setup = async (keyCount = 2 * PAGE + 1) => {
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
  const bucket = new filesWorker.FakeBucket();
  for (const key of keys) {
    bucket.objects.set(key, { bytes: new Uint8Array([1]) });
  }
  const env = filesWorker.withObjectGates({
    BUCKET: bucket,
    FILES_SIGNING_SECRET: "test-secret",
  });
  const freezes: string[] = [];
  type Intercept = (
    spec: OpSpec,
    next: () => Promise<unknown>
  ) => Promise<unknown>;
  const passThrough: Intercept = (_spec, next) => next();
  let intercept = passThrough;
  const ops = (spec: OpSpec) => {
    if (spec.op === "freeze-object") {
      freezes.push(spec.params.key as string);
    }
    return intercept(spec, () => filesWorker.callFilesOp(env, spec));
  };
  const drain = (kind: Kind = "cards", generation = 1): Promise<boolean> =>
    filesWorker.drainStorageBatch(
      { convex: convexForWorker(t), ops },
      { stateId, generation },
      kind
    );
  const deleted = () => (bucket.deleteBatches as string[][]).flat();
  const offset = async () =>
    (await t.run((ctx) => ctx.db.get(stateId)))?.storageProgress?.offset;
  return {
    t,
    card,
    stateId,
    keys,
    bucket,
    freezes,
    drain,
    deleted,
    offset,
    intercept: (next: Intercept = passThrough) => {
      intercept = next;
    },
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

test("many keys drain a page per batch before source deletion", async () => {
  const { t, card, keys, drain, freezes, deleted } = await setup();
  for (const expected of [PAGE, 2 * PAGE, 2 * PAGE + 1]) {
    expect(await drain()).toBe(false);
    expect(freezes).toHaveLength(expected);
    const remaining = await t.run((ctx) => ctx.db.get(card));
    if (expected === keys.length) {
      expect(remaining).toBeNull();
    } else {
      expect(remaining).not.toBeNull();
    }
  }
  expect(deleted()).toEqual(keys);
  expect(await drain()).toBe(true);
});

test("lost delete reply retains source and retries the exact same keys", async () => {
  const { t, card, keys, drain, deleted, offset, intercept } = await setup();
  intercept((spec, next) =>
    spec.op === "delete-objects"
      ? Promise.reject(new Error("connection reset"))
      : next()
  );
  await expect(drain()).rejects.toThrow("connection reset");
  expect(await t.run((ctx) => ctx.db.get(card))).not.toBeNull();
  expect(await offset()).toBe(0);
  intercept();
  expect(await drain()).toBe(false);
  expect(deleted()).toEqual(keys.slice(0, PAGE));
});

test("source changes during freeze cannot delete its row or advance captured progress", async () => {
  const { t, card, keys, drain, offset, intercept } = await setup();
  let changed = false;
  intercept(async (spec, next) => {
    if (spec.op === "freeze-object" && !changed) {
      changed = true;
      await t.run((ctx) =>
        ctx.db.patch(card, {
          workflowArtifactKeys: ["users/owner/new-object", ...keys.slice(1)],
        })
      );
    }
    return next();
  });
  await expect(drain()).rejects.toThrow("deletion_storage_source_changed");
  expect(
    (await t.run((ctx) => ctx.db.get(card)))?.workflowArtifactKeys
  ).toEqual(["users/owner/new-object", ...keys.slice(1)]);
  expect(await offset()).toBe(0);
});

test("unknown write outcome and stale generations retain the entire source", async () => {
  const { t, card, drain, freezes, intercept } = await setup();
  intercept((spec, next) =>
    spec.op === "freeze-object"
      ? Promise.reject(new Error("unknown_write_outcome"))
      : next()
  );
  await expect(drain()).rejects.toThrow("unknown_write_outcome");
  expect(await t.run((ctx) => ctx.db.get(card))).not.toBeNull();
  freezes.length = 0;
  intercept();
  await expect(drain("cards", 2)).rejects.toThrow("stale_deletion_generation");
  expect(freezes).toEqual([]);
});

test("a persisted unfinished R2 writer keeps deletion pending without deleting objects", async () => {
  const { t, card, drain, deleted, offset, intercept } = await setup();
  intercept((spec, next) =>
    spec.op === "freeze-object"
      ? Promise.resolve({ kind: "ok", data: { frozen: false } })
      : next()
  );
  await expect(drain()).rejects.toThrow("deletion_object_write_pending");
  expect(deleted()).toEqual([]);
  expect(await t.run((ctx) => ctx.db.get(card))).not.toBeNull();
  expect(await offset()).toBe(0);
});

test.each(["imports", "uploads"] as const)(
  "%s multipart sources delete one captured row per batch",
  async (kind) => {
    const { t, stateId, bucket, drain, freezes } = await setup(0);
    const ids = await t.run(async (ctx) => {
      const inserted: (Id<"importJobs"> | Id<"fileUploadSessions">)[] = [];
      for (let index = 0; index < 2; index++) {
        const sourceKey = `users/owner/${kind}-${index}`;
        const { uploadId } = bucket.createMultipartUpload(sourceKey);
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
              sourceKey,
              uploadId,
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
              sourceKey,
              uploadId,
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
    expect(await drain(kind)).toBe(false);
    expect(bucket.multipartUploads.size).toBe(1);
    expect(freezes).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get(ids[0]))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(ids[1]))).not.toBeNull();
    expect(
      (await t.run((ctx) => ctx.db.get(stateId)))?.storageProgress
    ).toBeUndefined();
  }
);

test("source disappearance between batches cannot abandon its remaining R2 keys", async () => {
  const { t, card, drain, offset } = await setup();
  expect(await drain()).toBe(false);
  await t.run((ctx) => ctx.db.delete(card));
  await expect(drain()).rejects.toThrow("deletion_storage_source_changed");
  expect(await offset()).toBe(PAGE);
});

test("a checkpoint for a different batch than the one captured is refused", async () => {
  const { t, stateId, drain, offset } = await setup();
  expect(await drain()).toBe(false);
  for (const change of [{ offset: 0 }, { count: 2 }, { fingerprint: "x" }]) {
    await expect(
      t.mutation(internal.accountDeletionData.checkpointStorageBatch, {
        stateId,
        generation: 1,
        kind: "cards",
        fingerprint: (await t.run((ctx) => ctx.db.get(stateId)))
          ?.storageProgress?.fingerprint as string,
        offset: PAGE,
        count: PAGE,
        ...change,
      })
    ).rejects.toThrow();
  }
  expect(await offset()).toBe(PAGE);
});

test("each checkpoint moves the state's progress deadline ahead", async () => {
  const { t, stateId, drain } = await setup();
  await t.run((ctx) => ctx.db.patch(stateId, { nextAttemptAt: 1 }));
  await drain();
  expect(
    (await t.run((ctx) => ctx.db.get(stateId)))?.nextAttemptAt
  ).toBeGreaterThan(Date.now());
});

test("source conflicts record an operator-visible pending reason and retry time", async () => {
  const { t, stateId } = await setup();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await t.mutation(internal.accountDeletionJobs.recordFailure, {
    stateId,
    generation: 1,
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

test("a link's chosen image and the one kept for undo are deleted with the account", async () => {
  const { t, card, drain, deleted } = await setup(0);
  const chosen = "users/owner/cards/link/thumbnail-override/chosen";
  const kept = "users/owner/cards/link/thumbnail-override/kept";
  await t.run((ctx) =>
    ctx.db.patch(card, {
      type: "link",
      thumbnailOverride: {
        storageKey: chosen,
        width: 600,
        height: 900,
        updatedAt: 1,
      },
      previousThumbnailOverride: {
        override: { storageKey: kept, width: 1, height: 1, updatedAt: 1 },
        changeId: "change",
        deleteAfter: 2,
      },
    })
  );
  let done = false;
  for (let call = 0; call < 5 && !done; call += 1) {
    done = await drain();
  }
  expect(deleted()).toEqual([chosen, kept]);
  expect(await t.run((ctx) => ctx.db.get(card))).toBeNull();
});

test("one batch deletes many cards, their rows and their objects together", async () => {
  const { t, bucket, drain, deleted } = await setup(0);
  const keys = await t.run(async (ctx) => {
    const folderId = await ctx.db.insert("folders", {
      userId: "owner",
      name: "Box",
      nameKey: "box",
      kind: "manual",
      activeCardCount: 59,
      createdAt: 1,
      updatedAt: 1,
    });
    const all: string[] = [];
    for (let index = 0; index < 59; index += 1) {
      const cardKeys = [
        `users/owner/many-${index}-a`,
        `users/owner/many-${index}-b`,
      ];
      all.push(...cardKeys);
      const cardId = await ctx.db.insert("cards", {
        userId: "owner",
        type: "text",
        content: `card ${index}`,
        workflowArtifactKeys: cardKeys,
        folderIds: [folderId],
        createdAt: index + 2,
        updatedAt: 1,
      });
      await ctx.db.insert("folderCards", {
        folderId,
        cardId,
        userId: "owner",
        type: "text",
        cardCreatedAt: index + 2,
        addedAt: 1,
      });
      for (const tag of ["one", "two", "three"]) {
        await ctx.db.insert("cardSearchTags", {
          cardId,
          userId: "owner",
          tag,
          type: "text",
          cardCreatedAt: index + 2,
          sourceUpdatedAt: 1,
          syncGeneration: 1,
        });
      }
    }
    return all;
  });
  for (const key of keys) {
    bucket.objects.set(key, { bytes: new Uint8Array([1]) });
  }
  let calls = 0;
  for (let done = false; !done && calls < 100; calls += 1) {
    done = await drain();
  }
  // 60 cards in batches of 25: three batches, then the empty check.
  expect(calls).toBe(4);
  expect(deleted().sort()).toEqual([...keys].sort());
  for (const table of ["cards", "cardSearchTags", "folderCards"] as const) {
    expect(await t.run((ctx) => ctx.db.query(table).take(1))).toEqual([]);
  }
});

test("progress a deploy left under the older fingerprint restarts its batch", async () => {
  const { t, card, stateId, keys, drain, freezes, deleted } = await setup();
  await t.run((ctx) =>
    ctx.db.patch(stateId, {
      storageProgress: {
        kind: "cards",
        fingerprint: "0f".repeat(32),
        offset: 3,
      },
    })
  );
  expect(await drain()).toBe(false);
  expect(freezes).toEqual(keys.slice(0, PAGE));
  let done = false;
  for (let call = 0; call < 5 && !done; call += 1) {
    done = await drain();
  }
  expect(done).toBe(true);
  expect(deleted()).toEqual(keys);
  expect(await t.run((ctx) => ctx.db.get(card))).toBeNull();
});

test("a deployment without the Files Worker never registers phantom objects", async () => {
  vi.stubEnv("FILES_BASE", "");
  vi.stubEnv("FILES_SIGNING_SECRET", "");
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      teakUserId: "owner",
      email: "owner@example.com",
      emailVerified: true,
    });
  });
  await expect(
    ensureObjectOwnership(
      mockActionCtx({ runMutation: t.mutation }),
      "owner",
      "users/owner/link-preview-image-1"
    )
  ).rejects.toThrow("files_worker_not_configured");
  expect(
    await t.run((ctx) => ctx.db.query("accountStorageObjects").collect())
  ).toEqual([]);
  const stateId = await t.run(
    async (ctx) =>
      await ctx.db.insert("accountDeletionStates", {
        userId: "owner",
        startedAt: 1,
        stage: 3,
        generation: 1,
        writersPrepared: true,
      })
  );
  expect(
    await filesWorker.drainStorageBatch(
      {
        convex: convexForWorker(t),
        ops: () => Promise.reject(new Error("no storage op expected")),
      },
      { stateId, generation: 1 },
      "objects"
    )
  ).toBe(true);
});
