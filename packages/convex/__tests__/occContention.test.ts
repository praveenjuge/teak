// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import {
  CARD_USAGE_SCAN_LIMIT,
  getOrInitializeCardUsage,
  recordActiveCardRemoved,
} from "../card/cardUsage";
import {
  buildCardSearchText,
  syncCardSearchDocumentHandler,
} from "../card/searchDocumentHelpers";
import {
  analyticsShardForRequest,
  IDEMPOTENCY_ANALYTICS_SHARDS,
} from "../idempotencyAnalytics";
import { FREE_TIER_LIMIT } from "../shared/constants";

const queryBuilder = (result: unknown) => ({
  withIndex: (_name: string, callback: (builder: any) => void) => {
    const builder = { eq: () => builder };
    callback(builder);
    return {
      take: mock().mockResolvedValue(result),
      unique: mock().mockResolvedValue(result),
    };
  },
});

describe("OCC contention helpers", () => {
  test("uses an existing usage row without reading cards", async () => {
    const usage = {
      _id: "usage_1",
      activeCardCount: 12,
      isSaturated: false,
    };
    const query = mock((table: string) => {
      if (table === "cards") {
        throw new Error("broad cards read");
      }
      return queryBuilder(usage);
    });

    const result = await getOrInitializeCardUsage(
      { db: { query } } as any,
      "u1"
    );

    expect(result).toBe(usage);
    expect(query).toHaveBeenCalledTimes(1);
  });

  test("initializes a missing usage row with a bounded scan", async () => {
    const take = mock().mockResolvedValue(
      Array.from({ length: FREE_TIER_LIMIT }, (_, index) => ({
        _id: `c${index}`,
      }))
    );
    const insert = mock().mockResolvedValue("usage_1");
    const get = mock().mockResolvedValue({
      _id: "usage_1",
      activeCardCount: FREE_TIER_LIMIT,
      isSaturated: true,
    });
    const query = mock((table: string) => ({
      withIndex: (_name: string, callback: (builder: any) => void) => {
        const builder = { eq: () => builder };
        callback(builder);
        return table === "userCardUsage"
          ? { unique: mock().mockResolvedValue(null) }
          : { take };
      },
    }));

    const result = await getOrInitializeCardUsage(
      { db: { get, insert, query } } as any,
      "u1"
    );

    expect(take).toHaveBeenCalledWith(CARD_USAGE_SCAN_LIMIT);
    expect(insert).toHaveBeenCalledWith(
      "userCardUsage",
      expect.objectContaining({
        activeCardCount: FREE_TIER_LIMIT,
        isSaturated: true,
        userId: "u1",
      })
    );
    expect(result._id).toBe("usage_1");
  });

  test("recounts a saturated account after a removal", async () => {
    const usage = {
      _id: "usage_1",
      activeCardCount: FREE_TIER_LIMIT,
      isSaturated: true,
    };
    const remaining = Array.from(
      { length: FREE_TIER_LIMIT - 1 },
      (_, index) => ({
        _id: `c${index}`,
      })
    );
    const patch = mock().mockResolvedValue(null);
    const query = mock((table: string) =>
      queryBuilder(table === "userCardUsage" ? usage : remaining)
    );

    await recordActiveCardRemoved({ db: { patch, query } } as any, "u1");

    expect(patch).toHaveBeenCalledWith(
      "userCardUsage",
      "usage_1",
      expect.objectContaining({
        activeCardCount: FREE_TIER_LIMIT - 1,
        isSaturated: false,
      })
    );
  });

  test("combines every general search field into one document", () => {
    const text = buildCardSearchText({
      content: "content",
      notes: "notes",
      aiSummary: "summary",
      aiTranscript: "transcript",
      metadataTitle: "title",
      metadataDescription: "description",
      tags: ["tag"],
      aiTags: ["ai-tag"],
    } as any);

    expect(text.split("\n")).toEqual([
      "content",
      "notes",
      "summary",
      "transcript",
      "title",
      "description",
      "tag",
      "ai-tag",
    ]);
  });

  test("stale search jobs converge on the latest card", async () => {
    const replace = mock().mockResolvedValue(null);
    const card = {
      _id: "card_1",
      userId: "u1",
      content: "latest",
      type: "text",
      updatedAt: 20,
    };
    const existing = {
      _id: "search_1",
      cardId: "card_1",
      sourceUpdatedAt: 10,
    };
    const ctx = {
      db: {
        get: mock().mockResolvedValue(card),
        query: mock().mockReturnValue(queryBuilder(existing)),
        replace,
      },
    } as any;

    await syncCardSearchDocumentHandler(ctx, "card_1");

    expect(replace).toHaveBeenCalledWith(
      "cardSearchDocuments",
      "search_1",
      expect.objectContaining({ searchableText: "latest", sourceUpdatedAt: 20 })
    );
  });

  test("idempotency analytics choose a stable bounded shard", () => {
    const first = analyticsShardForRequest("request-123");
    expect(analyticsShardForRequest("request-123")).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(IDEMPOTENCY_ANALYTICS_SHARDS);
    expect(
      new Set(
        Array.from({ length: 64 }, (_, index) =>
          analyticsShardForRequest(`r${index}`)
        )
      ).size
    ).toBeGreaterThan(1);
  });
});
