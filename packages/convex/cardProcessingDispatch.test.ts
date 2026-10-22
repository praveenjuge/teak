import type { DispatchItem } from "@teak/files-protocol";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { MAX_AI_BACKFILL_ATTEMPTS } from "./ai/backfill";
import { syncCardSearch } from "./card/searchSync";
import schema from "./schema";
import { queueCardProcessing } from "./workflowDispatch";

const modules = import.meta.glob("./**/*.ts");
const NOW = new Date("2026-10-16T10:00:00Z").getTime();
const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type T = ReturnType<typeof convexTest>;

const insertCard = (t: T, fields: Partial<Doc<"cards">> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("cards", {
      content: "Some notes",
      createdAt: NOW - HOUR_MS,
      type: "text",
      updatedAt: NOW - HOUR_MS,
      userId: "owner",
      ...fields,
    })
  );

// A card saved through the app: its search sync sets `aiPending`.
const saveCard = async (t: T, fields: Partial<Doc<"cards">> = {}) => {
  const cardId = await insertCard(t, fields);
  await t.run((ctx) => syncCardSearch(ctx, cardId));
  return cardId;
};

const card = (t: T, cardId: Id<"cards">) =>
  t.run((ctx) => ctx.db.get("cards", cardId));

const cardRuns = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query("workflowDispatches").collect()).filter(
      (row) => row.kind === "cardProcessing"
    )
  );

const claimItems = async (t: T) =>
  (await t.mutation(internal.workflowDispatch.claim, {})).map(
    ({ item }: { item: unknown }) => item as DispatchItem
  );

describe("queueCardProcessing", () => {
  test("each start bumps the card's revision and queues a run for it", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t);

    const first = await t.run((ctx) => queueCardProcessing(ctx, cardId));
    const second = await t.run((ctx) => queueCardProcessing(ctx, cardId));

    expect(first).toEqual({ instanceId: `card-${cardId}-1`, rev: 1 });
    expect(second).toEqual({ instanceId: `card-${cardId}-2`, rev: 2 });
    expect((await card(t, cardId))?.processingRev).toBe(2);
    expect(
      (await cardRuns(t)).map(({ instanceId, rev, state }) => ({
        instanceId,
        rev,
        state,
      }))
    ).toEqual([
      { instanceId: `card-${cardId}-1`, rev: 1, state: "pending" },
      { instanceId: `card-${cardId}-2`, rev: 2, state: "pending" },
    ]);
  });

  test("a run that replaces a pending reset keeps the reset", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t, { aiTags: ["old"] });
    await t.run(async (ctx) => {
      await queueCardProcessing(ctx, cardId, { delayMs: 60_000, reset: true });
      await queueCardProcessing(ctx, cardId);
    });

    expect(await claimItems(t)).toHaveLength(1);
    expect((await card(t, cardId))?.aiTags).toBeUndefined();
  });

  test("a metadata-only run that replaces a pending full run runs in full", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t);
    await t.run(async (ctx) => {
      await queueCardProcessing(ctx, cardId);
      await queueCardProcessing(ctx, cardId, { metadataOnly: true });
    });

    expect(await claimItems(t)).toEqual([
      {
        id: `card-${cardId}-2`,
        params: { cardId, rev: 2 },
        type: "workflow",
        workflow: "card-processing",
      },
    ]);
  });

  test("a deleted card queues nothing", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t);
    await t.run((ctx) => ctx.db.delete("cards", cardId));
    expect(await t.run((ctx) => queueCardProcessing(ctx, cardId))).toBeNull();
    expect(await cardRuns(t)).toEqual([]);
  });
});

describe("claiming card runs", () => {
  test("drops a run an edit replaced before it was sent", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t);
    await t.run(async (ctx) => {
      await queueCardProcessing(ctx, cardId);
      await queueCardProcessing(ctx, cardId);
    });

    const items = await claimItems(t);

    expect(items).toEqual([
      {
        id: `card-${cardId}-2`,
        params: { cardId, rev: 2 },
        type: "workflow",
        workflow: "card-processing",
      },
    ]);
    expect(
      (await cardRuns(t)).map(({ error, rev, state }) => ({
        error,
        rev,
        state,
      }))
    ).toEqual([
      { error: "superseded", rev: 1, state: "done" },
      { error: undefined, rev: 2, state: "sent" },
    ]);
  });

  test("terminates the run a newer one replaces once both were sent", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t);
    await t.run((ctx) => queueCardProcessing(ctx, cardId));
    await claimItems(t);
    vi.setSystemTime(NOW + 1000);
    await t.run((ctx) => queueCardProcessing(ctx, cardId));

    const [item] = await claimItems(t);

    expect(item).toMatchObject({
      id: `card-${cardId}-2`,
      terminate: [`card-${cardId}-1`],
    });
  });

  test("a reset clears the card's AI output when the run is sent, not before", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t, {
      aiSummary: "Old summary",
      aiTags: ["old"],
      processingStatus: {
        classify: { completedAt: 1, confidence: 0.9, status: "completed" },
        metadata: { completedAt: 1, status: "completed" },
        renderables: { completedAt: 1, status: "completed" },
      },
    });
    await t.run((ctx) =>
      queueCardProcessing(ctx, cardId, { delayMs: 60_000, reset: true })
    );

    expect(await claimItems(t)).toEqual([]);
    expect((await card(t, cardId))?.aiTags).toEqual(["old"]);

    vi.setSystemTime(NOW + 60_000);
    expect(await claimItems(t)).toHaveLength(1);
    const reset = await card(t, cardId);
    expect(reset?.aiTags).toBeUndefined();
    expect(reset?.aiSummary).toBeUndefined();
    expect(reset?.processingStatus).toMatchObject({
      classify: { status: "completed" },
      metadata: { status: "pending" },
    });
  });
});

describe("sending a card run again", () => {
  test("a reset applies once: a resend after a lost reply keeps the run's work", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t, { aiTags: ["old"] });
    await t.run((ctx) => queueCardProcessing(ctx, cardId, { reset: true }));
    const [claimed] = await t.mutation(internal.workflowDispatch.claim, {});
    await t.run((ctx) => ctx.db.patch("cards", cardId, { aiTags: ["new"] }));
    await t.mutation(internal.workflowDispatch.release, {
      error: "timeout",
      ids: [claimed?.id as Id<"workflowDispatches">],
    });
    vi.setSystemTime(NOW + HOUR_MS);

    expect(await claimItems(t)).toHaveLength(1);
    expect((await card(t, cardId))?.aiTags).toEqual(["new"]);
  });
});

describe("a card run that errors", () => {
  const stuckCard = {
    processingStatus: {
      categorize: { status: "completed" as const },
      classify: { status: "completed" as const },
      metadata: { status: "in_progress" as const },
      renderables: { status: "completed" as const },
      screenshot: { status: "pending" as const },
    },
    type: "link" as const,
    url: "https://example.com",
  };

  test("fails the stages it left unfinished, the screenshot included", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t, stuckCard);
    const queued = await t.run((ctx) => queueCardProcessing(ctx, cardId));
    await claimItems(t);

    await t.mutation(internal.workflowDispatch.complete, {
      error: "renderer_down",
      instanceId: queued?.instanceId as string,
      status: "errored",
    });

    const failed = await card(t, cardId);
    expect(failed?.processingStatus).toMatchObject({
      categorize: { status: "completed" },
      metadata: { error: "workflow_failed", status: "failed" },
      screenshot: { error: "workflow_failed", status: "failed" },
    });
    const [run] = await cardRuns(t);
    expect(run).toMatchObject({ error: "renderer_down", state: "failed" });
  });

  test("leaves the stages alone when a newer revision owns them", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t, stuckCard);
    const queued = await t.run((ctx) => queueCardProcessing(ctx, cardId));
    await claimItems(t);
    await t.run((ctx) => queueCardProcessing(ctx, cardId));

    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: queued?.instanceId as string,
      status: "errored",
    });

    expect((await card(t, cardId))?.processingStatus).toMatchObject({
      metadata: { status: "in_progress" },
      screenshot: { status: "pending" },
    });
  });
});

describe("guarded writes", () => {
  const write = (cardId: Id<"cards">, rev: number) => ({
    args: {
      cardId,
      processingStatus: { metadata: { completedAt: NOW, status: "completed" } },
    },
    cardId,
    name: "ai/mutations:updateCardProcessing",
    rev,
  });

  test("a run's write lands while it owns the card's revision", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t, { processingRev: 3 });
    await t.mutation(internal.workflowGateway.runGuarded, write(cardId, 3));
    expect((await card(t, cardId))?.processingStatus?.metadata?.status).toBe(
      "completed"
    );
  });

  test("a write from a replaced run is refused and changes nothing", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t, { processingRev: 3 });
    await expect(
      t.mutation(internal.workflowGateway.runGuarded, write(cardId, 2))
    ).rejects.toThrow("stale_processing_revision");
    expect((await card(t, cardId))?.processingStatus).toBeUndefined();
  });
});

describe("updateCardProcessing", () => {
  test("restores a stage only while it is in progress, when asked to", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t, {
      processingStatus: {
        metadata: { completedAt: 5, status: "completed" },
        renderables: { startedAt: 4, status: "in_progress" },
      },
    });
    await t.mutation(internal.ai.mutations.updateCardProcessing, {
      cardId,
      onlyIfInProgress: true,
      processingStatus: {
        metadata: { status: "pending" },
        renderables: { status: "pending" },
      },
    });
    expect((await card(t, cardId))?.processingStatus).toEqual({
      metadata: { completedAt: 5, status: "completed" },
      renderables: { status: "pending" },
    });
  });
});

describe("markStagesInProgress", () => {
  test("marks each stage in progress, keeping when it first started", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t, {
      processingStatus: {
        classify: { status: "completed", completedAt: 1 },
        metadata: { startedAt: 42, status: "in_progress" },
        renderables: { status: "pending" },
      },
    });
    await t.mutation(internal.card.processingRpc.markStagesInProgress, {
      cardId,
      stages: ["metadata", "renderables"],
    });
    expect((await card(t, cardId))?.processingStatus).toEqual({
      classify: { completedAt: 1, status: "completed" },
      metadata: { startedAt: 42, status: "in_progress" },
      renderables: { startedAt: NOW, status: "in_progress" },
    });
  });

  test("hands the Worker the card with its deployment's key prefix", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t);
    const loaded = await t.query(
      internal.card.processingRpc.getCardForProcessing,
      { cardId }
    );
    expect(loaded).toMatchObject({ card: { _id: cardId }, keyPrefix: "" });
  });
});

describe("AI backfill claims", () => {
  test("claims cards missing AI with their revision and counts the attempt", async () => {
    const t = convexTest(schema, modules);
    const cardId = await saveCard(t, {
      aiBackfillAttempts: 1,
      processingRev: 7,
    });
    await saveCard(t, { aiTags: ["done"] });
    await saveCard(t, { createdAt: NOW - 1000 });

    const claimed = await t.mutation(
      internal.ai.backfill.claimAiBackfillCards,
      {}
    );

    expect(claimed).toEqual({ cards: [{ cardId, rev: 7 }], exhausted: 0 });
    expect((await card(t, cardId))?.aiBackfillAttempts).toBe(2);
  });

  test("gives up on a card after its last attempt", async () => {
    const t = convexTest(schema, modules);
    const cardId = await saveCard(t, {
      aiBackfillAttempts: MAX_AI_BACKFILL_ATTEMPTS,
    });

    const claimed = await t.mutation(
      internal.ai.backfill.claimAiBackfillCards,
      {}
    );

    expect(claimed).toEqual({ cards: [], exhausted: 1 });
    const exhausted = await card(t, cardId);
    expect(exhausted?.aiTags).toEqual([]);
    expect(exhausted?.processingStatus?.metadata).toMatchObject({
      error: "ai_backfill_exhausted",
      status: "failed",
    });
  });

  test("the admin retry claims the batch and queues a metadata-only run for each card", async () => {
    const t = convexTest(schema, modules);
    const cardId = await saveCard(t);

    expect(
      await t.mutation(internal.ai.backfill.retryAiBackfillNow, {})
    ).toEqual({ enqueuedCount: 1, failedCardIds: [] });
    expect(await cardRuns(t)).toMatchObject([
      { cardId, params: { cardId, metadataOnly: true, rev: 1 }, rev: 1 },
    ]);
    expect((await card(t, cardId))?.aiBackfillAttempts).toBe(1);
  });

  test("releasing a claim the Worker could not queue gives the attempt back", async () => {
    const t = convexTest(schema, modules);
    const cardId = await saveCard(t, { aiBackfillAttempts: 1 });
    await t.mutation(internal.ai.backfill.claimAiBackfillCards, {});

    await t.mutation(internal.ai.backfill.releaseAiBackfillCards, {
      cardIds: [cardId],
    });

    expect((await card(t, cardId))?.aiBackfillAttempts).toBe(1);
  });
});
