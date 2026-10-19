import { describe, expect, it } from "bun:test";
import { updateCategorization } from "../../../../../convex/workflows/steps/categorization/mutations";
import { withSearchSyncDb } from "../../../helpers/session.test-utils";

const withScheduler = (registered: any) => {
  const handler = registered.handler ?? registered._handler ?? registered;
  return (ctx: any, args: any) =>
    handler({ ...ctx, scheduler: { runAfter: async () => null } }, args);
};

describe("categorization updateCategorization", () => {
  it("updates categorization metadata without wiping AI fields", async () => {
    const mutation = withScheduler(updateCategorization);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        aiTags: ["technology", "programming", "tutorial"],
        aiSummary: "A comprehensive guide to TypeScript best practices",
        aiTranscript: "Transcript",
        metadata: {
          linkPreview: { status: "success", title: "TypeScript Guide" },
        },
        processingStatus: {
          classify: { status: "completed" },
          categorize: { status: "completed" },
          metadata: { status: "completed" },
        },
      };

      const mockCtx = {
        db: withSearchSyncDb({
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        }),
      };

      expect(typeof mutation).toBe("function");

      await mutation(mockCtx, {
        cardId: "card_123",
        metadata: {
          category: "article",
          confidence: 0.95,
          fetchedAt: now,
        },
      });

      expect(cardState.aiTags).toEqual([
        "technology",
        "programming",
        "tutorial",
      ]);
      expect(cardState.aiSummary).toBe(
        "A comprehensive guide to TypeScript best practices"
      );
      expect(cardState.aiTranscript).toBe("Transcript");
      expect(cardState.metadata?.linkCategory?.category).toBe("article");
      expect(cardState.processingStatus?.categorize?.status).toBe("completed");
    } finally {
      Date.now = originalNow;
    }
  });

  it("skips if the card was deleted during categorization", async () => {
    const mutation = withScheduler(updateCategorization);

    const mockCtx = {
      db: withSearchSyncDb({ get: async () => null }),
    };

    await expect(
      mutation(mockCtx, { cardId: "card_missing", metadata: {} })
    ).resolves.toBeNull();
  });
});

describe("categorization updateCategorization preview image", () => {
  const run = async (linkPreview: Record<string, unknown>) => {
    let cardState: any = {
      _id: "card_1",
      metadata: { linkPreview },
      processingStatus: {},
    };
    const ctx = {
      db: withSearchSyncDb({
        get: async () => cardState,
        patch: (_table: string, _id: string, updates: any) => {
          cardState = { ...cardState, ...updates };
        },
      }),
    };
    await withScheduler(updateCategorization)(ctx, {
      cardId: "card_1",
      metadata: { category: "book", fetchedAt: 1, sourceUrl: "https://x" },
      previewImage: {
        imageHeight: 500,
        imageStorageKey: "users/u/cards/card_1/link-preview-image",
        imageUpdatedAt: 2,
        imageWidth: 330,
      },
    });
    return cardState.metadata.linkPreview;
  };

  it("gives a preview with no image the site's", async () => {
    expect(await run({ status: "success", title: "A book" })).toEqual({
      imageHeight: 500,
      imageStorageKey: "users/u/cards/card_1/link-preview-image",
      imageUpdatedAt: 2,
      imageWidth: 330,
      status: "success",
      title: "A book",
    });
  });

  it("never replaces the page's own image", async () => {
    const own = {
      imageStorageKey: "users/u/cards/card_1/own",
      status: "success",
    };
    expect(await run(own)).toEqual(own);
  });

  it("leaves a failed preview alone", async () => {
    expect(await run({ status: "error" })).toEqual({ status: "error" });
  });
});
