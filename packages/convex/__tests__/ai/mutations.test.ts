// @ts-nocheck
import { describe, expect, test, mock, beforeEach } from "bun:test";

describe("ai/mutations.ts", () => {
  let updateCardProcessing: any;

  beforeEach(async () => {
    updateCardProcessing = (await import("../../ai/mutations")).updateCardProcessing;
  });

  test("updates processing fields", async () => {
    const ctx = { db: { patch: mock().mockResolvedValue("ok") } } as any;
    const handler = (updateCardProcessing as any).handler ?? updateCardProcessing;
    const result = await handler(ctx, {
      cardId: "c1",
      processingStatus: { classify: { status: "completed" } },
      type: "text",
      metadataStatus: "completed",
      metadata: { foo: "bar" },
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "cards",
      "c1",
      expect.objectContaining({
        type: "text",
        processingStatus: { classify: { status: "completed" } },
        metadataStatus: "completed",
        metadata: { foo: "bar" },
      })
    );
    expect(result).toBe("ok");
  });
});
