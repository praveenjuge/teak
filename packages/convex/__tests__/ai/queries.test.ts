import { beforeEach, describe, expect, mock, test } from "bun:test";

describe("ai/queries.ts", () => {
  let getCardForAI: any;

  beforeEach(async () => {
    const module = await import("../../ai/queries");
    getCardForAI = module.getCardForAI;
  });

  test("getCardForAI fetches card", async () => {
    const ctx = { db: { get: mock().mockResolvedValue({ _id: "c1" }) } } as any;
    const handler = (getCardForAI as any).handler ?? getCardForAI;
    const result = await handler(ctx, { cardId: "c1" });
    expect(ctx.db.get).toHaveBeenCalledWith("cards", "c1");
    expect(result).toEqual({ _id: "c1" });
  });

  test("getCardForAI returns null for missing card", async () => {
    const ctx = { db: { get: mock().mockResolvedValue(null) } } as any;
    const handler = (getCardForAI as any).handler ?? getCardForAI;
    const result = await handler(ctx, { cardId: "c1" });
    expect(ctx.db.get).toHaveBeenCalledWith("cards", "c1");
    expect(result).toBeNull();
  });
});
