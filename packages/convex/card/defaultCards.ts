import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { CardType } from "../schema";
import { type ProcessingStatus, stageCompleted } from "./processingStatus";

// Helper to create a fully completed processing status
const buildCompletedProcessingStatus = (now: number): ProcessingStatus => ({
  classify: stageCompleted(now, 1),
  categorize: stageCompleted(now, 1),
  metadata: stageCompleted(now, 1),
  renderables: stageCompleted(now, 1),
});

// Helper to create a color object
const createColor = (
  hex: string,
  name?: string
): {
  hex: string;
  name?: string;
  rgb?: { r: number; g: number; b: number };
  hsl?: { h: number; s: number; l: number };
} => ({
  hex,
  ...(name && { name }),
});

// Type for default card definitions - all properties are optional
type DefaultCardDef = {
  type: CardType;
  content: string;
  url?: string;
  tags?: string[];
  notes?: string;
  colors?: ReturnType<typeof createColor>[];
  aiTags?: string[];
  aiSummary?: string;
  isFavorited?: boolean;
};

// All default cards in order - typed as DefaultCardDef to allow optional properties
const DEFAULT_CARDS: DefaultCardDef[] = [
  {
    type: "text",
    content:
      "Welcome to Teak! Start capturing your thoughts, links, and inspiration.",
    notes:
      "This is your first card. Cards are where you save anything—links, images, notes, quotes, and more. Try pasting a URL above to see the magic happen!",
    aiTags: ["welcome", "getting-started", "onboarding", "tutorial"],
    aiSummary:
      "A welcome introduction to Teak, explaining how to use cards for capturing thoughts, links, and media.",
    isFavorited: true,
  },
  {
    type: "quote",
    content: "The best way to predict the future is to invent it.",
    notes: "— Alan Kay, pioneering computer scientist",
    aiTags: [
      "quote",
      "inspiration",
      "alan-kay",
      "innovation",
      "technology",
      "future",
    ],
    aiSummary:
      "An inspirational quote from Alan Kay about the power of creating and innovating rather than speculating.",
    isFavorited: false,
  },
  {
    type: "palette",
    content: "Sunset gradient palette",
    colors: [
      createColor("#FF6B6B", "Coral Red"),
      createColor("#FFA06B", "Sunset Orange"),
      createColor("#FFD93D", "Golden Yellow"),
      createColor("#6BCB77", "Fresh Green"),
      createColor("#4D96FF", "Sky Blue"),
    ],
    aiTags: ["palette", "colors", "design", "sunset", "gradient", "ui"],
    aiSummary:
      "A beautiful sunset-inspired color palette. Use palette cards to save color combinations for your design projects.",
    isFavorited: false,
  },
];

/**
 * Internal mutation to create default cards for a new user.
 * Only creates cards if the user has no existing non-deleted cards.
 * Uses internal mutation to bypass rate limits.
 */
export const createDefaultCardsForUser = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    // Check if user already has any non-deleted cards
    const existingCard = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q.eq("userId", userId).eq("isDeleted", undefined)
      )
      .first();

    if (existingCard) {
      return { created: false, reason: "cards_exist" as const };
    }

    // Create default cards with slight timestamp offsets for consistent ordering
    const now = Date.now();
    const processingStatus = buildCompletedProcessingStatus(now);

    for (let i = 0; i < DEFAULT_CARDS.length; i++) {
      const cardDef = DEFAULT_CARDS[i];
      const timestamp = now + i * 1000; // 1 second offset per card

      await ctx.db.insert("cards", {
        userId,
        type: cardDef.type,
        content: cardDef.content,
        url: cardDef.url,
        tags: cardDef.tags,
        notes: cardDef.notes,
        colors: cardDef.colors as any,
        aiTags: cardDef.aiTags,
        aiSummary: cardDef.aiSummary,
        isFavorited: cardDef.isFavorited,
        metadataStatus: "completed",
        processingStatus,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    return { created: true, count: DEFAULT_CARDS.length };
  },
});

// Export for reference and testing
export { DEFAULT_CARDS };
