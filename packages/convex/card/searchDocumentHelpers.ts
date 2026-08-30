import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

const internalAny = internal as any;

const SEARCH_FIELDS = [
  "content",
  "notes",
  "aiSummary",
  "aiTranscript",
  "metadataTitle",
  "metadataDescription",
] as const;

export const buildCardSearchText = (card: Doc<"cards">): string =>
  [
    ...SEARCH_FIELDS.map((field) => card[field]),
    ...(card.tags ?? []),
    ...(card.aiTags ?? []),
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0
    )
    .join("\n");

export const scheduleCardSearchSync = async (
  ctx: Partial<Pick<MutationCtx, "scheduler">>,
  cardId: Id<"cards">
) => {
  if (!ctx.scheduler) {
    return;
  }
  await ctx.scheduler.runAfter(
    0,
    internalAny["card/searchDocuments"].syncCardSearchDocument,
    { cardId }
  );
};

export const patchCardWithSearchSync = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  value: Partial<Omit<Doc<"cards">, "_creationTime" | "_id">>
) => {
  await ctx.db.patch("cards", cardId, value);
  await scheduleCardSearchSync(ctx, cardId);
};

export const syncCardSearchDocumentHandler = async (
  ctx: MutationCtx,
  cardId: Id<"cards">
) => {
  const [card, existing] = await Promise.all([
    ctx.db.get("cards", cardId),
    ctx.db
      .query("cardSearchDocuments")
      .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
      .unique(),
  ]);

  if (!card) {
    if (existing) {
      await ctx.db.delete("cardSearchDocuments", existing._id);
    }
    return null;
  }

  const value = {
    cardId,
    userId: card.userId,
    searchableText: buildCardSearchText(card),
    isDeleted: card.isDeleted,
    type: card.type,
    isFavorited: card.isFavorited,
    sourceUpdatedAt: card.updatedAt,
  };
  if (existing) {
    if (existing.sourceUpdatedAt <= card.updatedAt) {
      await ctx.db.replace("cardSearchDocuments", existing._id, value);
    }
  } else {
    await ctx.db.insert("cardSearchDocuments", value);
  }
  return null;
};

export const searchDerivedCards = async (
  ctx: QueryCtx,
  args: {
    userId: string;
    searchQuery: string;
    isDeleted?: boolean;
    isFavorited?: boolean;
    type?: Doc<"cards">["type"];
    limit: number;
  }
): Promise<Doc<"cards">[]> => {
  const documents = await ctx.db
    .query("cardSearchDocuments")
    .withSearchIndex("search_searchableText", (query) => {
      let filtered = query
        .search("searchableText", args.searchQuery)
        .eq("userId", args.userId)
        .eq("isDeleted", args.isDeleted);
      if (args.type !== undefined) {
        filtered = filtered.eq("type", args.type);
      }
      if (args.isFavorited !== undefined) {
        filtered = filtered.eq(
          "isFavorited",
          args.isFavorited ? true : undefined
        );
      }
      return filtered;
    })
    .take(args.limit);
  const cardIds = documents
    .map((document) => document.cardId)
    .filter((cardId): cardId is Id<"cards"> => typeof cardId === "string");
  if (cardIds.length === 0) {
    return [];
  }
  const cards = await Promise.all(
    cardIds.map((cardId) => ctx.db.get("cards", cardId))
  );
  return cards.filter((card): card is Doc<"cards"> => card !== null);
};
