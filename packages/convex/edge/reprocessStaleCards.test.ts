import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const NOW = Date.UTC(2026, 9, 24, 10);
const HOUR = 60 * 60 * 1000;
const OWNER = "owner";
const AI_OFF = "ai-off";
const LINK = "https://example.com/article";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type T = ReturnType<typeof convexTest>;

// What cards saved before runs were numbered still show.
const STALE_STAGES = {
  categorize: { status: "pending" as const },
  classify: { status: "pending" as const },
  metadata: { completedAt: NOW - HOUR, status: "completed" as const },
  renderables: { completedAt: NOW - HOUR, status: "completed" as const },
};

const insertCard = (t: T, fields: Partial<Doc<"cards">> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("cards", {
      aiSummary: "An article about something",
      aiTags: ["reading"],
      content: LINK,
      createdAt: NOW - HOUR,
      metadataStatus: "pending",
      processingStatus: STALE_STAGES,
      type: "link",
      updatedAt: NOW - HOUR,
      url: LINK,
      userId: OWNER,
      ...fields,
    })
  );

const card = (t: T, cardId: Id<"cards">) =>
  t.run((ctx) => ctx.db.get("cards", cardId)) as Promise<Doc<"cards">>;

const cardRuns = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query("workflowDispatches").collect()).filter(
      (row) => row.kind === "cardProcessing"
    )
  );

const reprocess = (
  t: T,
  args: { batchSize?: number; cursor?: string | null; dryRun?: boolean } = {}
) =>
  t.mutation(internal.migration.reprocessStaleCards.reprocessStaleCards, {
    once: true,
    ...args,
  });

const seedLibrary = async (t: T) => {
  const due = [
    await insertCard(t),
    await insertCard(t, {
      content: "A note",
      metadataStatus: "completed",
      processingStatus: {
        ...STALE_STAGES,
        categorize: { status: "completed" },
      },
      type: "text",
      url: undefined,
    }),
  ];
  // A run is still going for this one: its revision says so.
  await insertCard(t, { processingRev: 2 });
  await insertCard(t, {
    processingStatus: {
      ...STALE_STAGES,
      categorize: { status: "completed" },
      classify: { status: "completed" },
    },
  });
  // A saved copy on its way never holds a card up.
  await insertCard(t, {
    processingStatus: {
      ...STALE_STAGES,
      archive: { status: "pending" },
      categorize: { status: "completed" },
      classify: { status: "completed" },
    },
  });
  await insertCard(t, { deletedAt: NOW, isDeleted: true });
  await insertCard(t, { userId: AI_OFF });
  await t.run((ctx) =>
    ctx.db.insert("adminUserFlags", {
      aiDisabled: true,
      internal: false,
      teakUserId: AI_OFF,
      updatedAt: NOW,
    })
  );
  return due;
};

describe("reprocessStaleCards", () => {
  test("a dry run counts the stuck cards by type and changes nothing", async () => {
    const t = convexTest(schema, modules);
    await seedLibrary(t);

    const result = await reprocess(t);

    expect(result).toMatchObject({
      dryRun: true,
      isDone: true,
      totals: {
        aiOff: 1,
        byType: [
          { count: 1, type: "link" },
          { count: 1, type: "text" },
        ],
        examined: 7,
        toQueue: 2,
        trashed: 1,
      },
    });
    expect(await cardRuns(t)).toEqual([]);
  });

  test("queues a refresh for each stuck card, and running again queues nothing", async () => {
    const t = convexTest(schema, modules);
    const due = await seedLibrary(t);

    const first = await reprocess(t, { batchSize: 4, dryRun: false });
    expect(first).toMatchObject({ batch: { examined: 4 }, isDone: false });
    const second = await t.mutation(
      internal.migration.reprocessStaleCards.reprocessStaleCards,
      {
        batchSize: 4,
        cursor: first.continueCursor,
        dryRun: false,
        once: true,
        totals: first.totals,
      }
    );
    expect(second).toMatchObject({ isDone: true, totals: { toQueue: 2 } });

    const runs = await cardRuns(t);
    expect(runs.map((row) => row.cardId).sort()).toEqual([...due].sort());
    expect(
      runs.every((row) => row.params?.refresh === true && row.reset === true)
    ).toBe(true);

    const again = await reprocess(t, { batchSize: 100, dryRun: false });
    expect(again.totals).toMatchObject({ toQueue: 0 });
    expect(await cardRuns(t)).toHaveLength(2);
  });

  test("a link starts over like Refresh details when its run is sent", async () => {
    const t = convexTest(schema, modules);
    const [link] = await seedLibrary(t);
    const linkId = link as Id<"cards">;

    await reprocess(t, { batchSize: 100, dryRun: false });
    const claimed = await t.mutation(internal.workflowDispatch.claim, {});
    expect(claimed).toHaveLength(2);

    const after = await card(t, linkId);
    expect(after.processingRev).toBe(1);
    expect(after.metadataStatus).toBe("pending");
    expect(after.aiSummary).toBeUndefined();
    expect(after.processingStatus).toMatchObject({
      archive: { status: "pending" },
      article: { status: "pending" },
      metadata: { status: "pending" },
    });
  });
});
