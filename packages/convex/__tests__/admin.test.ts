// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { r2Mocks, r2MockModuleFactory } from "./helpers/r2Mock.test-utils";

mock.module("../storage/r2", r2MockModuleFactory);

describe("admin.ts", () => {
  let getAccess: any;
  let getLegacyApiKeyUsageAnalytics: any;
  let getOverview: any;
  let resetCardProcessingState: any;
  let refreshCardProcessing: any;

  beforeEach(async () => {
    const module = await import("../admin");
    getAccess = module.getAccess;
    getLegacyApiKeyUsageAnalytics = module.getLegacyApiKeyUsageAnalytics;
    getOverview = module.getOverview;
    resetCardProcessingState = module.resetCardProcessingState;
    refreshCardProcessing = module.refreshCardProcessing;
  });

  describe("getAccess", () => {
    test("returns not allowed when unauthenticated", async () => {
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue(null) },
      } as any;
      const handler = (getAccess as any).handler ?? getAccess;
      const result = await handler(ctx, {});
      expect(result).toEqual({ allowed: false });
    });

    test("returns not allowed when no users exist", async () => {
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        runQuery: mock().mockResolvedValue({ page: [] }),
      } as any;
      const handler = (getAccess as any).handler ?? getAccess;
      const result = await handler(ctx, {});
      expect(result).toEqual({ allowed: false });
    });

    test("returns allowed when user is first user", async () => {
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        runQuery: mock().mockResolvedValue({ page: [{ _id: "u1" }] }),
      } as any;
      const handler = (getAccess as any).handler ?? getAccess;
      const result = await handler(ctx, {});
      expect(result).toEqual({ allowed: true });
    });

    test("returns not allowed when user is not first user", async () => {
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u2" }) },
        runQuery: mock().mockResolvedValue({ page: [{ _id: "u1" }] }),
      } as any;
      const handler = (getAccess as any).handler ?? getAccess;
      const result = await handler(ctx, {});
      expect(result).toEqual({ allowed: false });
    });
  });

  describe("getLegacyApiKeyUsageAnalytics", () => {
    test("throws when unauthorized", async () => {
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue(null) },
        runQuery: mock().mockResolvedValue({ page: [] }),
      } as any;
      const handler =
        (getLegacyApiKeyUsageAnalytics as any).handler ??
        getLegacyApiKeyUsageAnalytics;

      await expect(handler(ctx, {})).rejects.toThrow("Unauthorized");
    });

    test("returns default legacy key usage analytics for admin", async () => {
      const now = Date.UTC(2026, 0, 31, 12, 0, 0);
      const originalDateNow = Date.now;
      Date.now = () => now;
      try {
        const totalsRows = [
          {
            _id: "totals_1",
            date: "2026-01-31",
            firstUsedAt: now - 10_000,
            lastUsedAt: now,
            observedUseCount: 3,
            uniqueKeyCount: 2,
            uniqueUserCount: 1,
            updatedAt: now,
          },
        ];
        const keyRows = [
          {
            _id: "usage_older",
            date: "2026-01-31",
            legacyKeyId: "legacy_older",
            userId: "user_1",
            keyPrefix: "older",
            observedUseCount: 1,
            firstUsedAt: now - 20_000,
            lastUsedAt: now - 20_000,
            updatedAt: now - 20_000,
          },
          {
            _id: "usage_newer",
            date: "2026-01-31",
            legacyKeyId: "legacy_newer",
            userId: "user_1",
            keyPrefix: "newer",
            observedUseCount: 2,
            firstUsedAt: now - 10_000,
            lastUsedAt: now,
            lastEndpoint: "/v1/cards/search",
            lastMethod: "GET",
            updatedAt: now,
          },
        ];
        const ctx = {
          auth: {
            getUserIdentity: mock().mockResolvedValue({ subject: "user_1" }),
          },
          runQuery: mock().mockResolvedValue({ page: [{ _id: "user_1" }] }),
          db: {
            query: mock((table: string) => ({
              withIndex: mock(() => ({
                order: mock(() => ({
                  take: mock().mockResolvedValue(
                    table === "legacyApiKeyUsageTotalsDaily"
                      ? totalsRows
                      : keyRows
                  ),
                })),
              })),
            })),
          },
        } as any;
        const handler =
          (getLegacyApiKeyUsageAnalytics as any).handler ??
          getLegacyApiKeyUsageAnalytics;

        const result = await handler(ctx, {});

        expect(result.days).toBe(30);
        expect(result.windowStartDate).toBe("2026-01-02");
        expect(result.totals).toEqual([
          expect.objectContaining({
            date: "2026-01-31",
            observedUseCount: 3,
            uniqueKeyCount: 2,
            uniqueUserCount: 1,
          }),
        ]);
        expect(result.recentLegacyKeys.map((row: any) => row.legacyKeyId)).toEqual(
          ["legacy_newer", "legacy_older"]
        );
      } finally {
        Date.now = originalDateNow;
      }
    });

    test("supports a custom bounded analytics window", async () => {
      const now = Date.UTC(2026, 0, 31, 12, 0, 0);
      const originalDateNow = Date.now;
      Date.now = () => now;
      try {
        const takeCalls: number[] = [];
        const ctx = {
          auth: {
            getUserIdentity: mock().mockResolvedValue({ subject: "user_1" }),
          },
          runQuery: mock().mockResolvedValue({ page: [{ _id: "user_1" }] }),
          db: {
            query: mock((table: string) => ({
              withIndex: mock(() => ({
                order: mock(() => ({
                  take: mock((limit: number) => {
                    takeCalls.push(limit);
                    return Promise.resolve([]);
                  }),
                })),
              })),
            })),
          },
        } as any;
        const handler =
          (getLegacyApiKeyUsageAnalytics as any).handler ??
          getLegacyApiKeyUsageAnalytics;

        const result = await handler(ctx, { days: 7 });

        expect(result.days).toBe(7);
        expect(result.windowStartDate).toBe("2026-01-25");
        expect(takeCalls).toEqual([7, 200]);
      } finally {
        Date.now = originalDateNow;
      }
    });
  });

  describe("getOverview", () => {
    test("throws when unauthorized", async () => {
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue(null) },
        runQuery: mock().mockResolvedValue({ page: [] }),
      } as any;
      const handler = (getOverview as any).handler ?? getOverview;
      await expect(handler(ctx, {})).rejects.toThrow("Unauthorized");
    });

    test("returns empty overview when no cards", async () => {
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        runQuery: mock().mockResolvedValue({ page: [{ _id: "u1" }] }),
        db: {
          query: mock().mockReturnValue({ take: mock().mockResolvedValue([]) }),
        },
      } as any;
      const handler = (getOverview as any).handler ?? getOverview;
      const result = await handler(ctx, {});

      expect(result.totals.totalCards).toBe(0);
      expect(result.totals.activeCards).toBe(0);
      expect(result.totals.deletedCards).toBe(0);
    });

    test("counts cards by type correctly", async () => {
      const cards = [
        {
          _id: "c1",
          type: "image",
          isDeleted: undefined,
          userId: "u1",
          createdAt: Date.now(),
          metadataStatus: "completed",
        },
        {
          _id: "c2",
          type: "image",
          isDeleted: undefined,
          userId: "u1",
          createdAt: Date.now(),
          metadataStatus: "completed",
        },
        {
          _id: "c3",
          type: "link",
          isDeleted: undefined,
          userId: "u1",
          createdAt: Date.now(),
          metadataStatus: "completed",
        },
      ];
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        runQuery: mock().mockResolvedValue({ page: [{ _id: "u1" }] }),
        db: {
          query: mock().mockReturnValue({
            take: mock().mockResolvedValue(cards),
          }),
        },
      } as any;
      const handler = (getOverview as any).handler ?? getOverview;
      const result = await handler(ctx, {});

      expect(result.totals.totalCards).toBe(3);
      expect(result.cardsByType.image).toBe(2);
      expect(result.cardsByType.link).toBe(1);
    });

    test("counts metadata status correctly", async () => {
      const cards = [
        {
          _id: "c1",
          type: "link",
          isDeleted: undefined,
          metadataStatus: "pending",
          userId: "u1",
          createdAt: Date.now(),
        },
        {
          _id: "c2",
          type: "link",
          isDeleted: undefined,
          metadataStatus: "completed",
          userId: "u1",
          createdAt: Date.now(),
        },
        {
          _id: "c3",
          type: "link",
          isDeleted: undefined,
          metadataStatus: "failed",
          userId: "u1",
          createdAt: Date.now(),
        },
      ];
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        runQuery: mock().mockResolvedValue({ page: [{ _id: "u1" }] }),
        db: {
          query: mock().mockReturnValue({
            take: mock().mockResolvedValue(cards),
          }),
        },
      } as any;
      const handler = (getOverview as any).handler ?? getOverview;
      const result = await handler(ctx, {});

      expect(result.metadataStatus.pending).toBe(1);
      expect(result.metadataStatus.completed).toBe(1);
      expect(result.metadataStatus.failed).toBe(1);
    });

    test("identifies cards missing AI metadata", async () => {
      const cards = [
        {
          _id: "c1",
          type: "text",
          isDeleted: undefined,
          aiSummary: undefined,
          aiTags: undefined,
          aiTranscript: undefined,
          userId: "u1",
          createdAt: Date.now(),
        },
      ];
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        runQuery: mock().mockResolvedValue({ page: [{ _id: "u1" }] }),
        db: {
          query: mock().mockReturnValue({
            take: mock().mockResolvedValue(cards),
          }),
        },
      } as any;
      const handler = (getOverview as any).handler ?? getOverview;
      const result = await handler(ctx, {});

      expect(result.aiPipeline.missingAiMetadata).toBe(1);
      expect(result.aiPipeline.missingCards).toHaveLength(1);
    });

    test("marks isApproximate when limit reached", async () => {
      const cards = Array.from({ length: 10_000 }, (_, i) => ({
        _id: `c${i}`,
        type: "text",
        isDeleted: undefined,
        userId: "u1",
        createdAt: Date.now(),
      }));
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        runQuery: mock().mockResolvedValue({ page: [{ _id: "u1" }] }),
        db: {
          query: mock().mockReturnValue({
            take: mock().mockResolvedValue(cards),
          }),
        },
      } as any;
      const handler = (getOverview as any).handler ?? getOverview;
      const result = await handler(ctx, {});

      expect(result.isApproximate).toBe(true);
    });

    test("counts unique users", async () => {
      const cards = [
        {
          _id: "c1",
          userId: "u1",
          type: "text",
          isDeleted: undefined,
          createdAt: Date.now(),
        },
        {
          _id: "c2",
          userId: "u2",
          type: "text",
          isDeleted: undefined,
          createdAt: Date.now(),
        },
        {
          _id: "c3",
          userId: "u1",
          type: "text",
          isDeleted: undefined,
          createdAt: Date.now(),
        },
      ];
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        runQuery: mock().mockResolvedValue({ page: [{ _id: "u1" }] }),
        db: {
          query: mock().mockReturnValue({
            take: mock().mockResolvedValue(cards),
          }),
        },
      } as any;
      const handler = (getOverview as any).handler ?? getOverview;
      const result = await handler(ctx, {});

      expect(result.totals.uniqueUsers).toBe(2);
    });
  });

  describe("resetCardProcessingState", () => {
    test("throws when card not found", async () => {
      const ctx = {
        db: { get: mock().mockResolvedValue(null) },
      } as any;
      const handler =
        (resetCardProcessingState as any).handler ?? resetCardProcessingState;
      await expect(handler(ctx, { cardId: "c1" })).rejects.toThrow(
        "c1 not found"
      );
    });

    test("clears thumbnail and resets processing status", async () => {
      r2Mocks.deleteObject.mockClear();
      const card = {
        _id: "c1",
        thumbnailKey: "t1",
        processingStatus: { classify: { status: "completed" } },
      };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(card),
          patch: mock().mockResolvedValue(null),
        },
      } as any;
      const handler =
        (resetCardProcessingState as any).handler ?? resetCardProcessingState;
      const result = await handler(ctx, { cardId: "c1" });

      expect(r2Mocks.deleteObject).toHaveBeenCalledWith(ctx, "t1");
      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          thumbnailKey: undefined,
          aiTags: undefined,
          aiSummary: undefined,
          aiTranscript: undefined,
        })
      );
      expect(result.clearedThumbnail).toBe(true);
    });

    test("handles missing thumbnail", async () => {
      r2Mocks.deleteObject.mockClear();
      const card = {
        _id: "c1",
        processingStatus: { classify: { status: "completed" } },
      };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(card),
          patch: mock().mockResolvedValue(null),
        },
      } as any;
      const handler =
        (resetCardProcessingState as any).handler ?? resetCardProcessingState;
      const result = await handler(ctx, { cardId: "c1" });

      expect(r2Mocks.deleteObject).not.toHaveBeenCalled();
      expect(result.clearedThumbnail).toBe(false);
    });

    test("handles storage delete error gracefully", async () => {
      r2Mocks.deleteObject.mockReset();
      r2Mocks.deleteObject.mockRejectedValueOnce(new Error("Storage error"));
      const card = {
        _id: "c1",
        thumbnailKey: "t1",
        processingStatus: {},
      };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(card),
          patch: mock().mockResolvedValue(null),
        },
      } as any;
      const handler =
        (resetCardProcessingState as any).handler ?? resetCardProcessingState;
      const result = await handler(ctx, { cardId: "c1" });

      expect(result.clearedThumbnail).toBe(true);
      // Reset to default for subsequent tests
      r2Mocks.deleteObject.mockResolvedValue(null);
    });
  });

  describe("refreshCardProcessing", () => {
    test("throws when unauthorized", async () => {
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue(null) },
        runQuery: mock().mockResolvedValue({ page: [] }),
        runMutation: mock(),
        scheduler: { runAfter: mock() },
      } as any;
      const handler =
        (refreshCardProcessing as any).handler ?? refreshCardProcessing;
      await expect(handler(ctx, { cardId: "c1" })).rejects.toThrow(
        "Unauthorized"
      );
    });

    test("returns not_found when card missing", async () => {
      let callCount = 0;
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        runQuery: mock().mockImplementation(() => {
          callCount++;
          return callCount === 1
            ? Promise.resolve({ page: [{ _id: "u1" }] })
            : Promise.resolve(null);
        }),
        runMutation: mock(),
        scheduler: { runAfter: mock() },
      } as any;
      const handler =
        (refreshCardProcessing as any).handler ?? refreshCardProcessing;
      const result = await handler(ctx, { cardId: "c1" });

      expect(result.success).toBe(false);
      expect(result.reason).toBe("not_found");
    });

    test("resets processing and schedules workflow", async () => {
      let callCount = 0;
      const card = { _id: "c1" };
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        runQuery: mock().mockImplementation(() => {
          callCount++;
          return callCount === 1
            ? Promise.resolve({ page: [{ _id: "u1" }] })
            : Promise.resolve(card);
        }),
        runMutation: mock().mockResolvedValue({ clearedThumbnail: false }),
        scheduler: { runAfter: mock().mockResolvedValue(null) },
      } as any;
      const handler =
        (refreshCardProcessing as any).handler ?? refreshCardProcessing;
      const result = await handler(ctx, { cardId: "c1" });

      expect(ctx.runMutation).toHaveBeenCalled();
      expect(ctx.scheduler.runAfter).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });
});
