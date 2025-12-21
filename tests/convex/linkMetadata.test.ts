// @ts-nocheck
import { describe, expect, test, mock } from "bun:test";
import { updateCardMetadataHandler, updateCardScreenshotHandler, getCardForMetadataHandler } from "../../convex/linkMetadata";

// Helper to create a mock context
const createMockCtx = () => ({
  db: {
    get: mock(),
    patch: mock(),
  },
  storage: {
    delete: mock(),
  },
} as any);

describe("linkMetadata", () => {

  describe("getCardForMetadata", () => {
    test("fetches card by id", async () => {
      const ctx = createMockCtx();
      const cardId = "card_123";
      const card = { _id: cardId, type: "link" };
      ctx.db.get.mockResolvedValue(card);

      const result = await getCardForMetadataHandler(ctx, { cardId });
      expect(ctx.db.get).toHaveBeenCalledWith("cards", cardId);
      expect(result).toEqual(card);
    });
  });

  describe("updateCardMetadata", () => {
    test("returns early if card not found", async () => {
      const ctx = createMockCtx();
      ctx.db.get.mockResolvedValue(null);

      await updateCardMetadataHandler(ctx, {
        cardId: "card_123",
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
        cardId: "card_123",
        linkPreview,
        status: "completed",
      });

      expect(ctx.db.patch).toHaveBeenCalledWith("cards", "card_123", expect.objectContaining({
        metadata: { linkPreview },
        metadataStatus: "completed",
        metadataTitle: "New Title",
      }));
    });

    test("deletes previous screenshot if replaced", async () => {
      const ctx = createMockCtx();
      const card = {
        _id: "card_123",
        type: "link",
        metadata: {
          linkPreview: { screenshotStorageId: "old_id", screenshotUpdatedAt: 100 },
        },
      };
      ctx.db.get.mockResolvedValue(card);

      const linkPreview = { screenshotStorageId: "new_id", screenshotUpdatedAt: 200 };
      await updateCardMetadataHandler(ctx, {
        cardId: "card_123",
        linkPreview,
        status: "completed",
      });

      expect(ctx.storage.delete).toHaveBeenCalledWith("old_id");
      expect(ctx.db.patch).toHaveBeenCalled();
    });

    test("preserves previous screenshot if new one missing", async () => {
      const ctx = createMockCtx();
      const card = {
        _id: "card_123",
        type: "link",
        metadata: {
          linkPreview: { screenshotStorageId: "old_id", screenshotUpdatedAt: 100 },
        },
      };
      ctx.db.get.mockResolvedValue(card);

      const linkPreview = { title: "Title" }; // No screenshot info
      await updateCardMetadataHandler(ctx, {
        cardId: "card_123",
        linkPreview,
        status: "completed",
      });

      expect(ctx.storage.delete).not.toHaveBeenCalled();
      expect(ctx.db.patch).toHaveBeenCalledWith("cards", "card_123", expect.objectContaining({
        metadata: expect.objectContaining({
          linkPreview: expect.objectContaining({
            screenshotStorageId: "old_id",
            screenshotUpdatedAt: 100,
          }),
        }),
      }));
    });

    test("handles delete error gracefully", async () => {
         const ctx = createMockCtx();
         const card = {
           _id: "card_123",
           type: "link",
           metadata: {
             linkPreview: { screenshotStorageId: "old_id" },
           },
         };
         ctx.db.get.mockResolvedValue(card);
         ctx.storage.delete.mockRejectedValue(new Error("Storage error"));
   
         const linkPreview = { screenshotStorageId: "new_id" };
         await updateCardMetadataHandler(ctx, {
           cardId: "card_123",
           linkPreview,
           status: "completed",
         });
   
         expect(ctx.storage.delete).toHaveBeenCalled();
         // Should still patch
         expect(ctx.db.patch).toHaveBeenCalled();
    });

    test("handles non-link card", async () => {
        const ctx = createMockCtx();
        const card = { _id: "card_123", type: "note", metadata: { other: "data" } };
        ctx.db.get.mockResolvedValue(card);
  
        const linkPreview = { title: "New Title" };
        await updateCardMetadataHandler(ctx, {
          cardId: "card_123",
          linkPreview,
          status: "completed",
        });
  
        expect(ctx.db.patch).toHaveBeenCalledWith("cards", "card_123", expect.objectContaining({
          metadata: expect.objectContaining({
              other: "data",
              linkPreview,
          }),
        }));
    });
    
    test("preserves existing category", async () => {
         const ctx = createMockCtx();
         const card = { 
             _id: "card_123", 
             type: "link", 
             metadata: { linkCategory: "news" } 
         };
         ctx.db.get.mockResolvedValue(card);
   
         const linkPreview = { title: "New Title" };
         await updateCardMetadataHandler(ctx, {
           cardId: "card_123",
           linkPreview,
           status: "completed",
         });
   
         expect(ctx.db.patch).toHaveBeenCalledWith("cards", "card_123", expect.objectContaining({
           metadata: expect.objectContaining({
               linkCategory: "news",
           }),
         }));
    });

    test("handles empty linkPreview arg", async () => {
        const ctx = createMockCtx();
        const card = { _id: "card_123", type: "link", metadata: {} };
        ctx.db.get.mockResolvedValue(card);

        await updateCardMetadataHandler(ctx, {
            cardId: "card_123",
            linkPreview: undefined,
            status: "failed",
        });

        expect(ctx.db.patch).toHaveBeenCalledWith("cards", "card_123", expect.objectContaining({
            metadataStatus: "failed",
        }));
    });
    test("updates description if provided", async () => {
      const ctx = createMockCtx();
      const card = { _id: "card_123", type: "link", metadata: {} };
      ctx.db.get.mockResolvedValue(card);

      const linkPreview = { description: "New Desc" };
      await updateCardMetadataHandler(ctx, {
        cardId: "card_123",
        linkPreview,
        status: "completed",
      });

      expect(ctx.db.patch).toHaveBeenCalledWith("cards", "card_123", expect.objectContaining({
        metadataDescription: "New Desc",
      }));
    });

    test("preserves existing category for non-link card", async () => {
         const ctx = createMockCtx();
         const card = { 
             _id: "card_123", 
             type: "note", 
             metadata: { linkCategory: "news", other: "data" } 
         };
         ctx.db.get.mockResolvedValue(card);
   
         const linkPreview = { title: "New Title" };
         await updateCardMetadataHandler(ctx, {
           cardId: "card_123",
           linkPreview,
           status: "completed",
         });
   
         expect(ctx.db.patch).toHaveBeenCalledWith("cards", "card_123", expect.objectContaining({
           metadata: expect.objectContaining({
               linkCategory: "news",
               other: "data",
           }),
         }));
    });
  });

  describe("updateCardScreenshot", () => {
    test("returns early if card not found", async () => {
      const ctx = createMockCtx();
      ctx.db.get.mockResolvedValue(null);
      await updateCardScreenshotHandler(ctx, { cardId: "c1", screenshotStorageId: "s1", screenshotUpdatedAt: 1 });
      expect(ctx.db.patch).not.toHaveBeenCalled();
    });

    test("returns early if not a link card", async () => {
        const ctx = createMockCtx();
        ctx.db.get.mockResolvedValue({type: "note"});
        await updateCardScreenshotHandler(ctx, { cardId: "c1", screenshotStorageId: "s1", screenshotUpdatedAt: 1 });
        expect(ctx.db.patch).not.toHaveBeenCalled();
    });

    test("updates screenshot and deletes old one", async () => {
        const ctx = createMockCtx();
        const card = {
            _id: "c1",
            type: "link",
            metadata: {
                linkPreview: { screenshotStorageId: "old", screenshotUpdatedAt: 1 }
            }
        };
        ctx.db.get.mockResolvedValue(card);
        
        await updateCardScreenshotHandler(ctx, { cardId: "c1", screenshotStorageId: "new", screenshotUpdatedAt: 2 });
        
        expect(ctx.storage.delete).toHaveBeenCalledWith("old");
        expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", expect.objectContaining({
            metadata: {
                linkPreview: { screenshotStorageId: "new", screenshotUpdatedAt: 2 }
            }
        }));
    });

    test("handles delete error gracefully", async () => {
        const ctx = createMockCtx();
        const card = {
            _id: "c1",
            type: "link",
            metadata: {
                linkPreview: { screenshotStorageId: "old" }
            }
        };
        ctx.db.get.mockResolvedValue(card);
        ctx.storage.delete.mockRejectedValue(new Error("fail"));
        
        await updateCardScreenshotHandler(ctx, { cardId: "c1", screenshotStorageId: "new", screenshotUpdatedAt: 2 });
        
        expect(ctx.storage.delete).toHaveBeenCalled();
        expect(ctx.db.patch).toHaveBeenCalled();
    });

    test("handles missing metadata/linkPreview", async () => {
        const ctx = createMockCtx();
        const card = {
            _id: "c1",
            type: "link",
        };
        ctx.db.get.mockResolvedValue(card);
        
        await updateCardScreenshotHandler(ctx, { cardId: "c1", screenshotStorageId: "new", screenshotUpdatedAt: 2 });
        
        expect(ctx.storage.delete).not.toHaveBeenCalled();
        expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", expect.objectContaining({
            metadata: {
                linkPreview: { screenshotStorageId: "new", screenshotUpdatedAt: 2 }
            }
        }));
    });
  });
});