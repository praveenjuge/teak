// @ts-nocheck
import { describe, expect, test, mock, beforeEach } from "bun:test";

describe("card/updateCard.ts", () => {
  let updateCard: any;
  let updateCardField: any;

  beforeEach(async () => {
    const module = await import("../convex/card/updateCard");
    updateCard = module.updateCard;
    updateCardField = module.updateCardField;
  });

  test("updateCard throws when unauthenticated", async () => {
    const ctx = { auth: { getUserIdentity: mock().mockResolvedValue(null) } } as any;
    await expect(
      ((updateCard as any).handler ?? updateCard)(ctx, { id: "c1", content: "Hi" })
    ).rejects.toThrow("User must be authenticated");
  });

  test("updateCard normalizes quote content and schedules pipeline", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "quote",
          content: "Old",
          processingStatus: { classify: { status: "completed" } },
        }),
        patch: mock().mockResolvedValue(null),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const updateHandler = (updateCard as any).handler ?? updateCard;
    await updateHandler(ctx, { id: "c1", content: "'New quote'" });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "cards",
      "c1",
      expect.objectContaining({ content: "New quote" })
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalled();
  });

  test("updateCardField updates url and clears link preview", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "link",
          url: "https://old.com",
          metadata: { linkPreview: { title: "Old" }, linkCategory: { category: "news" } },
          processingStatus: { classify: { status: "completed" } },
        }),
        patch: mock().mockResolvedValue(null),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const updateFieldHandler = (updateCardField as any).handler ?? updateCardField;
    await updateFieldHandler(ctx, {
      cardId: "c1",
      field: "url",
      value: " https://new.com ",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "cards",
      "c1",
      expect.objectContaining({
        url: "https://new.com",
        metadata: expect.not.objectContaining({ linkPreview: expect.anything() }),
      })
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalled();
  });
});
