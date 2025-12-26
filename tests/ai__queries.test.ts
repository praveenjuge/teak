// @ts-nocheck
import { describe, expect, test, mock, beforeEach } from "bun:test";

describe("ai/queries.ts", () => {
  let getCardForAI: any;
  let findCardsMissingAi: any;
  let getCardForVerification: any;

  beforeEach(async () => {
    const module = await import("../convex/ai/queries");
    getCardForAI = module.getCardForAI;
    findCardsMissingAi = module.findCardsMissingAi;
    getCardForVerification = module.getCardForVerification;
  });

  test("getCardForAI fetches card", async () => {
    const ctx = { db: { get: mock().mockResolvedValue({ _id: "c1" }) } } as any;
    const handler = (getCardForAI as any).handler ?? getCardForAI;
    const result = await handler(ctx, { cardId: "c1" });
    expect(ctx.db.get).toHaveBeenCalledWith("cards", "c1");
    expect(result).toEqual({ _id: "c1" });
  });

  test("findCardsMissingAi maps to card ids", async () => {
    const mockQuery = {
      filter: mock().mockReturnThis(),
      take: mock().mockResolvedValue([
        { _id: "c1" },
        { _id: "c2" },
      ]),
    } as any;
    const ctx = { db: { query: mock().mockReturnValue(mockQuery) } } as any;
    const handler = (findCardsMissingAi as any).handler ?? findCardsMissingAi;
    const result = await handler(ctx, {});
    expect(result).toEqual([{ cardId: "c1" }, { cardId: "c2" }]);
  });

  test("getCardForVerification returns null when missing or wrong user", async () => {
    const ctx = { db: { get: mock().mockResolvedValue({ userId: "u2" }) } } as any;
    const handler = (getCardForVerification as any).handler ?? getCardForVerification;
    const result = await handler(ctx, { cardId: "c1", userId: "u1" });
    expect(result).toBeNull();
  });

  test("getCardForVerification returns exists when match", async () => {
    const ctx = { db: { get: mock().mockResolvedValue({ userId: "u1" }) } } as any;
    const handler = (getCardForVerification as any).handler ?? getCardForVerification;
    const result = await handler(ctx, { cardId: "c1", userId: "u1" });
    expect(result).toEqual({ exists: true });
  });
});
