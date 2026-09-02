/// <reference types="vite/client" />

import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  assertAccountNotDeleting,
  beginAccountDeletion,
} from "./accountDeletion";
import {
  deleteAccountDataHandler,
  getAccountCardDeletionBatchHandler,
} from "./auth";
import {
  CARD_USAGE_BASE_SHARDS,
  CARD_USAGE_SCAN_LIMIT,
  CARD_USAGE_TOTAL_SHARDS,
  getCardUsageSnapshot,
  getOrInitializeCardUsage,
  initializeCardUsageShards,
  recordActiveCardCreated,
  recordActiveCardRemoved,
  removeCardUsage,
} from "./card/cardUsage";
import { getSearchResultLimit } from "./card/getCards";
import { authorizeCardCreation, ensureCardQuotaAvailable } from "./card/quota";
import {
  buildCardSearchText,
  searchCardsByDocument,
  syncCardSearchDocumentHandler,
} from "./card/searchDocumentHelpers";
import {
  analyticsShardForRequest,
  IDEMPOTENCY_ANALYTICS_SHARDS,
} from "./idempotencyAnalytics";
import schema from "./schema";
import { FREE_TIER_LIMIT } from "./shared/constants";
import { RATE_LIMIT_CONFIG, rateLimiter } from "./shared/rateLimits";

const modules = import.meta.glob("./**/*.ts");

const insertCard = async (
  ctx: MutationCtx,
  userId: string,
  overrides: Partial<Doc<"cards">> = {}
): Promise<Id<"cards">> =>
  await ctx.db.insert("cards", {
    userId,
    content: "Card",
    type: "text",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

const insertExactUsage = async (
  ctx: MutationCtx,
  userId: string,
  activeCardCount: number
) => {
  const usageId = await ctx.db.insert("userCardUsage", {
    userId,
    activeCardCount,
    isCountExact: true,
    isSaturated: activeCardCount >= FREE_TIER_LIMIT,
    updatedAt: Date.now(),
  });
  const usage = await ctx.db.get("userCardUsage", usageId);
  if (!usage) {
    throw new Error("Failed to insert card usage test fixture");
  }
  return usage;
};

describe("OCC contention behavior", () => {
  test("initializes usage with a bounded saturated scan", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let index = 0; index < FREE_TIER_LIMIT + 5; index += 1) {
        await insertCard(ctx, "user-1", { content: `Card ${index}` });
      }
      const usage = await getOrInitializeCardUsage(ctx, "user-1");
      expect(usage.activeCardCount).toBe(CARD_USAGE_SCAN_LIMIT);
      expect(usage.isCountExact).toBe(false);
      expect(usage.isSaturated).toBe(true);
      expect(CARD_USAGE_SCAN_LIMIT).toBe(FREE_TIER_LIMIT + 1);
    });
  });

  test("tracks create, delete, restore, and saturated recount transitions", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const initialUsage = await getOrInitializeCardUsage(ctx, "user-2");
      await initializeCardUsageShards(ctx, initialUsage);
      const cardId = await insertCard(ctx, "user-2");
      await recordActiveCardCreated(ctx, "user-2", cardId);
      expect((await getCardUsageSnapshot(ctx, "user-2"))?.activeCardCount).toBe(
        1
      );

      await ctx.db.patch("cards", cardId, {
        deletedAt: Date.now(),
        isDeleted: true,
      });
      await recordActiveCardRemoved(ctx, "user-2", cardId);
      expect((await getCardUsageSnapshot(ctx, "user-2"))?.activeCardCount).toBe(
        0
      );

      await ctx.db.patch("cards", cardId, {
        deletedAt: undefined,
        isDeleted: undefined,
      });
      await recordActiveCardCreated(ctx, "user-2", cardId);
      expect((await getCardUsageSnapshot(ctx, "user-2"))?.activeCardCount).toBe(
        1
      );
    });
  });

  test("rejects restore at the free-tier quota", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("userCardUsage", {
        userId: "user-3",
        activeCardCount: FREE_TIER_LIMIT,
        isSaturated: true,
        updatedAt: Date.now(),
      });
      await expect(
        ensureCardQuotaAvailable(ctx, "user-3", {
          getSubscription: async () => null,
        })
      ).rejects.toBeInstanceOf(ConvexError);
    });
  });

  test("enforces the exact free-tier limit across bounded usage shards", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = "user-sharded-limit";
      const usage = await insertExactUsage(ctx, userId, FREE_TIER_LIMIT - 1);
      expect(await initializeCardUsageShards(ctx, usage)).toBe(true);
      expect(await ctx.db.query("userCardUsageShards").collect()).toHaveLength(
        CARD_USAGE_TOTAL_SHARDS
      );

      const finalFreeCard = await insertCard(ctx, userId);
      await recordActiveCardCreated(ctx, userId, finalFreeCard);
      expect((await getCardUsageSnapshot(ctx, userId))?.activeCardCount).toBe(
        FREE_TIER_LIMIT
      );

      const overLimitCard = await insertCard(ctx, userId);
      await expect(
        recordActiveCardCreated(ctx, userId, overLimitCard)
      ).rejects.toMatchObject({
        data: expect.objectContaining({ code: "CARD_LIMIT_REACHED" }),
      });
      expect((await getCardUsageSnapshot(ctx, userId))?.activeCardCount).toBe(
        FREE_TIER_LIMIT
      );
    });
  });

  test("initializes shards before the first canonical card insert", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = "user-first-canonical-create";
      const authorization = await authorizeCardCreation(ctx, userId, {
        getSubscription: async () => null,
        rateLimiter: {
          limit: async () => ({ ok: true, retryAfter: 0 }),
        } as any,
      });
      expect((await getCardUsageSnapshot(ctx, userId))?.activeCardCount).toBe(
        0
      );

      const cardId = await insertCard(ctx, userId);
      await recordActiveCardCreated(ctx, userId, cardId, authorization);
      expect((await getCardUsageSnapshot(ctx, userId))?.activeCardCount).toBe(
        1
      );
    });
  });

  test("preserves premium overflow and drains it before base usage", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = "user-sharded-premium";
      const usage = await insertExactUsage(ctx, userId, FREE_TIER_LIMIT);
      await initializeCardUsageShards(ctx, usage);

      const premiumCard = await insertCard(ctx, userId);
      await recordActiveCardCreated(ctx, userId, premiumCard, {
        hasPremium: true,
      });
      expect((await getCardUsageSnapshot(ctx, userId))?.activeCardCount).toBe(
        FREE_TIER_LIMIT + 1
      );

      await recordActiveCardRemoved(ctx, userId, premiumCard);
      expect((await getCardUsageSnapshot(ctx, userId))?.activeCardCount).toBe(
        FREE_TIER_LIMIT
      );
      const overflowCount = (
        await ctx.db.query("userCardUsageShards").collect()
      )
        .filter((usage) => usage.shard >= CARD_USAGE_BASE_SHARDS)
        .reduce((sum, usage) => sum + usage.activeCardCount, 0);
      expect(overflowCount).toBe(0);
    });
  });

  test("allows downgraded users below the limit despite residual overflow", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = "user-sharded-downgraded";
      const usage = await insertExactUsage(ctx, userId, FREE_TIER_LIMIT + 1);
      await initializeCardUsageShards(ctx, usage);

      const baseShard = await ctx.db
        .query("userCardUsageShards")
        .withIndex("by_userId_and_shard", (query) =>
          query.eq("userId", userId).eq("shard", 0)
        )
        .unique();
      expect(baseShard).not.toBeNull();
      await ctx.db.patch("userCardUsageShards", baseShard!._id, {
        activeCardCount: baseShard!.activeCardCount - 2,
      });
      expect((await getCardUsageSnapshot(ctx, userId))?.activeCardCount).toBe(
        FREE_TIER_LIMIT - 1
      );

      const freeCard = await insertCard(ctx, userId);
      await recordActiveCardCreated(ctx, userId, freeCard);
      expect((await getCardUsageSnapshot(ctx, userId))?.activeCardCount).toBe(
        FREE_TIER_LIMIT
      );
    });
  });

  test("initializes saturated accounts without losing overflow usage", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = "user-sharded-saturated";
      const saturatedCount = FREE_TIER_LIMIT + 17;
      const usage = await insertExactUsage(ctx, userId, saturatedCount);
      await initializeCardUsageShards(ctx, usage);
      const snapshot = await getCardUsageSnapshot(ctx, userId);
      expect(snapshot?.activeCardCount).toBe(saturatedCount);
      expect(snapshot?.isSaturated).toBe(true);

      const cardId = await insertCard(ctx, userId);
      await expect(
        recordActiveCardCreated(ctx, userId, cardId)
      ).rejects.toMatchObject({
        data: expect.objectContaining({ code: "CARD_LIMIT_REACHED" }),
      });
    });
  });

  test("initializes, repairs, and removes usage shards", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = "user-shard-migration";
      const usage = await insertExactUsage(ctx, userId, 37);
      await ctx.db.insert("userCardUsageShards", {
        userId,
        shard: 0,
        activeCardCount: 999,
        updatedAt: Date.now(),
      });

      await initializeCardUsageShards(ctx, usage);
      expect((await getCardUsageSnapshot(ctx, userId))?.activeCardCount).toBe(
        37
      );
      expect(
        await ctx.db
          .query("userCardUsageShards")
          .withIndex("by_userId_and_shard", (query) =>
            query.eq("userId", userId)
          )
          .collect()
      ).toHaveLength(CARD_USAGE_TOTAL_SHARDS);

      await removeCardUsage(ctx, userId);
      expect(await ctx.db.get("userCardUsage", usage._id)).toBeNull();
      expect(await ctx.db.query("userCardUsageShards").collect()).toHaveLength(
        0
      );
    });
  });

  test("rejects a versioned but incomplete shard set", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = "user-incomplete-shards";
      const usage = await insertExactUsage(ctx, userId, 4);
      await initializeCardUsageShards(ctx, usage);
      const shard = await ctx.db
        .query("userCardUsageShards")
        .withIndex("by_userId_and_shard", (query) =>
          query.eq("userId", userId).eq("shard", 0)
        )
        .unique();
      expect(shard).not.toBeNull();
      await ctx.db.delete(
        "userCardUsageShards",
        shard?._id as Id<"userCardUsageShards">
      );
      const versionedUsage = await ctx.db.get("userCardUsage", usage._id);
      await expect(
        initializeCardUsageShards(ctx, versionedUsage as Doc<"userCardUsage">)
      ).rejects.toThrow("incomplete");
    });
  });

  test("blocks canonical writes once account deletion begins", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await beginAccountDeletion(ctx, "user-deleting");
      await expect(
        assertAccountNotDeleting(ctx, "user-deleting")
      ).rejects.toMatchObject({
        data: expect.objectContaining({
          code: "ACCOUNT_DELETION_IN_PROGRESS",
        }),
      });
    });
    await expect(
      t.mutation(internal["card/defaultCards"].createDefaultCardsForUser, {
        userId: "user-deleting",
      })
    ).rejects.toMatchObject({
      data: expect.objectContaining({
        code: "ACCOUNT_DELETION_IN_PROGRESS",
      }),
    });
  });

  test("composes all general fields for canonical search documents", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const firstId = await insertCard(ctx, "user-4", {
        aiSummary: "summary",
        aiTags: ["ai-tag"],
        aiTranscript: "transcript",
        content: "content",
        metadataDescription: "description",
        metadataTitle: "title",
        notes: "notes",
        tags: ["tag"],
      });
      const first = await ctx.db.get("cards", firstId);
      expect(first).not.toBeNull();
      expect(buildCardSearchText(first as Doc<"cards">).split("\n")).toEqual([
        "content",
        "notes",
        "summary",
        "transcript",
        "title",
        "description",
        "tag",
        "ai-tag",
      ]);
      expect(getSearchResultLimit(25)).toBe(25);
    });
  });

  test("returns a full page from canonical search documents", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let index = 0; index < 50; index += 1) {
        const cardId = await insertCard(ctx, "user-overlap", {
          content: `overlap Card ${index}`,
          updatedAt: index,
        });
        await syncCardSearchDocumentHandler(ctx, cardId);
      }

      const desiredPageSize = 25;
      const unique = await searchCardsByDocument(ctx, {
        userId: "user-overlap",
        searchQuery: "overlap",
        isDeleted: undefined,
        limit: desiredPageSize * 2,
      });
      expect(unique.slice(desiredPageSize, desiredPageSize * 2)).toHaveLength(
        desiredPageSize
      );
    });
  });

  test("stale search work converges on the latest card state", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const cardId = await insertCard(ctx, "user-5", {
        content: "old",
        updatedAt: 10,
      });
      await syncCardSearchDocumentHandler(ctx, cardId);
      await ctx.db.patch("cards", cardId, { content: "latest", updatedAt: 20 });
      await syncCardSearchDocumentHandler(ctx, cardId);
      const document = await ctx.db
        .query("cardSearchDocuments")
        .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
        .unique();
      expect(document?.searchableText).toBe("latest");
      expect(document?.sourceUpdatedAt).toBe(20);
    });
  });

  test("deletes account cards and search documents in bounded batches", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let index = 0; index < 21; index += 1) {
        const cardId = await insertCard(ctx, "user-delete", {
          content: `Card ${index}`,
        });
        await syncCardSearchDocumentHandler(ctx, cardId);
      }
      const firstBatch = await getAccountCardDeletionBatchHandler(
        ctx,
        "user-delete"
      );
      expect(firstBatch.cardIds).toHaveLength(20);
      expect(
        await deleteAccountDataHandler(ctx, "user-delete", firstBatch.cardIds)
      ).toBe(20);
      expect(
        await ctx.db
          .query("cards")
          .withIndex("by_user_deleted", (query) =>
            query.eq("userId", "user-delete")
          )
          .collect()
      ).toHaveLength(1);
      expect(await ctx.db.query("cardSearchDocuments").collect()).toHaveLength(
        1
      );

      const secondBatch = await getAccountCardDeletionBatchHandler(
        ctx,
        "user-delete"
      );
      expect(secondBatch.cardIds).toHaveLength(1);
      expect(
        await deleteAccountDataHandler(ctx, "user-delete", secondBatch.cardIds)
      ).toBe(1);
      expect(await ctx.db.query("cardSearchDocuments").collect()).toHaveLength(
        0
      );
    });
  });

  test("enforces the configured card-creation threshold", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t, "rateLimiterV2");
    await t.run(async (ctx) => {
      let accepted = 0;
      let rejected = 0;
      for (let count = 0; count < 60; count += 1) {
        const result = await rateLimiter.limit(ctx, "cardCreation", {
          key: "rate-user",
          throws: false,
        });
        if (result.ok) {
          accepted += 1;
        } else {
          rejected += 1;
        }
      }
      expect(accepted).toBeGreaterThan(0);
      expect(accepted).toBeLessThanOrEqual(30);
      expect(rejected).toBeGreaterThan(0);
      expect(RATE_LIMIT_CONFIG.cardCreation).toMatchObject({
        capacity: 30,
        rate: 30,
        shards: 6,
      });
      expect(RATE_LIMIT_CONFIG.raycastApiRequests).toMatchObject({
        capacity: 120,
        rate: 120,
        shards: 12,
      });
      expect(RATE_LIMIT_CONFIG.invalidApiAuth).toMatchObject({
        capacity: 60,
        rate: 60,
        shards: 6,
      });
      expect(RATE_LIMIT_CONFIG.nativeAuthPoll).toMatchObject({
        capacity: 20,
        rate: 20,
        shards: 2,
      });
      expect(RATE_LIMIT_CONFIG.apiKeyCreation).toMatchObject({
        capacity: 5,
        rate: 5,
      });
      expect("shards" in RATE_LIMIT_CONFIG.apiKeyCreation).toBe(false);
      for (let count = 0; count < 5; count += 1) {
        await expect(
          rateLimiter.limit(ctx, "apiKeyCreation", {
            key: "api-key-user",
            throws: false,
          })
        ).resolves.toMatchObject({ ok: true });
      }
      await expect(
        rateLimiter.limit(ctx, "apiKeyCreation", {
          key: "api-key-user",
          throws: false,
        })
      ).resolves.toMatchObject({ ok: false });
    });
  });

  test("preserves the threshold after the gated 3-to-6 shard transition", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-31T00:00:00.000Z"));
      const t = convexTest(schema, modules);
      rateLimiterTest.register(t, "rateLimiterV2");
      const previousLimiter = new RateLimiter(components.rateLimiterV2, {
        cardCreation: {
          capacity: 30,
          kind: "token bucket",
          period: MINUTE,
          rate: 30,
          shards: 3,
        },
      });

      await t.run(async (ctx) => {
        for (let count = 0; count < 30; count += 1) {
          await previousLimiter.limit(ctx, "cardCreation", {
            key: "transition-user",
          });
        }
      });

      vi.advanceTimersByTime(MINUTE);
      await t.run(async (ctx) => {
        let accepted = 0;
        for (let count = 0; count < 60; count += 1) {
          const result = await rateLimiter.limit(ctx, "cardCreation", {
            key: "transition-user",
            throws: false,
          });
          if (result.ok) {
            accepted += 1;
          }
        }
        expect(accepted).toBeGreaterThan(0);
        expect(accepted).toBeLessThanOrEqual(30);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("aggregates legacy and sharded idempotency analytics", async () => {
    const t = convexTest(schema, modules);
    const date = new Date().toISOString().slice(0, 10);
    await t.run(async (ctx) => {
      const base = {
        date,
        endpoint: "POST /v1/cards",
        totalRequests: 2,
        withKey: 1,
        skipped: 1,
        started: 1,
        replayed: 0,
        conflicts: 0,
        inProgress: 0,
        errors: 0,
      };
      await ctx.db.insert("apiIdempotencyAnalytics", base);
      await ctx.db.insert("apiIdempotencyAnalytics", {
        ...base,
        shard: 3,
        totalRequests: 4,
        withKey: 4,
        skipped: 0,
        started: 2,
        replayed: 2,
      });
    });
    const rows = await t.query(
      api.idempotencyAnalytics.getIdempotencyAnalytics,
      {
        days: 1,
      }
    );
    expect(rows).toEqual([
      expect.objectContaining({
        endpoint: "POST /v1/cards",
        replayed: 2,
        totalRequests: 6,
        withKey: 5,
      }),
    ]);
  });

  test("chooses stable deterministic analytics shards", () => {
    const first = analyticsShardForRequest("request-123");
    expect(analyticsShardForRequest("request-123")).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(IDEMPOTENCY_ANALYTICS_SHARDS);
    expect(
      new Set(
        Array.from({ length: 64 }, (_, index) =>
          analyticsShardForRequest(`request-${index}`)
        )
      ).size
    ).toBeGreaterThan(1);
  });
});
