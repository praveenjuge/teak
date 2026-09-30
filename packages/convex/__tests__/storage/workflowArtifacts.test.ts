import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { jsonToConvex } from "convex/values";
import { hashRawMetadata } from "../../storage/rawMetadata";
import {
  archiveWorkflowValue,
  collectWorkflowArtifacts,
  deleteRetainedArtifactsHandler,
  hydrateWorkflowValue,
  ownedWorkflowArtifactKeys,
  readWorkflowArtifact,
  registerArtifactHandler,
  serializeWorkflowArtifact,
  WORKFLOW_ARTIFACT_THRESHOLD,
  workflowArtifactKey,
} from "../../storage/workflowArtifacts";

const originalFetch = globalThis.fetch;
const originalBase = process.env.FILES_BASE;
const originalSecret = process.env.FILES_SIGNING_SECRET;
const originalPrefix = process.env.R2_KEY_PREFIX;
const stored = new Map<string, Uint8Array>();
let cardPresent = true;
let terminal = false;
const card = { _id: "card1", userId: "user1" } as any;
const ctx = {
  runMutation: mock().mockResolvedValue(true),
  runQuery: mock((_ref: unknown, args: any) => {
    if (args.cardId) {
      return Promise.resolve(cardPresent ? card : null);
    }
    return Promise.resolve({
      workflow: {
        args: { cardId: card._id },
        generationNumber: 3,
        ...(terminal ? { runResult: { kind: "success" } } : {}),
      },
    });
  }),
} as any;

beforeEach(() => {
  process.env.FILES_BASE = "https://files.teakvault.com";
  process.env.FILES_SIGNING_SECRET = "test-secret";
  delete process.env.R2_KEY_PREFIX;
  stored.clear();
  cardPresent = true;
  terminal = false;
  ctx.runQuery.mockClear();
  ctx.runMutation.mockReset().mockResolvedValue(true);
  globalThis.fetch = mock((input: any, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = decodeURIComponent(
      url.pathname.replace(/^\/__upload\/v1\//, "").replace(/^\//, "")
    );
    if (init?.method === "PUT") {
      stored.set(key, new Uint8Array(init.body as Uint8Array));
      return Promise.resolve(
        Response.json({
          ok: true,
          data: { key, size: stored.get(key)!.byteLength, etag: "test" },
        })
      );
    }
    const value = stored.get(key);
    return Promise.resolve(
      new Response(value ? new Uint8Array(value).buffer : null, {
        status: value ? 200 : 404,
      })
    );
  }) as any;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of [
    ["FILES_BASE", originalBase],
    ["FILES_SIGNING_SECRET", originalSecret],
    ["R2_KEY_PREFIX", originalPrefix],
  ]) {
    if (value === undefined) {
      delete process.env[key!];
    } else {
      process.env[key!] = value;
    }
  }
});

test("small values stay inline and legacy workflows do not write artifacts", async () => {
  const small = { entities: [{ name: "small" }] };
  expect(await archiveWorkflowValue(ctx, card, "workflow1", small)).toBe(small);
  const legacy = { transcript: "x".repeat(20_000) };
  expect(await archiveWorkflowValue(ctx, card, undefined, legacy)).toBe(legacy);
  expect(stored.size).toBe(0);
});

test("large results round-trip every Convex value through independently verified R2 reads", async () => {
  const value = {
    transcript: "🙂".repeat(10_000),
    bytes: new Uint8Array([1, 2]).buffer,
    counter: 12n,
    infinity: Number.POSITIVE_INFINITY,
    zero: -0,
    omit: undefined,
  };
  const ref = await archiveWorkflowValue(ctx, card, "workflow1", value);
  expect(ref.artifactVersion).toBe(1);
  expect(ref.byteLength).toBeGreaterThan(WORKFLOW_ARTIFACT_THRESHOLD);
  expect(ref.key).toContain("/card1/workflow-artifacts/workflow1/3/");
  expect(JSON.stringify(ref).length).toBeLessThan(600);
  expect(
    await hydrateWorkflowValue(ctx, "card1" as any, "workflow1", ref)
  ).toEqual(jsonToConvex(JSON.parse(serializeWorkflowArtifact(value))));
});

test("failed writes and corrupt verification never produce a journal reference", async () => {
  globalThis.fetch = mock(
    async () => new Response("failed", { status: 503 })
  ) as any;
  await expect(
    archiveWorkflowValue(ctx, card, "workflow1", { data: "x".repeat(20_000) })
  ).rejects.toThrow();
  globalThis.fetch = mock(async (_input: any, init?: RequestInit) =>
    init?.method === "PUT"
      ? Response.json({ ok: true, data: {} })
      : new Response("corrupt", { status: 200 })
  ) as any;
  await expect(
    archiveWorkflowValue(ctx, card, "workflow1", { data: "x".repeat(20_000) })
  ).rejects.toThrow("workflow_artifact_integrity_failure");
});

test("missing artifacts fail safely rather than supplying an empty result", async () => {
  const ref = await archiveWorkflowValue(ctx, card, "workflow1", {
    data: "x".repeat(20_000),
  });
  stored.clear();
  await expect(readWorkflowArtifact(ref)).rejects.toThrow(
    "workflow_artifact_read_failed:404"
  );
});

test("foreign ownership, path traversal, deleted cards and terminal workflows cannot hydrate or create artifacts", async () => {
  const ref = await archiveWorkflowValue(ctx, card, "workflow1", {
    data: "x".repeat(20_000),
  });
  await expect(
    hydrateWorkflowValue(ctx, "card2" as any, "workflow1", ref)
  ).rejects.toThrow("owner_mismatch");
  await expect(
    hydrateWorkflowValue(ctx, "card1" as any, "workflow2", ref)
  ).rejects.toThrow("owner_mismatch");
  await expect(
    readWorkflowArtifact({ ...ref, key: "users/user1/../private" })
  ).rejects.toThrow("invalid_workflow_artifact_reference");
  cardPresent = false;
  await expect(
    hydrateWorkflowValue(ctx, "card1" as any, "workflow1", ref)
  ).rejects.toThrow("card_missing");
  await expect(
    archiveWorkflowValue(ctx, card, "workflow1", { data: "x".repeat(20_000) })
  ).rejects.toThrow("card_missing");
  cardPresent = true;
  terminal = true;
  await expect(
    hydrateWorkflowValue(ctx, "card1" as any, "workflow1", ref)
  ).rejects.toThrow("owner_inactive");
});

test("journal cleanup collects only unique references from its own card, workflow and generations", async () => {
  const digest = await hashRawMetadata("value");
  const owner = {
    cardId: "card1",
    workflowId: "workflow1",
    generationNumber: 3,
  };
  const ref = {
    ...owner,
    cardId: "card1" as any,
    userId: "user1",
    digest,
    artifactVersion: 1 as const,
    byteLength: 5,
    key: "",
  };
  ref.key = workflowArtifactKey(ref);
  expect(
    collectWorkflowArtifacts(
      [{ args: { card: ref }, runResult: { returnValue: ref } }],
      owner
    )
  ).toEqual([ref]);
  expect(
    collectWorkflowArtifacts(ref, { ...owner, workflowId: "workflow2" })
  ).toEqual([]);
  expect(
    collectWorkflowArtifacts(ref, { ...owner, generationNumber: 2 })
  ).toEqual([]);
  expect(
    collectWorkflowArtifacts(
      { rawStorageKey: "users/user1/card1/raw-linkPreview/keep.json" },
      owner
    )
  ).toEqual([]);
});

test("artifact writes stand down during account deletion", async () => {
  const data = {
    _id: "card1",
    userId: "user1",
    content: "customer content",
    workflowArtifactKeys: ["existing_key"],
  } as any;
  const digest = await hashRawMetadata("payload");
  const ref = {
    artifactVersion: 1 as const,
    cardId: "card1" as any,
    userId: "user1",
    workflowId: "workflow1",
    generationNumber: 3,
    digest,
    byteLength: 7,
    key: "",
  };
  ref.key = workflowArtifactKey(ref);
  const runAfter = mock().mockResolvedValue("job");
  const patch = mock();
  const registerCtx = {
    db: {
      get: async () => data,
      patch,
      query: (table: string) => ({
        withIndex: (_name: any, cb: any) => {
          cb?.({ eq: () => undefined });
          return {
            unique: async () =>
              table === "accountDeletionStates"
                ? { _id: "del1", userId: "user1", startedAt: 1 }
                : null,
          };
        },
      }),
    },
    runQuery: ctx.runQuery,
    scheduler: { runAfter },
  } as any;
  // Registration stands down and removes the unreferenced copy instead of
  // racing the deletion batches.
  expect(await registerArtifactHandler(registerCtx, ref)).toBe(false);
  expect(data.workflowArtifactKeys).toEqual(["existing_key"]);
  expect(patch).not.toHaveBeenCalled();
  expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
    keys: [ref.key],
  });
  // Retained-artifact cleanup stands down entirely: account deletion
  // removes the card and its artifact objects together.
  runAfter.mockClear();
  expect(
    await deleteRetainedArtifactsHandler(registerCtx, {
      references: [],
      cardId: ref.cardId,
      workflowId: ref.workflowId,
      generationNumber: 3,
    })
  ).toBeNull();
  expect(runAfter).not.toHaveBeenCalled();
  expect(patch).not.toHaveBeenCalled();
  expect(data.workflowArtifactKeys).toEqual(["existing_key"]);
});

test("registers verified artifacts without changing customer fields and makes teardown discover them", async () => {
  const data = {
    _id: "card1",
    userId: "user1",
    content: "customer content",
    notes: "notes",
    aiTranscript: "transcript",
    updatedAt: 123,
  } as any;
  const digest = await hashRawMetadata("payload");
  const ref = {
    artifactVersion: 1 as const,
    cardId: "card1" as any,
    userId: "user1",
    workflowId: "workflow1",
    generationNumber: 3,
    digest,
    byteLength: 7,
    key: "",
  };
  ref.key = workflowArtifactKey(ref);
  const db = {
    get: async () => data,
    patch: (_table: string, _id: string, fields: any) => {
      Object.assign(data, fields);
      return Promise.resolve();
    },
  };
  const registerCtx = {
    db,
    runQuery: ctx.runQuery,
    scheduler: { runAfter: mock().mockResolvedValue("job") },
  } as any;
  expect(await registerArtifactHandler(registerCtx, ref)).toBe(true);
  expect(data).toMatchObject({
    content: "customer content",
    notes: "notes",
    aiTranscript: "transcript",
    updatedAt: 123,
    workflowArtifactKeys: [ref.key],
  });
  expect(ownedWorkflowArtifactKeys(data, "workflow1", 3)).toEqual([ref.key]);
  expect(await registerArtifactHandler(registerCtx, ref)).toBe(true);
  expect(data.workflowArtifactKeys).toEqual([ref.key]);
  const { cardStorageObjectKeys } = await import("../../storage/r2");
  expect(cardStorageObjectKeys(data)).toContain(ref.key);
  expect(
    await deleteRetainedArtifactsHandler(registerCtx, {
      references: [],
      cardId: ref.cardId,
      workflowId: ref.workflowId,
      generationNumber: 3,
    })
  ).toBeNull();
  expect(registerCtx.scheduler.runAfter.mock.calls.at(-1)?.[0]).toBe(0);
  expect(registerCtx.scheduler.runAfter.mock.calls.at(-1)?.[2]).toEqual({
    keys: [ref.key],
  });
  expect(data.workflowArtifactKeys).toBeUndefined();
  expect(data.updatedAt).toBe(123);
});

test("canceled or deleted owners cannot register copied objects and schedule safe unjournaled deletion", async () => {
  const digest = await hashRawMetadata("payload");
  const ref = {
    artifactVersion: 1 as const,
    cardId: "card1" as any,
    userId: "user1",
    workflowId: "workflow1",
    generationNumber: 3,
    digest,
    byteLength: 7,
    key: "",
  };
  ref.key = workflowArtifactKey(ref);
  terminal = true;
  const patch = mock();
  const runAfter = mock().mockResolvedValue("job");
  const registerCtx = {
    db: { get: mock().mockResolvedValue(card), patch },
    runQuery: ctx.runQuery,
    scheduler: { runAfter },
  } as any;
  expect(await registerArtifactHandler(registerCtx, ref)).toBe(false);
  expect(patch).not.toHaveBeenCalled();
  expect(runAfter.mock.calls.at(-1)?.[0]).toBe(0);
  expect(runAfter.mock.calls.at(-1)?.[2]).toEqual({ keys: [ref.key] });
  registerCtx.db.get.mockResolvedValue(null);
  terminal = false;
  expect(await registerArtifactHandler(registerCtx, ref)).toBe(false);
  expect(patch).not.toHaveBeenCalled();
});

test("failed verification keeps private copies tracked and teardown racing PUT queues another deletion", async () => {
  const data = { ...card, workflowArtifactKeys: [] as string[] };
  const scheduler = { runAfter: mock().mockResolvedValue("job") };
  const registerCtx = {
    db: {
      get: () => Promise.resolve(cardPresent ? data : null),
      patch: (_table: string, _id: string, fields: any) => {
        Object.assign(data, fields);
        return Promise.resolve();
      },
    },
    runQuery: ctx.runQuery,
    scheduler,
  } as any;
  ctx.runMutation.mockImplementation((_ref: unknown, args: any) =>
    registerArtifactHandler(registerCtx, args.reference)
  );
  globalThis.fetch = mock((_: any, init?: RequestInit) =>
    Promise.resolve(
      init?.method === "PUT"
        ? Response.json({ ok: true, data: {} })
        : new Response("corrupt")
    )
  ) as any;
  await expect(
    archiveWorkflowValue(ctx, card, "workflow1", { data: "x".repeat(20_000) })
  ).rejects.toThrow("integrity_failure");
  expect(data.workflowArtifactKeys).toHaveLength(1);
  const trackedKey = data.workflowArtifactKeys[0];
  const { cardStorageObjectKeys } = await import("../../storage/r2");
  expect(cardStorageObjectKeys(data)).toContain(trackedKey!);
  globalThis.fetch = mock((_: any, init?: RequestInit) => {
    if (init?.method === "PUT") {
      cardPresent = false;
    }
    return Promise.resolve(
      init?.method === "PUT"
        ? Response.json({ ok: true, data: {} })
        : new Response("corrupt")
    );
  }) as any;
  await expect(
    archiveWorkflowValue(ctx, card, "workflow1", { data: "x".repeat(20_000) })
  ).rejects.toThrow();
  expect(scheduler.runAfter.mock.calls.at(-1)?.[2]).toEqual({
    keys: [trackedKey],
  });
});

test("artifact cleanup traverses unrelated provider artifactVersion fields", async () => {
  const ref = await archiveWorkflowValue(ctx, card, "workflow1", {
    raw: "x".repeat(20_000),
  });
  const owner = {
    cardId: "card1",
    workflowId: "workflow1",
    generationNumber: 3,
  };
  expect(
    collectWorkflowArtifacts(
      { raw: { artifactVersion: 1, nested: ref } },
      owner
    )
  ).toEqual([ref]);
});
