/// <reference types="vite/client" />
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { syncCardSearch } from "./card/searchDocumentHelpers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const USER = "teak_embed_owner";

interface WorkerCall {
  op: string;
  params: Record<string, any>;
}

/**
 * The Files Worker's vector ops. `fail` makes the named op answer 500 every
 * time, `failNext` the given number of times; `onCall` runs before answering.
 */
const stubWorker = ({
  fail = [],
  failNext = {},
  onCall,
}: {
  fail?: string[];
  failNext?: Record<string, number>;
  onCall?: (call: WorkerCall) => Promise<void> | void;
} = {}) => {
  const calls: WorkerCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== "https://files.test") {
        throw new Error(`unexpected_fetch:${url}`);
      }
      const body = JSON.parse(String(init?.body)) as WorkerCall;
      calls.push({ op: body.op, params: body.params });
      await onCall?.(body);
      const failOnce = (failNext[body.op] ?? 0) > 0;
      if (failOnce) {
        failNext[body.op] = (failNext[body.op] ?? 0) - 1;
      }
      if (failOnce || fail.includes(body.op)) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "INTERNAL",
              message: "boom",
              requestId: "r",
              retryable: true,
            },
          },
          { status: 500 }
        );
      }
      const data =
        body.op === "embed-upsert"
          ? { mutationId: "m", upserted: body.params.items.length }
          : { mutationId: "m" };
      return Response.json({ ok: true, version: 1, requestId: "r", data });
    })
  );
  return calls;
};

const setup = () => {
  const t = convexTest(schema, modules);
  workflowTest.register(t);
  return t;
};

type T = ReturnType<typeof setup>;

const createCard = (t: T, content: string) =>
  t.run(async (ctx) => {
    const cardId = await ctx.db.insert("cards", {
      content,
      createdAt: Date.now(),
      type: "text",
      updatedAt: Date.now(),
      userId: USER,
    });
    await syncCardSearch(ctx, cardId, USER);
    return cardId;
  });

const editCard = (t: T, cardId: Id<"cards">, value: Partial<Doc<"cards">>) =>
  t.run(async (ctx) => {
    const previous = await ctx.db.get("cards", cardId);
    await ctx.db.patch("cards", cardId, { ...value, updatedAt: Date.now() });
    await syncCardSearch(ctx, cardId, USER, previous ?? undefined);
  });

const deleteCard = (t: T, cardId: Id<"cards">) =>
  t.run(async (ctx) => {
    const previous = await ctx.db.get("cards", cardId);
    await ctx.db.delete("cards", cardId);
    await syncCardSearch(ctx, cardId, USER, previous ?? undefined);
  });

const rowOf = (t: T, cardId: Id<"cards">) =>
  t.run((ctx) =>
    ctx.db
      .query("cardEmbeddings")
      .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
      .unique()
  );

const runScheduled = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

const upserts = (calls: WorkerCall[]) =>
  calls.filter((call) => call.op === "embed-upsert");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "embedding-test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("embedding cards", () => {
  test("embeds a new card once, in its owner's namespace on the current shard", async () => {
    const calls = stubWorker();
    const t = setup();
    const cardId = await createCard(t, "Teak is a tropical hardwood");
    expect(upserts(calls)).toEqual([]);

    await runScheduled(t);

    expect(upserts(calls)).toEqual([
      {
        op: "embed-upsert",
        params: {
          items: [{ id: cardId, text: "Teak is a tropical hardwood" }],
          namespace: USER,
          shard: 0,
        },
      },
    ]);
    const row = await rowOf(t, cardId);
    expect(row).toMatchObject({
      embeddedAt: expect.any(Number),
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      namespace: USER,
      shard: 0,
    });
    expect(row).not.toHaveProperty("dueAt");
  });

  test("a burst of edits is embedded once, with the last text", async () => {
    const calls = stubWorker();
    const t = setup();
    const cardId = await createCard(t, "first");
    vi.advanceTimersByTime(10_000);
    await editCard(t, cardId, { content: "second" });
    vi.advanceTimersByTime(10_000);
    await editCard(t, cardId, { content: "third" });

    await runScheduled(t);

    expect(upserts(calls).map((call) => call.params.items)).toEqual([
      [{ id: cardId, text: "third" }],
    ]);
  });

  test("an edit that leaves the text unchanged makes no Workers AI call", async () => {
    const calls = stubWorker();
    const t = setup();
    const cardId = await createCard(t, "same words");
    await runScheduled(t);
    expect(upserts(calls)).toHaveLength(1);

    // Not search text at all: nothing is scheduled.
    await editCard(t, cardId, { isFavorited: true });
    // Marked again with the same text: the hash matches, so no call.
    await t.run(async (ctx) => {
      const { markCardForEmbedding } = await import("./embedding/state");
      await markCardForEmbedding(ctx, cardId, USER);
    });
    await runScheduled(t);

    expect(upserts(calls)).toHaveLength(1);
    const row = await rowOf(t, cardId);
    expect(row).not.toBeNull();
    expect(row).not.toHaveProperty("dueAt");
  });

  test("a failing Worker is retried with backoff, then left for the backfill", async () => {
    const calls = stubWorker({ fail: ["embed-upsert"] });
    const t = setup();
    const cardId = await createCard(t, "never lands");

    await runScheduled(t);

    expect(upserts(calls)).toHaveLength(5);
    const row = await rowOf(t, cardId);
    expect(row).toMatchObject({
      attempts: 5,
      lastError: expect.stringContaining("files_worker_error"),
    });
    expect(row).not.toHaveProperty("dueAt");
    expect(row).not.toHaveProperty("hash");
  });

  test("a card cleared of all text has its vector deleted", async () => {
    const calls = stubWorker();
    const t = setup();
    const cardId = await createCard(t, "soon gone");
    await runScheduled(t);

    await editCard(t, cardId, { content: "" });
    await runScheduled(t);

    expect(calls.filter((call) => call.op === "vector-delete")).toEqual([
      { op: "vector-delete", params: { ids: [cardId], shard: 0 } },
    ]);
    expect(upserts(calls)).toHaveLength(1);
    const row = await rowOf(t, cardId);
    expect(row).not.toBeNull();
    expect(row).not.toHaveProperty("embeddedAt");
    expect(row).not.toHaveProperty("hash");
  });

  test("dev cards use the deployment's dev/ namespace in the shared index", async () => {
    vi.stubEnv("R2_KEY_PREFIX", "dev/");
    const calls = stubWorker();
    const t = setup();
    await createCard(t, "from the dev deployment");
    await runScheduled(t);
    expect(upserts(calls)[0]?.params.namespace).toBe(`dev/${USER}`);
  });

  test("without a Files Worker nothing is recorded or scheduled", async () => {
    vi.stubEnv("FILES_BASE", "");
    const calls = stubWorker();
    const t = setup();
    const cardId = await createCard(t, "local stack");
    await runScheduled(t);
    expect(calls).toEqual([]);
    expect(await rowOf(t, cardId)).toBeNull();
  });
});

describe("deleting vectors", () => {
  test("a deleted card's vector is deleted, then its row", async () => {
    const calls = stubWorker();
    const t = setup();
    const cardId = await createCard(t, "to delete");
    await runScheduled(t);

    await deleteCard(t, cardId);
    expect(await rowOf(t, cardId)).toMatchObject({
      pendingVectorDeleteAt: expect.any(Number),
    });
    await runScheduled(t);

    expect(calls.filter((call) => call.op === "vector-delete")).toEqual([
      { op: "vector-delete", params: { ids: [cardId], shard: 0 } },
    ]);
    expect(await rowOf(t, cardId)).toBeNull();
  });

  test("a delete that keeps failing leaves the tombstone in place", async () => {
    const calls = stubWorker({ fail: ["vector-delete"] });
    const t = setup();
    const cardId = await createCard(t, "stubborn");
    await runScheduled(t);

    await deleteCard(t, cardId);
    await runScheduled(t);

    expect(calls.filter((call) => call.op === "vector-delete")).toHaveLength(5);
    expect(await rowOf(t, cardId)).toMatchObject({
      pendingVectorDeleteAt: expect.any(Number),
    });
  });

  test("a card deleted before its first embed leaves no row and no call", async () => {
    const calls = stubWorker();
    const t = setup();
    const cardId = await createCard(t, "short-lived");
    await deleteCard(t, cardId);
    await runScheduled(t);
    expect(calls).toEqual([]);
    expect(await rowOf(t, cardId)).toBeNull();
  });

  test("a card deleted while its embed was in flight has the new vector deleted", async () => {
    const calls = stubWorker();
    const t = setup();
    const cardId = await createCard(t, "racing");
    const row = await rowOf(t, cardId);
    // The delete lands before the job records its upsert.
    await t.run(async (ctx) => {
      await ctx.db.delete("cardEmbeddings", row!._id);
      await ctx.db.delete("cards", cardId);
    });

    expect(
      await t.mutation(internal.embedding.state.recordEmbedded, {
        cardId,
        expectedDueAt: row!.dueAt,
        hash: "a".repeat(64),
        namespace: USER,
        shard: 0,
      })
    ).toBe("card_gone");
    await runScheduled(t);

    expect(calls.filter((call) => call.op === "vector-delete")).toEqual([
      { op: "vector-delete", params: { ids: [cardId], shard: 0 } },
    ]);
  });
});

describe("stale writes", () => {
  test("an older job never marks a newer edit done", async () => {
    stubWorker();
    const t = setup();
    const cardId = await createCard(t, "first");
    const before = await rowOf(t, cardId);
    vi.advanceTimersByTime(5000);
    await editCard(t, cardId, { content: "second" });

    expect(
      await t.mutation(internal.embedding.state.recordEmbedded, {
        cardId,
        expectedDueAt: before!.dueAt,
        hash: "b".repeat(64),
        namespace: USER,
        shard: 0,
      })
    ).toBe("stale");
    const row = await rowOf(t, cardId);
    expect(row).toMatchObject({
      dueAt: expect.any(Number),
    });
    expect(row).not.toHaveProperty("hash");
  });

  test("a job overtaken by a newer completed one re-embeds the current text", async () => {
    const calls = stubWorker();
    const t = setup();
    const cardId = await createCard(t, "current text");
    const pending = await rowOf(t, cardId);
    await runScheduled(t);
    expect(upserts(calls)).toHaveLength(1);

    // An older job's upsert landed after the newer job completed.
    expect(
      await t.mutation(internal.embedding.state.recordEmbedded, {
        cardId,
        expectedDueAt: (pending!.dueAt ?? 0) - 1,
        hash: "c".repeat(64),
        namespace: USER,
        shard: 0,
      })
    ).toBe("stale");
    await runScheduled(t);

    expect(upserts(calls).map((call) => call.params.items)).toEqual([
      [{ id: cardId, text: "current text" }],
      [{ id: cardId, text: "current text" }],
    ]);
  });

  test("an edit made while an embed is in flight is embedded after it", async () => {
    let edited = false;
    const t = setup();
    const calls = stubWorker({
      onCall: async (call) => {
        if (call.op === "embed-upsert" && !edited) {
          edited = true;
          await editCard(t, call.params.items[0].id, { content: "second" });
        }
      },
    });
    const cardId = await createCard(t, "first");

    await runScheduled(t);

    expect(upserts(calls).map((call) => call.params.items)).toEqual([
      [{ id: cardId, text: "first" }],
      [{ id: cardId, text: "second" }],
    ]);
    expect(await rowOf(t, cardId)).not.toHaveProperty("dueAt");
  });

  test("text reverted while an embed is in flight is embedded again", async () => {
    let reverted = false;
    const t = setup();
    const calls = stubWorker({
      onCall: async (call) => {
        if (
          call.op === "embed-upsert" &&
          call.params.items[0].text === "B" &&
          !reverted
        ) {
          reverted = true;
          await editCard(t, call.params.items[0].id, { content: "A" });
        }
      },
    });
    const cardId = await createCard(t, "A");
    await runScheduled(t);
    await editCard(t, cardId, { content: "B" });

    await runScheduled(t);

    expect(upserts(calls).map((call) => call.params.items[0].text)).toEqual([
      "A",
      "B",
      "A",
    ]);
  });

  test("a failed re-embed of an overtaken card is retried, not skipped", async () => {
    const t = setup();
    const calls = stubWorker();
    const cardId = await createCard(t, "current text");
    const pending = await rowOf(t, cardId);
    await runScheduled(t);

    const retried = stubWorker({ failNext: { "embed-upsert": 1 } });
    await t.mutation(internal.embedding.state.recordEmbedded, {
      cardId,
      expectedDueAt: (pending!.dueAt ?? 0) - 1,
      hash: "c".repeat(64),
      namespace: USER,
      shard: 0,
    });
    await runScheduled(t);

    expect(upserts(calls)).toHaveLength(1);
    expect(upserts(retried).map((call) => call.params.items)).toEqual([
      [{ id: cardId, text: "current text" }],
      [{ id: cardId, text: "current text" }],
    ]);
    expect(await rowOf(t, cardId)).toMatchObject({
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });
});
