/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workflowTest from "@convex-dev/workflow/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const backfillApi = (internal as any)["migration/backfillLinkCategoriesClef"];

const setup = () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workflowTest.register(t);
  workosTest.register(t);
  const insertLink = (
    url: string,
    category: string,
    extra: Partial<Doc<"cards">> = {}
  ) =>
    t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner",
        type: "link",
        content: url,
        url,
        createdAt: 1,
        updatedAt: 1,
        metadata: {
          linkCategory: {
            category: category as never,
            confidence: 0.35,
            fetchedAt: 500,
            sourceUrl: url,
          },
        },
        ...extra,
      })
    );
  const scheduled = async () =>
    (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(50)))
      .map((job) => ({
        name: job.name,
        args: job.args[0] as Record<string, unknown>,
        delayMs: job.scheduledTime - Date.now(),
      }))
      .sort((a, b) => a.delayMs - b.delayMs);
  return { insertLink, scheduled, t };
};

describe("backfillLinkCategoriesClef", () => {
  test("a dry run counts only links the rules guessed, and queues nothing", async () => {
    const { insertLink, scheduled, t } = setup();
    await insertLink("https://example.com/soup", "other");
    await insertLink("https://github.com/acme/tool", "software");
    // Moved since by Clef or by hand: no longer the rules' guess.
    await insertLink("https://example.org/a", "recipe");

    const result = await t.mutation(backfillApi.backfillLinkCategoriesClef, {});
    expect(result.dryRun).toBe(true);
    expect(result.totals).toMatchObject({
      examined: 3,
      candidates: 1,
      jobsScheduled: 0,
    });
    expect(await scheduled()).toEqual([]);
  });

  test("a real run queues review jobs of 8, two seconds apart", async () => {
    const { insertLink, scheduled, t } = setup();
    for (let index = 0; index < 10; index += 1) {
      await insertLink(`https://example.com/${index}`, "other");
    }
    const result = await t.mutation(backfillApi.backfillLinkCategoriesClef, {
      dryRun: false,
    });
    expect(result.totals).toMatchObject({ candidates: 10, jobsScheduled: 2 });
    const jobs = await scheduled();
    expect(jobs.map((job) => job.delayMs)).toEqual([0, 2000]);
    expect(jobs.map((job) => (job.args.cardIds as unknown[]).length)).toEqual([
      8, 2,
    ]);
  });
});

describe("applyReviewedCategory", () => {
  const apply = (
    t: ReturnType<typeof setup>["t"],
    cardId: Id<"cards">,
    overrides: Record<string, unknown> = {}
  ) =>
    t.mutation(backfillApi.applyReviewedCategory, {
      cardId,
      metadata: {
        category: "recipe",
        confidence: 0.91,
        fetchedAt: 600,
        sourceUrl: "https://example.com/soup",
        facts: [{ label: "Servings", value: "4" }],
      },
      expectedCategory: "other",
      expectedFetchedAt: 500,
      expectedUrl: "https://example.com/soup",
      ...overrides,
    });

  const categoryOf = async (
    t: ReturnType<typeof setup>["t"],
    cardId: Id<"cards">
  ) =>
    (await t.run((ctx) => ctx.db.get("cards", cardId)))?.metadata?.linkCategory;

  test("writes the metadata enriched for the new category", async () => {
    const { insertLink, t } = setup();
    const cardId = await insertLink("https://example.com/soup", "other");
    expect(await apply(t, cardId)).toBe(true);
    expect(await categoryOf(t, cardId)).toEqual({
      category: "recipe",
      confidence: 0.91,
      fetchedAt: 600,
      sourceUrl: "https://example.com/soup",
      facts: [{ label: "Servings", value: "4" }],
    });
  });

  test.each([
    ["the URL changed", { expectedUrl: "https://example.com/old" }],
    ["the category changed", { expectedCategory: "article" }],
    ["it was refreshed", { expectedFetchedAt: 400 }],
    ["the category is other", { metadata: { category: "other" } }],
    ["the category is unknown", { metadata: { category: "cookbook" } }],
  ])("refuses when %s", async (_name, overrides) => {
    const { insertLink, t } = setup();
    const cardId = await insertLink("https://example.com/soup", "other");
    expect(await apply(t, cardId, overrides)).toBe(false);
    expect((await categoryOf(t, cardId))?.category).toBe("other");
  });
});
