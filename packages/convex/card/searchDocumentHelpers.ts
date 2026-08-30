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

const LEGACY_GENERAL_SEARCH_INDEXES = [
  { field: "content", index: "search_content" },
  { field: "notes", index: "search_notes" },
  { field: "aiSummary", index: "search_ai_summary" },
  { field: "aiTranscript", index: "search_ai_transcript" },
  { field: "metadataTitle", index: "search_metadata_title" },
  { field: "metadataDescription", index: "search_metadata_description" },
  { field: "tags", index: "search_tags" },
  { field: "aiTags", index: "search_ai_tags" },
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

export const deduplicateCardSearchResults = (
  resultSets: readonly (readonly Doc<"cards">[])[]
): Doc<"cards">[] =>
  Array.from(
    new Map(
      resultSets.flatMap((results) =>
        results.map((card) => [card._id, card] as const)
      )
    ).values()
  );

export const scheduleCardSearchSync = async (
  ctx: Pick<MutationCtx, "scheduler">,
  cardId: Id<"cards">
) => {
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
  cardId: Id<"cards">,
  options: { migrationBackfill?: boolean } = {}
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
    migrationBackfilledAt:
      options.migrationBackfill && !existing ? Date.now() : undefined,
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

export const searchCardsAcrossGeneralIndexes = async (
  ctx: QueryCtx,
  args: {
    userId: string;
    searchQuery: string;
    isDeleted?: boolean;
    isFavorited?: boolean;
    type?: Doc<"cards">["type"];
    limit: number;
    legacyFields?: ReadonlySet<
      (typeof LEGACY_GENERAL_SEARCH_INDEXES)[number]["field"]
    >;
    resultFilter?: (card: Doc<"cards">) => boolean;
  }
): Promise<Doc<"cards">[]> => {
  const legacyIndexes = args.legacyFields
    ? LEGACY_GENERAL_SEARCH_INDEXES.filter(({ field }) =>
        args.legacyFields?.has(field)
      )
    : LEGACY_GENERAL_SEARCH_INDEXES;
  // Convex permits at most 4,096 documents in a single query result. Grow to
  // that platform bound only when overlap or post-index filters require it.
  const maximumSourceLimit = 4096;
  let sourceLimit = Math.min(100, Math.max(1, args.limit));
  while (true) {
    const sourceResults = await Promise.all([
      ctx.db
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
        .take(sourceLimit),
      ...legacyIndexes.map(({ field, index }) =>
        ctx.db
          .query("cards")
          .withSearchIndex(index, (query: any) => {
            let filtered = query
              .search(field, args.searchQuery)
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
          .take(sourceLimit)
      ),
    ]);
    const cardsById = new Map<Id<"cards">, Doc<"cards">>();
    const derivedDocuments = sourceResults[0] as Array<
      Doc<"cardSearchDocuments"> | Doc<"cards">
    >;
    if (derivedDocuments.every((document) => !("cardId" in document))) {
      for (const card of derivedDocuments as Doc<"cards">[]) {
        cardsById.set(card._id, card);
      }
    } else {
      const derivedCards = await Promise.all(
        (derivedDocuments as Doc<"cardSearchDocuments">[]).map((document) =>
          ctx.db.get("cards", document.cardId)
        )
      );
      for (const card of derivedCards) {
        if (card) {
          cardsById.set(card._id, card);
        }
      }
    }
    for (const results of sourceResults.slice(1) as Doc<"cards">[][]) {
      for (const card of results) {
        cardsById.set(card._id, card);
      }
    }
    const cards = Array.from(cardsById.values()).filter(
      args.resultFilter ?? (() => true)
    );
    const sourcesExhausted = sourceResults.every(
      (results) => results.length < sourceLimit
    );
    if (
      cards.length >= args.limit ||
      sourcesExhausted ||
      sourceLimit >= maximumSourceLimit
    ) {
      return cards;
    }
    sourceLimit = Math.min(sourceLimit * 2, maximumSourceLimit);
  }
};
