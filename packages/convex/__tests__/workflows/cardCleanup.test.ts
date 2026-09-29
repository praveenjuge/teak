// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";

describe("workflows/cardCleanup", () => {
  describe("getCardsPendingCleanup", () => {
    test("handler applies the complete deletion range and maps ids", async () => {
      const module = await import("../../workflows/cardCleanup");
      const range = {
        eq: mock().mockReturnThis(),
        gte: mock().mockReturnThis(),
        lt: mock().mockReturnThis(),
      };
      const queryable = {
        withIndex: mock().mockImplementation((_name: string, callback: any) => {
          callback(range);
          return queryable;
        }),
        take: mock().mockResolvedValue([{ _id: "c1" }, { _id: "c2" }]),
      } as any;
      const ctx = { db: { query: mock().mockReturnValue(queryable) } } as any;
      const handler =
        (module.getCardsPendingCleanup as any).handler ??
        module.getCardsPendingCleanup;
      const result = await handler(ctx, { olderThan: 1234, limit: 10 });

      expect(ctx.db.query).toHaveBeenCalledWith("cards");
      expect(queryable.withIndex).toHaveBeenCalledWith(
        "by_isDeleted_deletedAt",
        expect.any(Function)
      );
      expect(range.eq).toHaveBeenCalledWith("isDeleted", true);
      expect(range.gte).toHaveBeenCalledWith("deletedAt", 0);
      expect(range.lt).toHaveBeenCalledWith("deletedAt", 1234);
      expect(queryable.take).toHaveBeenCalledWith(10);
      expect(result).toEqual([{ _id: "c1" }, { _id: "c2" }]);
    });
  });
});
