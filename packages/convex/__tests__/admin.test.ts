// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";

describe("admin.ts", () => {
  let getAccess: any;
  let getOverview: any;
  let resetCardProcessingState: any;
  let refreshCardProcessing: any;

  beforeEach(async () => {
    const module = await import("../admin");
    getAccess = module.getAccess;
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
      const card = {
        _id: "c1",
        thumbnailId: "t1",
        processingStatus: { classify: { status: "completed" } },
      };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(card),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock().mockResolvedValue(null) },
      } as any;
      const handler =
        (resetCardProcessingState as any).handler ?? resetCardProcessingState;
      const result = await handler(ctx, { cardId: "c1" });

      expect(ctx.storage.delete).toHaveBeenCalledWith("t1");
      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          thumbnailId: undefined,
          aiTags: undefined,
          aiSummary: undefined,
          aiTranscript: undefined,
        })
      );
      expect(result.clearedThumbnail).toBe(true);
    });

    test("handles missing thumbnail", async () => {
      const card = {
        _id: "c1",
        processingStatus: { classify: { status: "completed" } },
      };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(card),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock() },
      } as any;
      const handler =
        (resetCardProcessingState as any).handler ?? resetCardProcessingState;
      const result = await handler(ctx, { cardId: "c1" });

      expect(ctx.storage.delete).not.toHaveBeenCalled();
      expect(result.clearedThumbnail).toBe(false);
    });

    test("handles storage delete error gracefully", async () => {
      const card = {
        _id: "c1",
        thumbnailId: "t1",
        processingStatus: {},
      };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(card),
          patch: mock().mockResolvedValue(null),
        },
        storage: {
          delete: mock().mockRejectedValue(new Error("Storage error")),
        },
      } as any;
      const handler =
        (resetCardProcessingState as any).handler ?? resetCardProcessingState;
      const result = await handler(ctx, { cardId: "c1" });

      expect(result.clearedThumbnail).toBe(true);
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
