// @ts-nocheck
import { describe, expect, test } from "bun:test";
import {
  markClassificationCompleted,
  updateClassification,
} from "../../../../convex/workflows/steps/classificationMutations";

const withScheduler = (registered: any) => {
  const handler = registered.handler ?? registered._handler ?? registered;
  return (ctx: any, args: any) =>
    handler({ ...ctx, scheduler: { runAfter: async () => null } }, args);
};

describe("classification updateClassification", () => {
  test("updates card type and processing status", async () => {
    const mutation = withScheduler(updateClassification);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        type: "text",
        content: "Some content",
        processingStatus: {},
      };

      const mockCtx = {
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
      };

      await mutation(mockCtx, {
        cardId: "card_123",
        type: "image",
        confidence: 0.95,
      });

      expect(cardState.type).toBe("image");
      expect(cardState.processingStatus.classify.status).toBe("completed");
      expect(cardState.processingStatus.classify.confidence).toBe(0.95);
    } finally {
      Date.now = originalNow;
    }
  });

  test("sets categorize to pending for link type", async () => {
    const mutation = withScheduler(updateClassification);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        type: "text",
        processingStatus: {},
      };

      const mockCtx = {
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
      };

      await mutation(mockCtx, {
        cardId: "card_123",
        type: "link",
        confidence: 0.9,
      });

      expect(cardState.processingStatus.categorize.status).toBe("pending");
    } finally {
      Date.now = originalNow;
    }
  });

  test("sets categorize to completed for non-link type", async () => {
    const mutation = withScheduler(updateClassification);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        type: "text",
        processingStatus: {},
      };

      const mockCtx = {
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
      };

      await mutation(mockCtx, {
        cardId: "card_123",
        type: "image",
        confidence: 0.9,
      });

      expect(cardState.processingStatus.categorize.status).toBe("completed");
      expect(cardState.processingStatus.categorize.confidence).toBe(1);
    } finally {
      Date.now = originalNow;
    }
  });

  test("always sets metadata to pending", async () => {
    const mutation = withScheduler(updateClassification);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        type: "text",
        processingStatus: {},
      };

      const mockCtx = {
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
      };

      await mutation(mockCtx, {
        cardId: "card_123",
        type: "video",
        confidence: 0.85,
      });

      expect(cardState.processingStatus.metadata.status).toBe("pending");
    } finally {
      Date.now = originalNow;
    }
  });

  test("sets renderables to pending for image type", async () => {
    const mutation = withScheduler(updateClassification);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        type: "text",
        processingStatus: {},
      };

      const mockCtx = {
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
      };

      await mutation(mockCtx, {
        cardId: "card_123",
        type: "image",
        confidence: 0.9,
      });

      expect(cardState.processingStatus.renderables.status).toBe("pending");
    } finally {
      Date.now = originalNow;
    }
  });

  test("sets renderables to pending for video type", async () => {
    const mutation = withScheduler(updateClassification);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        type: "text",
        processingStatus: {},
      };

      const mockCtx = {
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
      };

      await mutation(mockCtx, {
        cardId: "card_123",
        type: "video",
        confidence: 0.88,
      });

      expect(cardState.processingStatus.renderables.status).toBe("pending");
    } finally {
      Date.now = originalNow;
    }
  });

  test("sets renderables to pending for document type", async () => {
    const mutation = withScheduler(updateClassification);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        type: "text",
        processingStatus: {},
      };

      const mockCtx = {
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
      };

      await mutation(mockCtx, {
        cardId: "card_123",
        type: "document",
        confidence: 0.85,
      });

      expect(cardState.processingStatus.renderables.status).toBe("pending");
    } finally {
      Date.now = originalNow;
    }
  });

  test("sets renderables to completed for text type", async () => {
    const mutation = withScheduler(updateClassification);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        type: "text",
        processingStatus: {},
      };

      const mockCtx = {
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
      };

      await mutation(mockCtx, {
        cardId: "card_123",
        type: "text",
        confidence: 0.7,
      });

      expect(cardState.processingStatus.renderables.status).toBe("completed");
    } finally {
      Date.now = originalNow;
    }
  });

  test("sets metadataStatus to pending for link type", async () => {
    const mutation = withScheduler(updateClassification);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        type: "text",
        processingStatus: {},
      };

      const mockCtx = {
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
      };

      await mutation(mockCtx, {
        cardId: "card_123",
        type: "link",
        confidence: 0.9,
      });

      expect(cardState.metadataStatus).toBe("pending");
    } finally {
      Date.now = originalNow;
    }
  });

  test("does not set metadataStatus for non-link type", async () => {
    const mutation = withScheduler(updateClassification);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        type: "text",
        processingStatus: {},
      };

      const mockCtx = {
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
      };

      await mutation(mockCtx, {
        cardId: "card_123",
        type: "image",
        confidence: 0.9,
      });

      expect(cardState.metadataStatus).toBeUndefined();
    } finally {
      Date.now = originalNow;
    }
  });

  test("normalizes quote content by removing quotes", async () => {
    const mutation = withScheduler(updateClassification);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        type: "text",
        content: '"This is a quote" - Author',
        processingStatus: {},
      };

      const mockCtx = {
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
      };

      await mutation(mockCtx, {
        cardId: "card_123",
        type: "quote",
        confidence: 0.95,
      });

      expect(cardState.content).toBe("This is a quote - Author");
    } finally {
      Date.now = originalNow;
    }
  });

  test("does not update content if quotes not removed", async () => {
    const mutation = withScheduler(updateClassification);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        type: "text",
        content: "Just normal text",
        processingStatus: {},
      };

      const mockCtx = {
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
      };

      await mutation(mockCtx, {
        cardId: "card_123",
        type: "quote",
        confidence: 0.95,
      });

      expect(cardState.content).toBe("Just normal text");
    } finally {
      Date.now = originalNow;
    }
  });

  test("handles undefined content for quote normalization", async () => {
    const mutation = withScheduler(updateClassification);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        type: "text",
        content: undefined,
        processingStatus: {},
      };

      const mockCtx = {
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
      };

      await mutation(mockCtx, {
        cardId: "card_123",
        type: "quote",
        confidence: 0.95,
      });

      expect(cardState.content).toBeUndefined();
    } finally {
      Date.now = originalNow;
    }
  });

  test("skips if the card was deleted during classification", async () => {
    const mutation = withScheduler(updateClassification);

    const mockCtx = {
      db: {
        get: async () => null,
      },
    };

    await expect(
      mutation(mockCtx, {
        cardId: "card_missing",
        type: "text",
        confidence: 0.9,
      })
    ).resolves.toBeNull();
  });

  test("preserves existing processing status fields", async () => {
    const mutation = withScheduler(updateClassification);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        type: "text",
        processingStatus: {
          someOtherField: "value",
        },
      };

      const mockCtx = {
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
      };

      await mutation(mockCtx, {
        cardId: "card_123",
        type: "image",
        confidence: 0.9,
      });

      expect(cardState.processingStatus.someOtherField).toBe("value");
    } finally {
      Date.now = originalNow;
    }
  });

  test("sets renderables to completed for quote type", async () => {
    const mutation = withScheduler(updateClassification);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        type: "text",
        processingStatus: {},
      };

      const mockCtx = {
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
      };

      await mutation(mockCtx, {
        cardId: "card_123",
        type: "quote",
        confidence: 0.95,
      });

      expect(cardState.processingStatus.renderables.status).toBe("completed");
    } finally {
      Date.now = originalNow;
    }
  });

  test("sets renderables to completed for link type", async () => {
    const mutation = withScheduler(updateClassification);

    const now = 1_760_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      let cardState: any = {
        _id: "card_123",
        type: "text",
        processingStatus: {},
      };

      const mockCtx = {
        db: {
          get: async (_table: string, _id: string) => cardState,
          patch: (_table: string, _id: string, updates: any) => {
            cardState = { ...cardState, ...updates };
          },
        },
      };

      await mutation(mockCtx, {
        cardId: "card_123",
        type: "link",
        confidence: 0.9,
      });

      expect(cardState.processingStatus.renderables.status).toBe("completed");
    } finally {
      Date.now = originalNow;
    }
  });
});

describe("classification markClassificationCompleted", () => {
  test("marks a pending classify stage completed without touching other stages", async () => {
    const mutation = withScheduler(markClassificationCompleted);

    let patchCount = 0;
    const cardState: any = {
      _id: "card_123",
      type: "link",
      url: "https://example.com/page",
      metadataStatus: "pending",
      processingStatus: {
        classify: { status: "pending" },
        categorize: { status: "pending" },
      },
    };

    const mockCtx = {
      db: {
        get: async (_table: string, _id: string) => cardState,
        patch: (_table: string, _id: string, updates: any) => {
          patchCount += 1;
          Object.assign(cardState, updates);
        },
      },
    };

    await mutation(mockCtx, { cardId: "card_123", confidence: 0.8 });

    expect(patchCount).toBe(1);
    expect(cardState.processingStatus.classify.status).toBe("completed");
    expect(cardState.processingStatus.classify.confidence).toBe(0.8);
    expect(cardState.processingStatus.categorize.status).toBe("pending");
    expect(cardState.type).toBe("link");
    expect(cardState.metadataStatus).toBe("pending");
  });

  test("is a no-op when classify is already completed", async () => {
    const mutation = withScheduler(markClassificationCompleted);

    let patchCount = 0;
    const cardState: any = {
      _id: "card_123",
      type: "link",
      processingStatus: {
        classify: { status: "completed", confidence: 0.7 },
      },
    };

    const mockCtx = {
      db: {
        get: async (_table: string, _id: string) => cardState,
        patch: () => {
          patchCount += 1;
        },
      },
    };

    await mutation(mockCtx, { cardId: "card_123", confidence: 0.9 });

    expect(patchCount).toBe(0);
    expect(cardState.processingStatus.classify.confidence).toBe(0.7);
  });

  test("returns null for a missing card", async () => {
    const mutation = withScheduler(markClassificationCompleted);

    const mockCtx = {
      db: {
        get: async () => null,
        patch: () => {
          throw new Error("should not patch");
        },
      },
    };

    await expect(
      mutation(mockCtx, { cardId: "missing", confidence: 0.9 })
    ).resolves.toBeNull();
  });
});
