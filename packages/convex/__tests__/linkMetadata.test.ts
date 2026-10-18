import { describe, expect, mock, test } from "bun:test";
import { testId } from "./helpers/convex.test-utils";
import { r2MockModuleFactory, r2Mocks } from "./helpers/r2Mock.test-utils";
import { withSearchSyncDb } from "./helpers/session.test-utils";

mock.module("../storage/r2", r2MockModuleFactory);

const {
  getFullCardForMetadataHandler,
  getCardForLinkFetchHandler,
  getCardForScreenshotHandler,
  updateCardMetadataHandler,
  updateCardScreenshotHandler,
} = await import("../linkMetadata");

const createMockCtx = () => {
  r2Mocks.queueObjectDeletion.mockReset();
  r2Mocks.queueObjectDeletion.mockResolvedValue(null);
  return {
    db: withSearchSyncDb({ get: mock(), patch: mock() }),
    scheduler: { runAfter: mock().mockResolvedValue(null) },
  } as any;
};

describe("linkMetadata", () => {
  describe("getFullCardForMetadata", () => {
    test("fetches card by id", async () => {
      const ctx = createMockCtx();
      const cardId = testId("cards", "card_123");
      const card = { _id: cardId, type: "link" };
      ctx.db.get.mockResolvedValue(card);

      const result = await getFullCardForMetadataHandler(ctx, { cardId });
      expect(ctx.db.get).toHaveBeenCalledWith("cards", cardId);
      expect(result).toEqual<unknown>(card);
    });
  });

  describe("updateCardMetadata", () => {
    test("returns early if card not found", async () => {
      const ctx = createMockCtx();
      ctx.db.get.mockResolvedValue(null);

      await updateCardMetadataHandler(ctx, {
        cardId: testId("cards", "card_123"),
        linkPreview: {},
        status: "completed",
      });

      expect(ctx.db.patch).not.toHaveBeenCalled();
    });

    test("updates metadata and status", async () => {
      const ctx = createMockCtx();
      const card = { _id: "card_123", type: "link", metadata: {} };
      ctx.db.get.mockResolvedValue(card);

      const linkPreview = { title: "New Title", url: "https://example.com" };
      await updateCardMetadataHandler(ctx, {
        cardId: testId("cards", "card_123"),
        linkPreview,
        status: "completed",
      });

      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "card_123",
        expect.objectContaining({
          metadata: { linkPreview },
          metadataStatus: "completed",
          metadataTitle: "New Title",
        })
      );
    });

    test("keeps a chosen image when the link preview is refreshed", async () => {
      const ctx = createMockCtx();
      const thumbnailOverride = {
        height: 900,
        storageKey: "chosen_id",
        updatedAt: 1,
        width: 600,
      };
      ctx.db.get.mockResolvedValue({
        _id: "card_123",
        type: "link",
        metadata: { linkPreview: { imageStorageKey: "old_og" } },
        thumbnailOverride,
      });

      await updateCardMetadataHandler(ctx, {
        cardId: testId("cards", "card_123"),
        linkPreview: { imageStorageKey: "new_og", title: "Refreshed" },
        status: "completed",
      });

      const [, , patch] = ctx.db.patch.mock.calls[0];
      expect(patch).not.toHaveProperty("thumbnailOverride");
      expect(r2Mocks.queueObjectDeletion).toHaveBeenCalledWith(ctx, "old_og");
      expect(r2Mocks.queueObjectDeletion).not.toHaveBeenCalledWith(
        ctx,
        "chosen_id"
      );
    });

    test("deletes previous screenshot if replaced", async () => {
      const ctx = createMockCtx();
      const card = {
        _id: "card_123",
        type: "link",
        metadata: {
          linkPreview: {
            screenshotStorageKey: "old_id",
            screenshotUpdatedAt: 100,
          },
        },
      };
      ctx.db.get.mockResolvedValue(card);

      const linkPreview = {
        screenshotStorageKey: "new_id",
        screenshotUpdatedAt: 200,
      };
      await updateCardMetadataHandler(ctx, {
        cardId: testId("cards", "card_123"),
        linkPreview,
        status: "completed",
      });

      expect(r2Mocks.queueObjectDeletion).toHaveBeenCalledWith(ctx, "old_id");
      expect(ctx.db.patch).toHaveBeenCalled();
    });

    test("preserves previous screenshot if new one missing", async () => {
      const ctx = createMockCtx();
      const card = {
        _id: "card_123",
        type: "link",
        metadata: {
          linkPreview: {
            screenshotStorageKey: "old_id",
            screenshotUpdatedAt: 100,
          },
        },
      };
      ctx.db.get.mockResolvedValue(card);

      const linkPreview = { title: "Title" };
      await updateCardMetadataHandler(ctx, {
        cardId: testId("cards", "card_123"),
        linkPreview,
        status: "completed",
      });

      expect(r2Mocks.queueObjectDeletion).not.toHaveBeenCalled();
      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "card_123",
        expect.objectContaining({
          metadata: expect.objectContaining({
            linkPreview: expect.objectContaining({
              screenshotStorageKey: "old_id",
              screenshotUpdatedAt: 100,
            }),
          }),
        })
      );
    });

    test("handles delete error gracefully", async () => {
      const ctx = createMockCtx();
      const card = {
        _id: "card_123",
        type: "link",
        metadata: {
          linkPreview: { screenshotStorageKey: "old_id" },
        },
      };
      ctx.db.get.mockResolvedValue(card);
      r2Mocks.queueObjectDeletion.mockRejectedValue(new Error("Storage error"));

      const linkPreview = { screenshotStorageKey: "new_id" };
      await updateCardMetadataHandler(ctx, {
        cardId: testId("cards", "card_123"),
        linkPreview,
        status: "completed",
      });

      expect(r2Mocks.queueObjectDeletion).toHaveBeenCalled();
      expect(ctx.db.patch).toHaveBeenCalled();
    });

    test("handles non-link card", async () => {
      const ctx = createMockCtx();
      const card = {
        _id: "card_123",
        type: "note",
        metadata: { other: "data" },
      };
      ctx.db.get.mockResolvedValue(card);

      const linkPreview = { title: "New Title" };
      await updateCardMetadataHandler(ctx, {
        cardId: testId("cards", "card_123"),
        linkPreview,
        status: "completed",
      });

      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "card_123",
        expect.objectContaining({
          metadata: expect.objectContaining({
            other: "data",
            linkPreview,
          }),
        })
      );
    });

    test("preserves existing category", async () => {
      const ctx = createMockCtx();
      const card = {
        _id: "card_123",
        type: "link",
        metadata: { linkCategory: "news" },
      };
      ctx.db.get.mockResolvedValue(card);

      const linkPreview = { title: "New Title" };
      await updateCardMetadataHandler(ctx, {
        cardId: testId("cards", "card_123"),
        linkPreview,
        status: "completed",
      });

      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "card_123",
        expect.objectContaining({
          metadata: expect.objectContaining({
            linkCategory: "news",
          }),
        })
      );
    });

    test("handles empty linkPreview arg", async () => {
      const ctx = createMockCtx();
      const card = { _id: "card_123", type: "link", metadata: {} };
      ctx.db.get.mockResolvedValue(card);

      await updateCardMetadataHandler(ctx, {
        cardId: testId("cards", "card_123"),
        linkPreview: undefined,
        status: "failed",
      });

      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "card_123",
        expect.objectContaining({
          metadataStatus: "failed",
        })
      );
    });
    test("updates description if provided", async () => {
      const ctx = createMockCtx();
      const card = { _id: "card_123", type: "link", metadata: {} };
      ctx.db.get.mockResolvedValue(card);

      const linkPreview = { description: "New Desc" };
      await updateCardMetadataHandler(ctx, {
        cardId: testId("cards", "card_123"),
        linkPreview,
        status: "completed",
      });

      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "card_123",
        expect.objectContaining({
          metadataDescription: "New Desc",
        })
      );
    });

    test("replaces stored media attachments and deletes stale assets", async () => {
      const ctx = createMockCtx();
      ctx.db.get.mockResolvedValue({
        _id: "card_123",
        type: "link",
        metadata: {
          linkPreview: {
            media: [
              {
                type: "image",
                storageKey: "old_image",
                updatedAt: 1,
              },
              {
                type: "video",
                storageKey: "old_video",
                posterStorageKey: "old_poster",
                updatedAt: 1,
              },
            ],
          },
        },
      });

      await updateCardMetadataHandler(ctx, {
        cardId: testId("cards", "card_123"),
        linkPreview: {
          media: [
            {
              type: "image",
              storageKey: "new_image",
              updatedAt: 2,
            },
          ],
        },
        status: "completed",
      });

      expect(r2Mocks.queueObjectDeletion).toHaveBeenCalledWith(
        ctx,
        "old_image"
      );
      expect(r2Mocks.queueObjectDeletion).toHaveBeenCalledWith(
        ctx,
        "old_video"
      );
      expect(r2Mocks.queueObjectDeletion).toHaveBeenCalledWith(
        ctx,
        "old_poster"
      );
      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "card_123",
        expect.objectContaining({
          metadata: expect.objectContaining({
            linkPreview: expect.objectContaining({
              media: [
                {
                  type: "image",
                  storageKey: "new_image",
                  updatedAt: 2,
                },
              ],
            }),
          }),
        })
      );
    });

    test("preserves existing media when the refreshed preview omits them", async () => {
      const ctx = createMockCtx();
      ctx.db.get.mockResolvedValue({
        _id: "card_123",
        type: "link",
        metadata: {
          linkPreview: {
            media: [
              {
                type: "image",
                storageKey: "existing_image",
                updatedAt: 1,
              },
            ],
          },
        },
      });

      await updateCardMetadataHandler(ctx, {
        cardId: testId("cards", "card_123"),
        linkPreview: { title: "Updated title" },
        status: "completed",
      });

      expect(r2Mocks.queueObjectDeletion).not.toHaveBeenCalledWith(
        ctx,
        "existing_image"
      );
      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "card_123",
        expect.objectContaining({
          metadata: expect.objectContaining({
            linkPreview: expect.objectContaining({
              title: "Updated title",
              media: [
                {
                  type: "image",
                  storageKey: "existing_image",
                  updatedAt: 1,
                },
              ],
            }),
          }),
        })
      );
    });

    test("preserves existing category for non-link card", async () => {
      const ctx = createMockCtx();
      const card = {
        _id: "card_123",
        type: "note",
        metadata: { linkCategory: "news", other: "data" },
      };
      ctx.db.get.mockResolvedValue(card);

      const linkPreview = { title: "New Title" };
      await updateCardMetadataHandler(ctx, {
        cardId: testId("cards", "card_123"),
        linkPreview,
        status: "completed",
      });

      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "card_123",
        expect.objectContaining({
          metadata: expect.objectContaining({
            linkCategory: "news",
            other: "data",
          }),
        })
      );
    });
  });

  describe("updateCardScreenshot", () => {
    test("returns early if card not found", async () => {
      const ctx = createMockCtx();
      ctx.db.get.mockResolvedValue(null);
      await updateCardScreenshotHandler(ctx, {
        cardId: testId("cards", "c1"),
        screenshotStorageKey: "s1",
        screenshotUpdatedAt: 1,
      });
      expect(ctx.db.patch).not.toHaveBeenCalled();
    });

    test("returns early if not a link card", async () => {
      const ctx = createMockCtx();
      ctx.db.get.mockResolvedValue({ type: "note" });
      await updateCardScreenshotHandler(ctx, {
        cardId: testId("cards", "c1"),
        screenshotStorageKey: "s1",
        screenshotUpdatedAt: 1,
      });
      expect(ctx.db.patch).not.toHaveBeenCalled();
    });

    test("updates screenshot and deletes old one", async () => {
      const ctx = createMockCtx();
      const card = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: { screenshotStorageKey: "old", screenshotUpdatedAt: 1 },
        },
      };
      ctx.db.get.mockResolvedValue(card);

      await updateCardScreenshotHandler(ctx, {
        cardId: testId("cards", "c1"),
        screenshotStorageKey: "new",
        screenshotUpdatedAt: 2,
      });

      expect(r2Mocks.queueObjectDeletion).toHaveBeenCalledWith(ctx, "old");
      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          metadata: {
            linkPreview: {
              screenshotStorageKey: "new",
              screenshotUpdatedAt: 2,
            },
          },
        })
      );
    });

    test("handles delete error gracefully", async () => {
      const ctx = createMockCtx();
      const card = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: { screenshotStorageKey: "old" },
        },
      };
      ctx.db.get.mockResolvedValue(card);
      r2Mocks.queueObjectDeletion.mockRejectedValue(new Error("fail"));

      await updateCardScreenshotHandler(ctx, {
        cardId: testId("cards", "c1"),
        screenshotStorageKey: "new",
        screenshotUpdatedAt: 2,
      });

      expect(r2Mocks.queueObjectDeletion).toHaveBeenCalled();
      expect(ctx.db.patch).toHaveBeenCalled();
    });

    test("handles missing metadata/linkPreview", async () => {
      const ctx = createMockCtx();
      const card = {
        _id: "c1",
        type: "link",
      };
      ctx.db.get.mockResolvedValue(card);

      await updateCardScreenshotHandler(ctx, {
        cardId: testId("cards", "c1"),
        screenshotStorageKey: "new",
        screenshotUpdatedAt: 2,
      });

      expect(r2Mocks.queueObjectDeletion).not.toHaveBeenCalled();
      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          metadata: {
            linkPreview: {
              screenshotStorageKey: "new",
              screenshotUpdatedAt: 2,
            },
          },
        })
      );
    });
  });
});

test("link fetch reader preserves classification gates and owner without unrelated payloads", async () => {
  const ctx = createMockCtx();
  const card = {
    _id: "c1",
    userId: "owner",
    type: "link",
    url: "https://example.com",
    content: "content".repeat(10_000),
    aiTranscript: "transcript".repeat(10_000),
    processingStatus: {
      classify: { status: "in_progress", confidence: 0.95 },
      metadata: { status: "pending" },
    },
    metadata: {
      linkPreview: { status: "success", raw: { body: "raw".repeat(10_000) } },
    },
  };
  ctx.db.get.mockResolvedValue(card);
  expect(
    await getCardForLinkFetchHandler(ctx, { cardId: testId("cards", "c1") })
  ).toEqual({
    type: "link",
    url: card.url,
    userId: "owner",
    processingStatus: { classify: { status: "in_progress" } },
  });
  expect(
    await getFullCardForMetadataHandler(ctx, { cardId: testId("cards", "c1") })
  ).toEqual<unknown>(card);
  ctx.db.get.mockResolvedValue(null);
  expect(
    await getCardForLinkFetchHandler(ctx, { cardId: testId("cards", "c1") })
  ).toBeNull();
});

test("screenshot reader retains existing screenshot guard without preview raw data or transcript", async () => {
  const ctx = createMockCtx();
  ctx.db.get.mockResolvedValue({
    userId: "owner",
    type: "link",
    url: "https://example.com",
    aiTranscript: "transcript".repeat(10_000),
    metadata: {
      linkPreview: {
        status: "success",
        screenshotStorageKey: "existing-screenshot",
        raw: { body: "raw".repeat(10_000) },
        media: [{ storageKey: "unrelated" }],
      },
    },
  });
  expect(
    await getCardForScreenshotHandler(ctx, { cardId: testId("cards", "c1") })
  ).toEqual({
    userId: "owner",
    type: "link",
    url: "https://example.com",
    metadata: {
      linkPreview: {
        status: "success",
        screenshotStorageKey: "existing-screenshot",
      },
    },
  });
  ctx.db.get.mockResolvedValue(null);
  expect(
    await getCardForScreenshotHandler(ctx, { cardId: testId("cards", "c1") })
  ).toBeNull();
});
