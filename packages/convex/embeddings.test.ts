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

const stubWorker = ({
  fail = [],
  failNext = {},
  matches = [],
  onCall,
}: {
  fail?: string[];
  failNext?: Record<string, number>;
  /** What `vector-query` answers. */
  matches?: { id: string; score: number }[];
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
      const answers: Record<string, unknown> = {
        "embed-upsert": {
          mutationId: "m",
          upserted: body.params.items?.length,
        },
        "vector-query": { matches },
      };
      const data = answers[body.op] ?? { mutationId: "m" };
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

    await editCard(t, cardId, { isFavorited: true });
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

/** A card saved before embeddings shipped: no search sync, so no ledger row. */
const insertOldCard = (
  t: T,
  content: string,
  row?: Partial<Doc<"cardEmbeddings">>
) =>
  t.run(async (ctx) => {
    const cardId = await ctx.db.insert("cards", {
      content,
      createdAt: Date.now(),
      type: "text",
      updatedAt: Date.now(),
      userId: USER,
    });
    if (row) {
      await ctx.db.insert("cardEmbeddings", { cardId, userId: USER, ...row });
    }
    return cardId;
  });

const backfill = (t: T, args: Parameters<typeof t.mutation>[1] = {}) =>
  t.mutation(internal.migration.backfillEmbeddings.backfillEmbeddings, args);

/** One card in every state the backfill tells apart. */
const seedLedgerStates = async (t: T) => {
  const embedded = await createCard(t, "already embedded");
  await runScheduled(t);
  const now = Date.now();
  return {
    embedded,
    missing: await insertOldCard(t, "saved before embeddings"),
    noText: await insertOldCard(t, ""),
    failed: await insertOldCard(t, "ran out of retries", {
      attempts: 5,
      lastError: "files_worker_error:INTERNAL:500:r",
    }),
    pending: await insertOldCard(t, "waiting for its embed", { dueAt: now }),
    lost: await insertOldCard(t, "its job was lost", {
      dueAt: now - 2 * 60 * 60 * 1000,
    }),
  };
};

describe("backfill", () => {
  test("a dry run counts every state and writes nothing", async () => {
    const calls = stubWorker();
    const t = setup();
    const cards = await seedLedgerStates(t);

    const result = await backfill(t);
    await runScheduled(t);

    expect(result).toMatchObject({
      dryRun: true,
      isDone: true,
      totals: {
        examined: 6,
        noText: 1,
        embedded: 1,
        pending: 1,
        missing: 2,
        failed: 1,
        queued: 3,
        invalidNamespace: 0,
        skippedDeletingAccounts: 0,
      },
    });
    expect(upserts(calls)).toHaveLength(1);
    expect(await rowOf(t, cards.missing)).toBeNull();
  });

  test("a real run embeds the cards without vectors, in one write", async () => {
    const calls = stubWorker();
    const t = setup();
    const cards = await seedLedgerStates(t);

    await backfill(t, { dryRun: false });
    await runScheduled(t);

    const writes = upserts(calls).slice(1);
    expect(writes).toHaveLength(1);
    expect(
      writes[0]?.params.items.map((item: { text: string }) => item.text).sort()
    ).toEqual([
      "its job was lost",
      "ran out of retries",
      "saved before embeddings",
    ]);
    for (const cardId of [cards.missing, cards.failed, cards.lost]) {
      const row = await rowOf(t, cardId);
      expect(row).toMatchObject({ hash: expect.any(String) });
      expect(row).not.toHaveProperty("lastError");
    }
  });

  test("a big page goes out in jobs of 16, about 300 cards a minute", async () => {
    const calls = stubWorker();
    const t = setup();
    for (let i = 0; i < 20; i += 1) {
      await insertOldCard(t, `old card ${i}`);
    }

    await backfill(t, { dryRun: false });
    const starts = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect())
        .filter(
          (job) => job.name.includes("embedDue") && job.state.kind === "pending"
        )
        .map((job) => job.scheduledTime)
        .sort((a, b) => a - b)
    );
    expect(starts.slice(1).map((time, i) => time - (starts[i] ?? 0))).toEqual([
      3200,
    ]);
    await runScheduled(t);

    expect(
      upserts(calls)
        .map((call) => call.params.items.length)
        .sort((a, b) => a - b)
    ).toEqual([4, 16]);
  });

  test("a failed write retries its cards together", async () => {
    const calls = stubWorker({ failNext: { "embed-upsert": 1 } });
    const t = setup();
    const first = await insertOldCard(t, "first");
    const second = await insertOldCard(t, "second");

    await backfill(t, { dryRun: false });
    await runScheduled(t);

    // The retry is one batched write too, not one write per card.
    expect(upserts(calls).map((call) => call.params.items.length)).toEqual([
      2, 2,
    ]);
    for (const cardId of [first, second]) {
      expect(await rowOf(t, cardId)).toMatchObject({
        hash: expect.any(String),
      });
    }
  });

  test("an edit whose re-embed ran out of retries is reported and queued again", async () => {
    stubWorker();
    const t = setup();
    const cardId = await createCard(t, "first text");
    await runScheduled(t);
    stubWorker({ fail: ["embed-upsert"] });
    await editCard(t, cardId, { content: "edited text" });
    await runScheduled(t);
    // The old vector and hash stay; the edit is never embedded.
    expect(await rowOf(t, cardId)).toMatchObject({
      hash: expect.any(String),
      lastError: expect.any(String),
    });

    expect(
      await t.action(internal.embedding.sweep.sweepVectorLedger, {})
    ).toMatchObject({ failedEmbeds: 1 });
    const calls = stubWorker();
    const result = await backfill(t, { dryRun: false });
    await runScheduled(t);

    expect(result.totals).toMatchObject({ embedded: 0, failed: 1, queued: 1 });
    expect(upserts(calls).map((call) => call.params.items[0].text)).toEqual([
      "edited text",
    ]);
  });

  test("reembed queues embedded cards, and unchanged text costs no AI call", async () => {
    const calls = stubWorker();
    const t = setup();
    await createCard(t, "already embedded");
    await runScheduled(t);

    const result = await backfill(t, { dryRun: false, reembed: true });
    await runScheduled(t);

    expect(result.totals).toMatchObject({ embedded: 1, queued: 1 });
    expect(upserts(calls)).toHaveLength(1);
  });

  test("pages resume from the cursor", async () => {
    stubWorker();
    const t = setup();
    await insertOldCard(t, "one");
    await insertOldCard(t, "two");

    const first = await backfill(t, { batchSize: 1, once: true });
    expect(first).toMatchObject({
      continuationScheduled: false,
      isDone: false,
      totals: { examined: 1, queued: 1 },
    });
    const second = await backfill(t, {
      batchSize: 1,
      cursor: first.continueCursor,
      once: true,
      totals: first.totals,
    });
    expect(second.totals).toMatchObject({ examined: 2, queued: 2 });
  });

  test("userId limits a run to one account", async () => {
    const calls = stubWorker();
    const t = setup();
    await insertOldCard(t, "mine");
    const theirs = await t.run((ctx) =>
      ctx.db.insert("cards", {
        content: "someone else's",
        createdAt: Date.now(),
        type: "text",
        updatedAt: Date.now(),
        userId: "teak_someone_else",
      })
    );

    const result = await backfill(t, { dryRun: false, userId: USER });
    await runScheduled(t);

    expect(result.totals).toMatchObject({ examined: 1, queued: 1 });
    expect(upserts(calls).map((call) => call.params.items[0].text)).toEqual([
      "mine",
    ]);
    expect(await rowOf(t, theirs)).toBeNull();
  });

  test("leaves accounts being deleted alone", async () => {
    const calls = stubWorker();
    const t = setup();
    const cardId = await insertOldCard(t, "owner is leaving");
    await t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        startedAt: Date.now(),
        userId: USER,
      })
    );

    const result = await backfill(t, { dryRun: false });
    await runScheduled(t);

    expect(result.totals).toMatchObject({
      missing: 1,
      queued: 0,
      skippedDeletingAccounts: 1,
    });
    expect(calls).toEqual([]);
    expect(await rowOf(t, cardId)).toBeNull();
  });

  test("a real run refuses to start without a Files Worker", async () => {
    vi.stubEnv("FILES_BASE", "");
    stubWorker();
    const t = setup();
    await insertOldCard(t, "local stack");

    await expect(backfill(t, { dryRun: false })).rejects.toThrow(
      "files_worker_not_configured"
    );
    expect((await backfill(t)).totals.queued).toBe(1);
  });
});

describe("ledger sweep", () => {
  const sweep = (t: T) =>
    t.action(internal.embedding.sweep.sweepVectorLedger, {});

  test("a healthy ledger reports nothing", async () => {
    stubWorker();
    const t = setup();
    await createCard(t, "fine");
    await runScheduled(t);

    expect(await sweep(t)).toEqual({
      rows: 1,
      staleTombstones: 0,
      cardMissing: 0,
      failedEmbeds: 0,
      lostJobs: 0,
      complete: true,
    });
  });

  test("reports failed deletes, rows of gone cards, failed embeds and lost jobs", async () => {
    stubWorker();
    const t = setup();
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    await insertOldCard(t, "failed embed", {
      attempts: 5,
      lastError: "boom",
    });
    await insertOldCard(t, "lost job", { dueAt: now - 2 * 60 * 60 * 1000 });
    await insertOldCard(t, "due soon", { dueAt: now + 1000 });
    await t.run(async (ctx) => {
      for (const [content, row] of [
        ["delete failing for days", { pendingVectorDeleteAt: now - 2 * day }],
        ["delete just started", { pendingVectorDeleteAt: now - 1000 }],
        ["gone without a tombstone", { hash: "h", shard: 0 }],
      ] as const) {
        const cardId = await ctx.db.insert("cards", {
          content,
          createdAt: now,
          type: "text",
          updatedAt: now,
          userId: USER,
        });
        await ctx.db.insert("cardEmbeddings", {
          cardId,
          userId: USER,
          ...row,
        });
        await ctx.db.delete("cards", cardId);
      }
    });

    expect(await sweep(t)).toEqual({
      rows: 6,
      staleTombstones: 1,
      cardMissing: 1,
      failedEmbeds: 1,
      lostJobs: 1,
      complete: true,
    });
  });
});

describe("searchByMeaning", () => {
  test("queries only the user's namespace and describes only their cards", async () => {
    const t = setup();
    const placeholder = stubWorker();
    const cardId = await createCard(t, "Teak decks shrug off rain");
    await runScheduled(t);
    expect(upserts(placeholder)).toHaveLength(1);
    const strangers = await t.run((ctx) =>
      ctx.db.insert("cards", {
        content: "someone else's card",
        createdAt: Date.now(),
        type: "text",
        updatedAt: Date.now(),
        userId: "teak_someone_else",
      })
    );
    const calls = stubWorker({
      matches: [
        { id: cardId, score: 0.81 },
        { id: strangers, score: 0.4 },
      ],
    });

    const results = await t.action(internal.embedding.inspect.searchByMeaning, {
      text: "furniture wood that survives rain",
      userId: USER,
    });

    expect(calls).toEqual([
      {
        op: "vector-query",
        params: {
          namespace: USER,
          shard: 0,
          text: "furniture wood that survives rain",
          topK: 10,
        },
      },
    ]);
    expect(results).toEqual([
      { cardId, preview: "Teak decks shrug off rain", score: 0.81 },
      { cardId: strangers, preview: null, score: 0.4 },
    ]);
  });

  test("a user with no vectors gets nothing, without a query", async () => {
    const calls = stubWorker();
    const t = setup();
    expect(
      await t.action(internal.embedding.inspect.searchByMeaning, {
        text: "anything",
        userId: "teak_typo",
      })
    ).toEqual([]);
    expect(calls).toEqual([]);
  });
});
