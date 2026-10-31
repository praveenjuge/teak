import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testId } from "./helpers/convex.test-utils";
import { r2MockModuleFactory, r2Mocks } from "./helpers/r2Mock.test-utils";
import { withSearchSyncDb } from "./helpers/session.test-utils";

mock.module("../storage/r2", r2MockModuleFactory);

const {
  getFullCardForMetadataHandler,
  getCardForLinkFetchHandler,
  getCardForScreenshotHandler,
  updateCardMetadataHandler,
  updateCardPreviewImageHandler,
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
    keyPrefix: "",
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

describe("updateCardPreviewImage", () => {
  const image = {
    cardId: testId("cards", "c1"),
    imageHeight: 630,
    imageStorageKey: "u/cards/c1/link-preview-image/new",
    imageUpdatedAt: 5,
    imageUrl: "https://cdn.example/cover.jpg",
    imageWidth: 1200,
  };
  const linkWith = (preview: Record<string, unknown>) => ({
    _id: image.cardId,
    metadata: { linkPreview: { status: "success", ...preview } },
    type: "link",
  });

  test("attaches the image while the preview still names it", async () => {
    const ctx = createMockCtx();
    ctx.db.get.mockResolvedValue(linkWith({ imageUrl: image.imageUrl }));

    expect(await updateCardPreviewImageHandler(ctx, image)).toBe(true);
    const [, , patch] = ctx.db.patch.mock.calls[0] as [
      string,
      string,
      { metadata: { linkPreview: Record<string, unknown> } },
    ];
    expect(patch.metadata.linkPreview).toMatchObject({
      imageHeight: 630,
      imageStorageKey: image.imageStorageKey,
      imageUrl: image.imageUrl,
      imageWidth: 1200,
      status: "success",
    });
    expect(r2Mocks.queueObjectDeletion).not.toHaveBeenCalled();
  });

  test.each([
    ["names another image", { imageUrl: "https://cdn.example/other.jpg" }],
    [
      "already has one",
      {
        imageStorageKey: "u/cards/c1/link-preview-image/old",
        imageUrl: image.imageUrl,
      },
    ],
  ])("deletes the new image when the preview %s", async (_name, preview) => {
    const ctx = createMockCtx();
    ctx.db.get.mockResolvedValue(linkWith(preview));

    expect(await updateCardPreviewImageHandler(ctx, image)).toBe(false);
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(r2Mocks.queueObjectDeletion).toHaveBeenCalledWith(
      ctx,
      image.imageStorageKey
    );
  });
});

describe("linkMetadata storage cleanup", () => {
  const withScheduler = (handler: any) => (ctx: any, args: any) => {
    ctx.scheduler ??= { runAfter: mock().mockResolvedValue(null) };
    return handler(ctx, args);
  };
  const updateMetadata = withScheduler(updateCardMetadataHandler);
  const updateScreenshot = withScheduler(updateCardScreenshotHandler);

  beforeEach(() => {
    r2Mocks.queueObjectDeletion.mockReset();
    r2Mocks.queueObjectDeletion.mockResolvedValue(null);
  });

  describe("getFullCardForMetadata", () => {
    test("returns null for missing card", async () => {
      const ctx = { db: { get: mock().mockResolvedValue(null) } } as any;
      const result = await getFullCardForMetadataHandler(ctx, {
        cardId: "c1",
      } as any);
      expect(result).toBeNull();
    });
  });

  describe("updateCardMetadata storage and dimensions", () => {
    test("deletes previous image when new image provided", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: { imageStorageKey: "old_image" },
        },
      };
      const newLinkPreview = { imageStorageKey: "new_image" };
      const ctx = {
        db: withSearchSyncDb({
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        }),
      } as any;

      await updateMetadata(ctx, {
        cardId: "c1",
        linkPreview: newLinkPreview,
        status: "completed",
      });

      expect(r2Mocks.queueObjectDeletion).toHaveBeenCalledWith(
        ctx,
        "old_image"
      );
      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          metadata: expect.objectContaining({
            linkPreview: expect.objectContaining({
              imageStorageKey: "new_image",
            }),
          }),
        })
      );
    });

    test("skips storage cleanup when the patch is fenced by account deletion", async () => {
      const existingCard = {
        _id: "c1",
        userId: "u1",
        type: "link",
        metadata: {
          linkPreview: { screenshotStorageKey: "old_shot" },
        },
      };
      const newLinkPreview = { screenshotStorageKey: "new_shot" };
      const ctx = {
        db: withSearchSyncDb({
          get: mock().mockResolvedValue(existingCard),
          query: mock().mockImplementation((table: string) => ({
            withIndex: mock().mockReturnValue({
              unique: mock().mockResolvedValue(
                table === "accountDeletionStates"
                  ? { _id: "del1", userId: "u1", startedAt: 1 }
                  : null
              ),
            }),
          })),
        }),
      } as any;

      const result = await updateMetadata(ctx, {
        cardId: "c1",
        linkPreview: newLinkPreview,
        status: "completed",
      });

      expect(result).toBe(false);
      expect(ctx.db.patch).not.toHaveBeenCalled();
      expect(r2Mocks.queueObjectDeletion).toHaveBeenCalledTimes(1);
      expect(r2Mocks.queueObjectDeletion).toHaveBeenCalledWith(ctx, "new_shot");
    });

    test("fenced patch deletes new image and media objects but keeps carried-over references", async () => {
      const existingCard = {
        _id: "c1",
        userId: "u1",
        type: "link",
        metadata: {
          linkPreview: {
            imageStorageKey: "old_image",
            screenshotStorageKey: "keep_shot",
            media: [
              { storageKey: "keep_media", posterStorageKey: "keep_poster" },
            ],
          },
        },
      };
      const newLinkPreview = {
        imageStorageKey: "new_image",
        screenshotStorageKey: "keep_shot",
        media: [
          { storageKey: "keep_media", posterStorageKey: "keep_poster" },
          { storageKey: "new_media", posterStorageKey: "new_poster" },
        ],
      };
      const ctx = {
        db: withSearchSyncDb({
          get: mock().mockResolvedValue(existingCard),
          query: mock().mockImplementation((table: string) => ({
            withIndex: mock().mockReturnValue({
              unique: mock().mockResolvedValue(
                table === "accountDeletionStates"
                  ? { _id: "del1", userId: "u1", startedAt: 1 }
                  : null
              ),
            }),
          })),
        }),
      } as any;

      const result = await updateMetadata(ctx, {
        cardId: "c1",
        linkPreview: newLinkPreview,
        status: "completed",
      });

      expect(result).toBe(false);
      expect(ctx.db.patch).not.toHaveBeenCalled();
      const deleted = r2Mocks.queueObjectDeletion.mock.calls
        .map((call: any[]) => call[1])
        .sort();
      expect(deleted).toEqual(["new_image", "new_media", "new_poster"]);
    });

    test("preserves existing image when new image not provided", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: {
            imageStorageKey: "old_image",
            imageUpdatedAt: 1000,
            imageWidth: 800,
            imageHeight: 600,
          },
        },
      };
      const newLinkPreview = { title: "New Title" };
      const ctx = {
        db: withSearchSyncDb({
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        }),
      } as any;

      await updateMetadata(ctx, {
        cardId: "c1",
        linkPreview: newLinkPreview,
        status: "completed",
      });

      expect(r2Mocks.queueObjectDeletion).not.toHaveBeenCalled();
      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          metadata: expect.objectContaining({
            linkPreview: expect.objectContaining({
              imageStorageKey: "old_image",
              imageUpdatedAt: 1000,
              imageWidth: 800,
              imageHeight: 600,
              title: "New Title",
            }),
          }),
        })
      );
    });

    test("preserves image dimensions when same image", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: {
            imageStorageKey: "same_image",
            imageWidth: 800,
            imageHeight: 600,
          },
        },
      };
      const newLinkPreview = { imageStorageKey: "same_image" };
      const ctx = {
        db: withSearchSyncDb({
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        }),
      } as any;

      await updateMetadata(ctx, {
        cardId: "c1",
        linkPreview: newLinkPreview,
        status: "completed",
      });

      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          metadata: expect.objectContaining({
            linkPreview: expect.objectContaining({
              imageStorageKey: "same_image",
              imageWidth: 800,
              imageHeight: 600,
            }),
          }),
        })
      );
    });

    test("deletes previous screenshot when new screenshot provided", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: { screenshotStorageKey: "old_screenshot" },
        },
      };
      const newLinkPreview = { screenshotStorageKey: "new_screenshot" };
      const ctx = {
        db: withSearchSyncDb({
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        }),
      } as any;

      await updateMetadata(ctx, {
        cardId: "c1",
        linkPreview: newLinkPreview,
        status: "completed",
      });

      expect(r2Mocks.queueObjectDeletion).toHaveBeenCalledWith(
        ctx,
        "old_screenshot"
      );
      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          metadata: expect.objectContaining({
            linkPreview: expect.objectContaining({
              screenshotStorageKey: "new_screenshot",
            }),
          }),
        })
      );
    });

    test("preserves existing screenshot when new screenshot not provided", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: {
            screenshotStorageKey: "old_screenshot",
            screenshotUpdatedAt: 1000,
            screenshotWidth: 1200,
            screenshotHeight: 800,
          },
        },
      };
      const newLinkPreview = { title: "New Title" };
      const ctx = {
        db: withSearchSyncDb({
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        }),
      } as any;

      await updateMetadata(ctx, {
        cardId: "c1",
        linkPreview: newLinkPreview,
        status: "completed",
      });

      expect(r2Mocks.queueObjectDeletion).not.toHaveBeenCalled();
      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          metadata: expect.objectContaining({
            linkPreview: expect.objectContaining({
              screenshotStorageKey: "old_screenshot",
              screenshotUpdatedAt: 1000,
              screenshotWidth: 1200,
              screenshotHeight: 800,
            }),
          }),
        })
      );
    });

    test("preserves screenshot dimensions when same screenshot", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: {
            screenshotStorageKey: "same_screenshot",
            screenshotWidth: 1200,
            screenshotHeight: 800,
          },
        },
      };
      const newLinkPreview = { screenshotStorageKey: "same_screenshot" };
      const ctx = {
        db: withSearchSyncDb({
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        }),
      } as any;

      await updateMetadata(ctx, {
        cardId: "c1",
        linkPreview: newLinkPreview,
        status: "completed",
      });

      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          metadata: expect.objectContaining({
            linkPreview: expect.objectContaining({
              screenshotStorageKey: "same_screenshot",
              screenshotWidth: 1200,
              screenshotHeight: 800,
            }),
          }),
        })
      );
    });

    test("preserves linkCategory for link type", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkCategory: { category: "news" },
        },
      };
      const newLinkPreview = { title: "New Title" };
      const ctx = {
        db: withSearchSyncDb({
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        }),
      } as any;

      await updateMetadata(ctx, {
        cardId: "c1",
        linkPreview: newLinkPreview,
        status: "completed",
      });

      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          metadata: expect.objectContaining({
            linkCategory: { category: "news" },
          }),
        })
      );
    });

    test("sets metadataTitle and metadataDescription", async () => {
      const existingCard = { _id: "c1", type: "link" };
      const newLinkPreview = {
        title: "Test Title",
        description: "Test Description",
      };
      const ctx = {
        db: withSearchSyncDb({
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        }),
      } as any;

      await updateMetadata(ctx, {
        cardId: "c1",
        linkPreview: newLinkPreview,
        status: "completed",
      });

      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          metadataTitle: "Test Title",
          metadataDescription: "Test Description",
        })
      );
    });

    test("handles image delete error gracefully", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: { imageStorageKey: "old_image" },
        },
      };
      const newLinkPreview = { imageStorageKey: "new_image" };
      r2Mocks.queueObjectDeletion.mockRejectedValueOnce(
        new Error("Storage error")
      );
      const ctx = {
        db: withSearchSyncDb({
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        }),
      } as any;

      await updateMetadata(ctx, {
        cardId: "c1",
        linkPreview: newLinkPreview,
        status: "completed",
      });

      expect(ctx.db.patch).toHaveBeenCalled();
    });
  });

  describe("updateCardScreenshot dimensions", () => {
    test("updates screenshot for link card", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: { linkPreview: {} },
      };
      const ctx = {
        db: withSearchSyncDb({
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        }),
      } as any;

      await updateScreenshot(ctx, {
        cardId: "c1",
        screenshotStorageKey: "s1",
        screenshotUpdatedAt: 1000,
        screenshotWidth: 1200,
        screenshotHeight: 800,
      });

      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          metadata: expect.objectContaining({
            linkPreview: expect.objectContaining({
              screenshotStorageKey: "s1",
              screenshotUpdatedAt: 1000,
              screenshotWidth: 1200,
              screenshotHeight: 800,
            }),
          }),
        })
      );
    });

    test("preserves existing screenshot dimensions when not provided", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: {
            screenshotStorageKey: "existing_screenshot",
            screenshotUpdatedAt: 500,
            screenshotWidth: 1000,
            screenshotHeight: 750,
          },
        },
      };
      const ctx = {
        db: withSearchSyncDb({
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        }),
      } as any;

      await updateScreenshot(ctx, {
        cardId: "c1",
        screenshotStorageKey: "new_screenshot",
        screenshotUpdatedAt: 1000,
      });

      expect(ctx.db.patch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          metadata: expect.objectContaining({
            linkPreview: expect.objectContaining({
              screenshotStorageKey: "new_screenshot",
              screenshotUpdatedAt: 1000,
            }),
          }),
        })
      );
    });
  });
});
