// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";

describe("ai/actions.ts", () => {
  let manuallyGenerateAI: any;

  beforeEach(async () => {
    manuallyGenerateAI = (await import("../../ai/actions")).manuallyGenerateAI;
  });

  test("throws when unauthenticated", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue(null) },
    } as any;
    const handler = (manuallyGenerateAI as any).handler ?? manuallyGenerateAI;
    await expect(handler(ctx, { cardId: "c1" })).rejects.toThrow(
      "Authentication required"
    );
  });

  test("schedules workflow when verified", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      runQuery: mock().mockResolvedValue({ exists: true }),
      runMutation: mock().mockResolvedValue(true),
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;
    const handler = (manuallyGenerateAI as any).handler ?? manuallyGenerateAI;
    const result = await handler(ctx, { cardId: "c1" });
    expect(result).toEqual({ success: true });
    expect(ctx.scheduler.runAfter).toHaveBeenCalled();
  });

  test("rejects when the reprocessing limit is exhausted", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      runQuery: mock().mockResolvedValue({ exists: true }),
      runMutation: mock().mockResolvedValue(false),
      scheduler: { runAfter: mock() },
    } as any;
    const handler = (manuallyGenerateAI as any).handler ?? manuallyGenerateAI;

    await expect(handler(ctx, { cardId: "c1" })).rejects.toThrow(
      "Too many reprocessing requests"
    );
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  test("throws when verification fails", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      runQuery: mock().mockResolvedValue(null),
    } as any;
    const handler = (manuallyGenerateAI as any).handler ?? manuallyGenerateAI;
    await expect(handler(ctx, { cardId: "c1" })).rejects.toThrow(
      "Card not found or access denied"
    );
  });
});
