// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";

describe("ai/mutations.ts", () => {
  let updateCardProcessing: any;

  beforeEach(async () => {
    updateCardProcessing = (await import("../../ai/mutations"))
      .updateCardProcessing;
  });

  test("updates processing fields", async () => {
    const ctx = {
      db: {
        get: mock().mockResolvedValue({ _id: "c1" }),
        patch: mock().mockResolvedValue(undefined),
      },
    } as any;
    const handler =
      (updateCardProcessing as any).handler ?? updateCardProcessing;
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
    expect(result).toBe(true);
  });

  test("treats a card deleted during processing as an idempotent skip", async () => {
    const ctx = {
      db: { get: mock().mockResolvedValue(null), patch: mock() },
    } as any;
    const handler =
      (updateCardProcessing as any).handler ?? updateCardProcessing;

    const result = await handler(ctx, {
      cardId: "deleted",
      processingStatus: { classify: { status: "completed" } },
    });

    expect(result).toBe(false);
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});
