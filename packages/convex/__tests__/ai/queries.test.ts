import { beforeEach, describe, expect, mock, test } from "bun:test";

describe("ai/queries.ts", () => {
  let getCardForAI: any;
  let getCardForVerification: any;

  beforeEach(async () => {
    const module = await import("../../ai/queries");
    getCardForAI = module.getCardForAI;
    getCardForVerification = module.getCardForVerification;
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

  test("getCardForVerification returns null when card missing", async () => {
    const ctx = { db: { get: mock().mockResolvedValue(null) } } as any;
    const handler =
      (getCardForVerification as any).handler ?? getCardForVerification;
    const result = await handler(ctx, { cardId: "c1", userId: "u1" });
    expect(result).toBeNull();
  });

  test("getCardForVerification returns null when missing or wrong user", async () => {
    const ctx = {
      db: { get: mock().mockResolvedValue({ userId: "u2" }) },
    } as any;
    const handler =
      (getCardForVerification as any).handler ?? getCardForVerification;
    const result = await handler(ctx, { cardId: "c1", userId: "u1" });
    expect(result).toBeNull();
  });

  test("getCardForVerification returns exists when match", async () => {
    const ctx = {
      db: { get: mock().mockResolvedValue({ userId: "u1" }) },
    } as any;
    const handler =
      (getCardForVerification as any).handler ?? getCardForVerification;
    const result = await handler(ctx, { cardId: "c1", userId: "u1" });
    expect(result).toEqual({ exists: true });
  });
});
