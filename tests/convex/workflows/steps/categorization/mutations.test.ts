import { describe, expect, it } from "bun:test";
import { updateCategorization } from '../../../../../convex/workflows/steps/categorization/mutations';

describe("categorization updateCategorization", () => {
  it("updates categorization metadata without wiping AI fields", async () => {
    const mutation =
      (updateCategorization as any).handler ||
      (updateCategorization as any)._handler ||
      (updateCategorization as any);

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
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: async (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
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

      expect(cardState.aiTags).toEqual(["technology", "programming", "tutorial"]);
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

  it("throws if card not found", async () => {
    const mutation =
      (updateCategorization as any).handler ||
      (updateCategorization as any)._handler ||
      (updateCategorization as any);

    const mockCtx = {
      db: {
        get: async () => null,
      },
    };

    expect(mutation(mockCtx, { cardId: "card_missing", metadata: {} })).rejects.toThrow("not found");
  });
});
