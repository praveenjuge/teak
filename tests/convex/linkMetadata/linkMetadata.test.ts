// @ts-nocheck
import { describe, expect, test, mock, beforeEach } from "bun:test";

describe("linkMetadata.ts", () => {
  let getCardForMetadata: any;
  let updateCardMetadata: any;
  let updateCardScreenshot: any;
  let updateCardMetadataHandler: any;
  let updateCardScreenshotHandler: any;

  beforeEach(async () => {
    const module = await import("../../../convex/linkMetadata");
    getCardForMetadata = module.getCardForMetadata;
    updateCardMetadata = module.updateCardMetadata;
    updateCardScreenshot = module.updateCardScreenshot;
    updateCardMetadataHandler = module.updateCardMetadataHandler;
    updateCardScreenshotHandler = module.updateCardScreenshotHandler;
  });

  describe("getCardForMetadata", () => {
    test("fetches card by id", async () => {
      const ctx = { db: { get: mock().mockResolvedValue({ _id: "c1" }) } } as any;
      const handler = (getCardForMetadata as any).handler ?? getCardForMetadata;
      const result = await handler(ctx, { cardId: "c1" });
      expect(ctx.db.get).toHaveBeenCalledWith("cards", "c1");
      expect(result).toEqual({ _id: "c1" });
    });

    test("returns null for missing card", async () => {
      const ctx = { db: { get: mock().mockResolvedValue(null) } } as any;
      const handler = (getCardForMetadata as any).handler ?? getCardForMetadata;
      const result = await handler(ctx, { cardId: "c1" });
      expect(result).toBeNull();
    });
  });

  describe("updateCardMetadataHandler", () => {
    test("returns early when card not found", async () => {
      const ctx = { db: { get: mock().mockResolvedValue(null), patch: mock() } } as any;
      const result = await updateCardMetadataHandler(ctx, { cardId: "c1", linkPreview: {}, status: "completed" });
      expect(result).toBeUndefined();
      expect(ctx.db.patch).not.toHaveBeenCalled();
    });

    test("deletes previous image when new image provided", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: { imageStorageId: "old_image" },
        },
      };
      const newLinkPreview = { imageStorageId: "new_image" };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock().mockResolvedValue(null) },
      } as any;

      await updateCardMetadataHandler(ctx, { cardId: "c1", linkPreview: newLinkPreview, status: "completed" });

      expect(ctx.storage.delete).toHaveBeenCalledWith("old_image");
      expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", expect.objectContaining({
        metadata: expect.objectContaining({
          linkPreview: expect.objectContaining({ imageStorageId: "new_image" }),
        }),
      }));
    });

    test("preserves existing image when new image not provided", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: {
            imageStorageId: "old_image",
            imageUpdatedAt: 1000,
            imageWidth: 800,
            imageHeight: 600,
          },
        },
      };
      const newLinkPreview = { title: "New Title" };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock() },
      } as any;

      await updateCardMetadataHandler(ctx, { cardId: "c1", linkPreview: newLinkPreview, status: "completed" });

      expect(ctx.storage.delete).not.toHaveBeenCalled();
      expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", expect.objectContaining({
        metadata: expect.objectContaining({
          linkPreview: expect.objectContaining({
            imageStorageId: "old_image",
            imageUpdatedAt: 1000,
            imageWidth: 800,
            imageHeight: 600,
            title: "New Title",
          }),
        }),
      }));
    });

    test("preserves image dimensions when same image", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: {
            imageStorageId: "same_image",
            imageWidth: 800,
            imageHeight: 600,
          },
        },
      };
      const newLinkPreview = { imageStorageId: "same_image" };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock() },
      } as any;

      await updateCardMetadataHandler(ctx, { cardId: "c1", linkPreview: newLinkPreview, status: "completed" });

      expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", expect.objectContaining({
        metadata: expect.objectContaining({
          linkPreview: expect.objectContaining({
            imageStorageId: "same_image",
            imageWidth: 800,
            imageHeight: 600,
          }),
        }),
      }));
    });

    test("deletes previous screenshot when new screenshot provided", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: { screenshotStorageId: "old_screenshot" },
        },
      };
      const newLinkPreview = { screenshotStorageId: "new_screenshot" };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock().mockResolvedValue(null) },
      } as any;

      await updateCardMetadataHandler(ctx, { cardId: "c1", linkPreview: newLinkPreview, status: "completed" });

      expect(ctx.storage.delete).toHaveBeenCalledWith("old_screenshot");
      expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", expect.objectContaining({
        metadata: expect.objectContaining({
          linkPreview: expect.objectContaining({ screenshotStorageId: "new_screenshot" }),
        }),
      }));
    });

    test("preserves existing screenshot when new screenshot not provided", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: {
            screenshotStorageId: "old_screenshot",
            screenshotUpdatedAt: 1000,
            screenshotWidth: 1200,
            screenshotHeight: 800,
          },
        },
      };
      const newLinkPreview = { title: "New Title" };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock() },
      } as any;

      await updateCardMetadataHandler(ctx, { cardId: "c1", linkPreview: newLinkPreview, status: "completed" });

      expect(ctx.storage.delete).not.toHaveBeenCalled();
      expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", expect.objectContaining({
        metadata: expect.objectContaining({
          linkPreview: expect.objectContaining({
            screenshotStorageId: "old_screenshot",
            screenshotUpdatedAt: 1000,
            screenshotWidth: 1200,
            screenshotHeight: 800,
          }),
        }),
      }));
    });

    test("preserves screenshot dimensions when same screenshot", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: {
            screenshotStorageId: "same_screenshot",
            screenshotWidth: 1200,
            screenshotHeight: 800,
          },
        },
      };
      const newLinkPreview = { screenshotStorageId: "same_screenshot" };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock() },
      } as any;

      await updateCardMetadataHandler(ctx, { cardId: "c1", linkPreview: newLinkPreview, status: "completed" });

      expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", expect.objectContaining({
        metadata: expect.objectContaining({
          linkPreview: expect.objectContaining({
            screenshotStorageId: "same_screenshot",
            screenshotWidth: 1200,
            screenshotHeight: 800,
          }),
        }),
      }));
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
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock() },
      } as any;

      await updateCardMetadataHandler(ctx, { cardId: "c1", linkPreview: newLinkPreview, status: "completed" });

      expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", expect.objectContaining({
        metadata: expect.objectContaining({
          linkCategory: { category: "news" },
        }),
      }));
    });

    test("preserves existing metadata for non-link type", async () => {
      const existingCard = {
        _id: "c1",
        type: "image",
        metadata: {
          existingField: "existing value",
        },
      };
      const newLinkPreview = { title: "New Title" };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock() },
      } as any;

      await updateCardMetadataHandler(ctx, { cardId: "c1", linkPreview: newLinkPreview, status: "completed" });

      expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", expect.objectContaining({
        metadata: expect.objectContaining({
          existingField: "existing value",
        }),
      }));
    });

    test("sets metadataTitle and metadataDescription", async () => {
      const existingCard = { _id: "c1", type: "link" };
      const newLinkPreview = { title: "Test Title", description: "Test Description" };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock() },
      } as any;

      await updateCardMetadataHandler(ctx, { cardId: "c1", linkPreview: newLinkPreview, status: "completed" });

      expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", expect.objectContaining({
        metadataTitle: "Test Title",
        metadataDescription: "Test Description",
      }));
    });

    test("handles image delete error gracefully", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: { imageStorageId: "old_image" },
        },
      };
      const newLinkPreview = { imageStorageId: "new_image" };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock().mockRejectedValue(new Error("Storage error")) },
      } as any;

      await updateCardMetadataHandler(ctx, { cardId: "c1", linkPreview: newLinkPreview, status: "completed" });

      expect(ctx.db.patch).toHaveBeenCalled();
    });

    test("handles screenshot delete error gracefully", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: { screenshotStorageId: "old_screenshot" },
        },
      };
      const newLinkPreview = { screenshotStorageId: "new_screenshot" };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock().mockRejectedValue(new Error("Storage error")) },
      } as any;

      await updateCardMetadataHandler(ctx, { cardId: "c1", linkPreview: newLinkPreview, status: "completed" });

      expect(ctx.db.patch).toHaveBeenCalled();
    });

    test("sets metadataStatus", async () => {
      const existingCard = { _id: "c1", type: "link" };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock() },
      } as any;

      await updateCardMetadataHandler(ctx, { cardId: "c1", linkPreview: {}, status: "failed" });

      expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", expect.objectContaining({
        metadataStatus: "failed",
      }));
    });
  });

  describe("updateCardScreenshotHandler", () => {
    test("returns early when card not found", async () => {
      const ctx = { db: { get: mock().mockResolvedValue(null), patch: mock() } } as any;
      const result = await updateCardScreenshotHandler(ctx, {
        cardId: "c1",
        screenshotStorageId: "s1",
        screenshotUpdatedAt: 1000,
      });
      expect(result).toBeUndefined();
      expect(ctx.db.patch).not.toHaveBeenCalled();
    });

    test("returns early for non-link card", async () => {
      const ctx = {
        db: { get: mock().mockResolvedValue({ _id: "c1", type: "image" }), patch: mock() },
      } as any;
      const result = await updateCardScreenshotHandler(ctx, {
        cardId: "c1",
        screenshotStorageId: "s1",
        screenshotUpdatedAt: 1000,
      });
      expect(result).toBeUndefined();
      expect(ctx.db.patch).not.toHaveBeenCalled();
    });

    test("updates screenshot for link card", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: { linkPreview: {} },
      };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock() },
      } as any;

      await updateCardScreenshotHandler(ctx, {
        cardId: "c1",
        screenshotStorageId: "s1",
        screenshotUpdatedAt: 1000,
        screenshotWidth: 1200,
        screenshotHeight: 800,
      });

      expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", expect.objectContaining({
        metadata: expect.objectContaining({
          linkPreview: expect.objectContaining({
            screenshotStorageId: "s1",
            screenshotUpdatedAt: 1000,
            screenshotWidth: 1200,
            screenshotHeight: 800,
          }),
        }),
      }));
    });

    test("deletes previous screenshot when new one provided", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: { linkPreview: { screenshotStorageId: "old_screenshot" } },
      };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock().mockResolvedValue(null) },
      } as any;

      await updateCardScreenshotHandler(ctx, {
        cardId: "c1",
        screenshotStorageId: "new_screenshot",
        screenshotUpdatedAt: 1000,
      });

      expect(ctx.storage.delete).toHaveBeenCalledWith("old_screenshot");
    });

    test("handles screenshot delete error gracefully", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: { linkPreview: { screenshotStorageId: "old_screenshot" } },
      };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock().mockRejectedValue(new Error("Storage error")) },
      } as any;

      await updateCardScreenshotHandler(ctx, {
        cardId: "c1",
        screenshotStorageId: "new_screenshot",
        screenshotUpdatedAt: 1000,
      });

      expect(ctx.db.patch).toHaveBeenCalled();
    });

    test("preserves existing screenshot dimensions when not provided", async () => {
      const existingCard = {
        _id: "c1",
        type: "link",
        metadata: {
          linkPreview: {
            screenshotStorageId: "existing_screenshot",
            screenshotUpdatedAt: 500,
            screenshotWidth: 1000,
            screenshotHeight: 750,
          },
        },
      };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock() },
      } as any;

      await updateCardScreenshotHandler(ctx, {
        cardId: "c1",
        screenshotStorageId: "new_screenshot",
        screenshotUpdatedAt: 1000,
      });

      expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", expect.objectContaining({
        metadata: expect.objectContaining({
          linkPreview: expect.objectContaining({
            screenshotStorageId: "new_screenshot",
            screenshotUpdatedAt: 1000,
          }),
        }),
      }));
    });

    test("creates new metadata when none exists", async () => {
      const existingCard = { _id: "c1", type: "link", metadata: undefined };
      const ctx = {
        db: {
          get: mock().mockResolvedValue(existingCard),
          patch: mock().mockResolvedValue(null),
        },
        storage: { delete: mock() },
      } as any;

      await updateCardScreenshotHandler(ctx, {
        cardId: "c1",
        screenshotStorageId: "s1",
        screenshotUpdatedAt: 1000,
      });

      expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", expect.objectContaining({
        metadata: expect.objectContaining({
          linkPreview: expect.objectContaining({
            screenshotStorageId: "s1",
          }),
        }),
      }));
    });
  });
});
