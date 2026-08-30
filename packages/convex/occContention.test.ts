/// <reference types="vite/client" />

import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
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
  CARD_USAGE_SCAN_LIMIT,
  getOrInitializeCardUsage,
  recordActiveCardCreated,
  recordActiveCardRemoved,
} from "./card/cardUsage";
import { getDualReadSearchLimit } from "./card/getCards";
import { ensureCardQuotaAvailable } from "./card/quota";
import {
  buildCardSearchText,
  deduplicateCardSearchResults,
  searchCardsAcrossGeneralIndexes,
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
      await getOrInitializeCardUsage(ctx, "user-2");
      const cardId = await insertCard(ctx, "user-2");
      await recordActiveCardCreated(ctx, "user-2", cardId);
      let usage = await ctx.db
        .query("userCardUsage")
        .withIndex("by_userId", (query) => query.eq("userId", "user-2"))
        .unique();
      expect(usage?.activeCardCount).toBe(1);

      await ctx.db.patch("cards", cardId, {
        deletedAt: Date.now(),
        isDeleted: true,
      });
      await recordActiveCardRemoved(ctx, "user-2", cardId);
      usage = await ctx.db
        .query("userCardUsage")
        .withIndex("by_userId", (query) => query.eq("userId", "user-2"))
        .unique();
      expect(usage?.activeCardCount).toBe(0);

      await ctx.db.patch("cards", cardId, {
        deletedAt: undefined,
        isDeleted: undefined,
      });
      await recordActiveCardCreated(ctx, "user-2", cardId);
      usage = await ctx.db
        .query("userCardUsage")
        .withIndex("by_userId", (query) => query.eq("userId", "user-2"))
        .unique();
      expect(usage?.activeCardCount).toBe(1);

      await ctx.db.patch("userCardUsage", usage?._id as Id<"userCardUsage">, {
        activeCardCount: FREE_TIER_LIMIT,
        isCountExact: false,
        isSaturated: true,
      });
      await recordActiveCardRemoved(ctx, "user-2", cardId);
      usage = await ctx.db
        .query("userCardUsage")
        .withIndex("by_userId", (query) => query.eq("userId", "user-2"))
        .unique();
      expect(usage?.activeCardCount).toBe(1);
      expect(usage?.isSaturated).toBe(false);
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

  test("keeps the exact-count backfill coherent with live transitions", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = "user-count-migration";
      const cardId = await insertCard(ctx, userId);
      const usageId = await ctx.db.insert("userCardUsage", {
        userId,
        activeCardCount: CARD_USAGE_SCAN_LIMIT,
        isCountExact: false,
        isSaturated: true,
        migrationActiveCardCount: 1,
        migrationCountStartedAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("cardUsageMigrationEntries", {
        cardId,
        userId,
        countedActive: true,
        createdAt: Date.now(),
      });

      await ctx.db.patch("cards", cardId, { isDeleted: true });
      await recordActiveCardRemoved(ctx, userId, cardId);
      let usage = await ctx.db.get("userCardUsage", usageId);
      expect(usage?.migrationActiveCardCount).toBe(0);

      await ctx.db.patch("cards", cardId, { isDeleted: undefined });
      await recordActiveCardCreated(ctx, userId, cardId);
      usage = await ctx.db.get("userCardUsage", usageId);
      expect(usage?.migrationActiveCardCount).toBe(1);
      const entry = await ctx.db
        .query("cardUsageMigrationEntries")
        .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
        .unique();
      expect(entry?.countedActive).toBe(true);
    });
  });

  test("composes all general fields and deduplicates dual-read results", async () => {
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
      const secondId = await insertCard(ctx, "user-4", { content: "legacy" });
      const first = await ctx.db.get("cards", firstId);
      const second = await ctx.db.get("cards", secondId);
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
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
      expect(
        deduplicateCardSearchResults([
          [first as Doc<"cards">],
          [first as Doc<"cards">, second as Doc<"cards">],
        ]).map((card) => card._id)
      ).toEqual([firstId, secondId]);
      expect(getDualReadSearchLimit(25)).toBe(25);
    });
  });

  test("oversamples dual reads so overlap does not hide the next page", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let index = 0; index < 50; index += 1) {
        const cardId = await insertCard(ctx, "user-overlap", {
          content: `overlap Card ${index}`,
          updatedAt: index,
        });
        if (index < 25) {
          await syncCardSearchDocumentHandler(ctx, cardId);
        }
      }

      const desiredPageSize = 25;
      const unique = await searchCardsAcrossGeneralIndexes(ctx, {
        userId: "user-overlap",
        searchQuery: "overlap",
        isDeleted: undefined,
        legacyFields: new Set(["content"]),
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

  test("live writes protect migration-created records from rollback", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = "user-migration";
      const cardId = await insertCard(ctx, userId);
      const usage = await getOrInitializeCardUsage(ctx, userId, {
        migrationBackfill: true,
      });
      await syncCardSearchDocumentHandler(ctx, cardId, {
        migrationBackfill: true,
      });
      let document = await ctx.db
        .query("cardSearchDocuments")
        .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
        .unique();
      expect(usage.migrationBackfilledAt).toBeTypeOf("number");
      expect(document?.migrationBackfilledAt).toBeTypeOf("number");

      await recordActiveCardCreated(ctx, userId, cardId);
      await syncCardSearchDocumentHandler(ctx, cardId);
      const liveUsage = await ctx.db.get("userCardUsage", usage._id);
      document = await ctx.db
        .query("cardSearchDocuments")
        .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
        .unique();
      expect(liveUsage?.migrationBackfilledAt).toBeUndefined();
      expect(document?.migrationBackfilledAt).toBeUndefined();
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
        shards: 3,
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
