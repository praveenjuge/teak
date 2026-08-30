// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import {
  updateCardAI,
  updateCardColors,
} from "../../../workflows/aiMetadata/mutations";

const handlerOf = (mutation: any) => {
  const handler = mutation.handler ?? mutation;
  return (ctx: any, args: any) => {
    ctx.scheduler ??= { runAfter: mock().mockResolvedValue(null) };
    return handler(ctx, args);
  };
};

describe("AI metadata mutations", () => {
  test("updates AI metadata only while the card exists", async () => {
    const patch = mock().mockResolvedValue(undefined);
    const ctx = {
      db: { get: mock().mockResolvedValue({ _id: "card" }), patch },
    } as any;

    const result = await handlerOf(updateCardAI)(ctx, {
      cardId: "card",
      aiTags: ["design"],
      processingStatus: { metadata: { status: "completed" } },
    });

    expect(result).toBe(true);
    expect(patch).toHaveBeenCalledTimes(1);
  });

  test("skips late AI and palette writes after deletion", async () => {
    const patch = mock();
    const ctx = {
      db: { get: mock().mockResolvedValue(null), patch },
    } as any;

    await expect(
      handlerOf(updateCardAI)(ctx, {
        cardId: "deleted",
        processingStatus: { metadata: { status: "completed" } },
      })
    ).resolves.toBe(false);
    await expect(
      handlerOf(updateCardColors)(ctx, {
        cardId: "deleted",
        colors: [{ hex: "#FFFFFF" }],
      })
    ).resolves.toBeNull();
    expect(patch).not.toHaveBeenCalled();
  });
});
