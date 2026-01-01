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

  test("updateCard throws when card not found", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue(null),
        patch: mock(),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const updateHandler = (updateCard as any).handler ?? updateCard;
    await expect(updateHandler(ctx, { id: "c1", content: "Hi" })).rejects.toThrow("Card not found");
  });

  test("updateCard throws when not authorized", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u2" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          content: "Old",
        }),
        patch: mock(),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const updateHandler = (updateCard as any).handler ?? updateCard;
    await expect(updateHandler(ctx, { id: "c1", content: "Hi" })).rejects.toThrow("Not authorized");
  });

  test("updateCard does not normalize content for non-quote types", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          content: "Old",
        }),
        patch: mock().mockResolvedValue(null),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const updateHandler = (updateCard as any).handler ?? updateCard;
    await updateHandler(ctx, { id: "c1", content: "'quoted text'" });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "cards",
      "c1",
      expect.objectContaining({ content: "'quoted text'" })
    );
  });

  test("updateCard updates link type with categorize stage", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "link",
          content: "New content",
        }),
        patch: mock().mockResolvedValue(null),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const updateHandler = (updateCard as any).handler ?? updateCard;
    await updateHandler(ctx, { id: "c1", content: "New content" });

    const patchCall = ctx.db.patch.mock.calls[0];
    expect(patchCall[2].processingStatus).toBeDefined();
    expect(patchCall[2].processingStatus.categorize).toBeDefined();
  });

  test("updateCardField throws when unauthenticated", async () => {
    const ctx = { auth: { getUserIdentity: mock().mockResolvedValue(null) } } as any;
    const handler = (updateCardField as any).handler ?? updateCardField;
    await expect(
      handler(ctx, { cardId: "c1", field: "content", value: "Hi" })
    ).rejects.toThrow("User must be authenticated");
  });

  test("updateCardField throws when card not found", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: { get: mock().mockResolvedValue(null) },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    await expect(
      handler(ctx, { cardId: "c1", field: "content", value: "Hi" })
    ).rejects.toThrow("Card not found");
  });

  test("updateCardField throws when not authorized", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u2" }) },
      db: {
        get: mock().mockResolvedValue({ _id: "c1", userId: "u1" }),
      },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    await expect(
      handler(ctx, { cardId: "c1", field: "content", value: "Hi" })
    ).rejects.toThrow("Not authorized");
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

  test("updateCardField updates notes field", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          notes: "Old notes",
        }),
        patch: mock().mockResolvedValue(null),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    await handler(ctx, { cardId: "c1", field: "notes", value: " New notes " });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "cards",
      "c1",
      expect.objectContaining({ notes: "New notes" })
    );
  });

  test("updateCardField clears notes with empty string", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          notes: "Old notes",
        }),
        patch: mock().mockResolvedValue(null),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    await handler(ctx, { cardId: "c1", field: "notes", value: "   " });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "cards",
      "c1",
      expect.objectContaining({ notes: undefined })
    );
  });

  test("updateCardField updates tags field", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
        }),
        patch: mock().mockResolvedValue(null),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    await handler(ctx, { cardId: "c1", field: "tags", value: ["tag1", "tag2"] });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "cards",
      "c1",
      expect.objectContaining({ tags: ["tag1", "tag2"] })
    );
  });

  test("updateCardField clears tags with empty array", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          tags: ["old"],
        }),
        patch: mock().mockResolvedValue(null),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    await handler(ctx, { cardId: "c1", field: "tags", value: [] });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "cards",
      "c1",
      expect.objectContaining({ tags: undefined })
    );
  });

  test("updateCardField updates aiSummary field", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
        }),
        patch: mock().mockResolvedValue(null),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    await handler(ctx, { cardId: "c1", field: "aiSummary", value: " Summary " });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "cards",
      "c1",
      expect.objectContaining({ aiSummary: "Summary" })
    );
  });

  test("updateCardField toggles isFavorited", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          isFavorited: false,
        }),
        patch: mock().mockResolvedValue(null),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    await handler(ctx, { cardId: "c1", field: "isFavorited" });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "cards",
      "c1",
      expect.objectContaining({ isFavorited: true })
    );
  });

  test("updateCardField removes AI tag", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          aiTags: ["tag1", "tag2", "tag3"],
        }),
        patch: mock().mockResolvedValue(null),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    await handler(ctx, { cardId: "c1", field: "removeAiTag", tagToRemove: "tag2" });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "cards",
      "c1",
      expect.objectContaining({ aiTags: ["tag1", "tag3"] })
    );
  });

  test("updateCardField clears aiTags when last tag removed", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          aiTags: ["tag1"],
        }),
        patch: mock().mockResolvedValue(null),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    await handler(ctx, { cardId: "c1", field: "removeAiTag", tagToRemove: "tag1" });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "cards",
      "c1",
      expect.objectContaining({ aiTags: undefined })
    );
  });

  test("updateCardField returns card early when no tag to remove", async () => {
    const card = { _id: "c1", userId: "u1", type: "text" };
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue(card),
        patch: mock(),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    const result = await handler(ctx, { cardId: "c1", field: "removeAiTag" });

    expect(result).toEqual(card);
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  test("updateCardField marks card as deleted", async () => {
    const now = Date.now();
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
        }),
        patch: mock().mockResolvedValue(null),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    await handler(ctx, { cardId: "c1", field: "delete" });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "cards",
      "c1",
      expect.objectContaining({
        isDeleted: true,
        deletedAt: expect.any(Number),
      })
    );
  });

  test("updateCardField restores deleted card", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          isDeleted: true,
          deletedAt: 123456,
        }),
        patch: mock().mockResolvedValue(null),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    await handler(ctx, { cardId: "c1", field: "restore" });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "cards",
      "c1",
      expect.objectContaining({
        isDeleted: undefined,
        deletedAt: undefined,
      })
    );
  });

  test("updateCardField throws when restoring non-deleted card", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          isDeleted: false,
        }),
        patch: mock(),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    await expect(handler(ctx, { cardId: "c1", field: "restore" })).rejects.toThrow(
      "Card is not deleted"
    );
  });

  test("updateCardField throws for unsupported field", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
        }),
        patch: mock(),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    await expect(
      handler(ctx, { cardId: "c1", field: "unknown" as any })
    ).rejects.toThrow("Unsupported field: unknown");
  });

  test("updateCardField does not schedule pipeline when content unchanged", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          content: "Same content",
        }),
        patch: mock().mockResolvedValue(null),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    await handler(ctx, { cardId: "c1", field: "content", value: "Same content" });

    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  test("updateCardField does not schedule pipeline when url unchanged", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "link",
          url: "https://same.com",
          metadata: { linkPreview: { title: "Old" } },
        }),
        patch: mock().mockResolvedValue(null),
      },
      scheduler: { runAfter: mock() },
    } as any;

    const handler = (updateCardField as any).handler ?? updateCardField;
    await handler(ctx, { cardId: "c1", field: "url", value: "https://same.com" });

    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });
});
