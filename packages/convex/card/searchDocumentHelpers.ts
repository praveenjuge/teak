import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

const internalAny = internal as any;
export const CARD_SEARCH_TAG_SYNC_BATCH_SIZE = 32;

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

export const normalizeCardSearchTag = (tag: string): string =>
  tag.trim().toLowerCase();

export const buildCardSearchTags = (card: Doc<"cards">): string[] =>
  Array.from(
    new Set(
      [...(card.tags ?? []), ...(card.aiTags ?? [])]
        .map(normalizeCardSearchTag)
        .filter(Boolean)
    )
  ).sort();

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

export const scheduleCardSearchTagSync = async (
  ctx: Pick<MutationCtx, "scheduler">,
  cardId: Id<"cards">
) => {
  await ctx.scheduler.runAfter(
    0,
    internalAny["card/searchDocuments"].syncCardSearchTagsBatch,
    { cardId }
  );
};

export const restartCardSearchTagSync = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  sourceUpdatedAt?: number
) => {
  const existingState = await ctx.db
    .query("cardSearchTagSyncStates")
    .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
    .unique();
  if (existingState) {
    await ctx.db.patch("cardSearchTagSyncStates", existingState._id, {
      generation: existingState.generation + 1,
      offset: 0,
      pending: true,
      phase: "tags",
      sourceUpdatedAt,
    });
  } else {
    await ctx.db.insert("cardSearchTagSyncStates", {
      cardId,
      generation: 1,
      offset: 0,
      pending: true,
      phase: "tags",
      sourceUpdatedAt,
    });
  }
  await scheduleCardSearchTagSync(ctx, cardId);
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
    await restartCardSearchTagSync(ctx, cardId);
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
  let changed = false;
  if (existing) {
    if (
      existing.userId !== value.userId ||
      existing.searchableText !== value.searchableText ||
      existing.isDeleted !== value.isDeleted ||
      existing.type !== value.type ||
      existing.isFavorited !== value.isFavorited ||
      existing.sourceUpdatedAt !== value.sourceUpdatedAt
    ) {
      await ctx.db.replace("cardSearchDocuments", existing._id, value);
      changed = true;
    }
  } else {
    await ctx.db.insert("cardSearchDocuments", value);
    changed = true;
  }

  if (changed) {
    await restartCardSearchTagSync(ctx, cardId, card.updatedAt);
  }
  return null;
};

export const syncCardSearchTagsBatchHandler = async (
  ctx: MutationCtx,
  cardId: Id<"cards">
) => {
  const card = await ctx.db.get("cards", cardId);
  let state = await ctx.db
    .query("cardSearchTagSyncStates")
    .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
    .unique();
  if (!state) {
    const stateId = await ctx.db.insert("cardSearchTagSyncStates", {
      cardId,
      generation: 1,
      offset: 0,
      pending: true,
      phase: "tags",
      sourceUpdatedAt: card?.updatedAt,
    });
    state = await ctx.db.get("cardSearchTagSyncStates", stateId);
  }

  if (!state) {
    throw new Error("Failed to initialize card search tag synchronization");
  }
  if (state.phase === "complete") {
    return { complete: true, processed: 0, writes: 0 };
  }

  let writes = 0;
  if (state.phase === "pruneOld") {
    const oldTags = await ctx.db
      .query("cardSearchTags")
      .withIndex("by_cardId_and_generation", (query) => {
        const cardRange = query.eq("cardId", cardId);
        return card
          ? cardRange.lt("syncGeneration", state.generation)
          : cardRange.lte("syncGeneration", state.generation);
      })
      .take(CARD_SEARCH_TAG_SYNC_BATCH_SIZE);
    for (const tagDocument of oldTags) {
      await ctx.db.delete("cardSearchTags", tagDocument._id);
      writes += 1;
    }
    if (oldTags.length === CARD_SEARCH_TAG_SYNC_BATCH_SIZE) {
      await scheduleCardSearchTagSync(ctx, cardId);
      return { complete: false, processed: oldTags.length, writes };
    }
    if (card) {
      await ctx.db.patch("cardSearchTagSyncStates", state._id, {
        offset: 0,
        pending: false,
        phase: "complete",
      });
    } else {
      await ctx.db.delete("cardSearchTagSyncStates", state._id);
    }
    return { complete: true, processed: oldTags.length, writes };
  }

  if (!card) {
    await ctx.db.patch("cardSearchTagSyncStates", state._id, {
      offset: 0,
      phase: "pruneOld",
    });
    await scheduleCardSearchTagSync(ctx, cardId);
    return { complete: false, processed: 0, writes };
  }

  const source =
    state.phase === "tags" ? (card.tags ?? []) : (card.aiTags ?? []);
  const sourceSlice = source.slice(
    state.offset,
    state.offset + CARD_SEARCH_TAG_SYNC_BATCH_SIZE
  );
  const tags = Array.from(
    new Set(sourceSlice.map(normalizeCardSearchTag).filter(Boolean))
  );
  for (const tag of tags) {
    const existingTag = await ctx.db
      .query("cardSearchTags")
      .withIndex("by_cardId_and_tag", (query) =>
        query.eq("cardId", cardId).eq("tag", tag)
      )
      .take(1)
      .then((documents) => documents[0]);
    const tagValue = {
      cardId,
      userId: card.userId,
      tag,
      isDeleted: card.isDeleted === true ? true : undefined,
      type: card.type,
      isFavorited: card.isFavorited === true ? true : undefined,
      cardCreatedAt: card.createdAt,
      sourceUpdatedAt: card.updatedAt,
      syncGeneration: state.generation,
    };
    if (existingTag) {
      if (
        existingTag.userId !== tagValue.userId ||
        existingTag.isDeleted !== tagValue.isDeleted ||
        existingTag.type !== tagValue.type ||
        existingTag.isFavorited !== tagValue.isFavorited ||
        existingTag.cardCreatedAt !== tagValue.cardCreatedAt ||
        existingTag.sourceUpdatedAt !== tagValue.sourceUpdatedAt ||
        existingTag.syncGeneration !== tagValue.syncGeneration
      ) {
        await ctx.db.replace("cardSearchTags", existingTag._id, tagValue);
        writes += 1;
      }
    } else {
      await ctx.db.insert("cardSearchTags", tagValue);
      writes += 1;
    }
  }
  const nextOffset = state.offset + sourceSlice.length;
  if (nextOffset < source.length) {
    await ctx.db.patch("cardSearchTagSyncStates", state._id, {
      offset: nextOffset,
    });
    await scheduleCardSearchTagSync(ctx, cardId);
    return { complete: false, processed: sourceSlice.length, writes };
  }
  if (state.phase === "tags") {
    await ctx.db.patch("cardSearchTagSyncStates", state._id, {
      offset: 0,
      phase: "aiTags",
    });
    await scheduleCardSearchTagSync(ctx, cardId);
    return { complete: false, processed: sourceSlice.length, writes };
  }
  await ctx.db.patch("cardSearchTagSyncStates", state._id, {
    offset: 0,
    phase: "pruneOld",
  });
  await scheduleCardSearchTagSync(ctx, cardId);
  return { complete: false, processed: sourceSlice.length, writes };
};

export const searchCardsByExactTag = async (
  ctx: QueryCtx,
  args: {
    userId: string;
    tag: string;
    isDeleted?: boolean;
    isFavorited?: boolean;
    type?: Doc<"cards">["type"];
    createdAfter?: number;
    createdBefore?: number;
    limit: number;
    sort: "newest" | "oldest";
    resultFilter?: (card: Doc<"cards">) => boolean;
  }
): Promise<Doc<"cards">[]> => {
  const tag = normalizeCardSearchTag(args.tag);
  if (!tag) {
    return [];
  }
  const { isFavorited, type } = args;
  const takeLimit = Math.min(400, Math.max(1, args.limit));
  let tagDocuments: Doc<"cardSearchTags">[];
  if (type !== undefined && isFavorited !== undefined) {
    tagDocuments = await ctx.db
      .query("cardSearchTags")
      .withIndex("by_user_tag_deleted_type_favorited", (range) =>
        range
          .eq("userId", args.userId)
          .eq("tag", tag)
          .eq("isDeleted", args.isDeleted)
          .eq("type", type)
          .eq("isFavorited", isFavorited === true ? true : undefined)
          .gte("cardCreatedAt", args.createdAfter ?? Number.MIN_SAFE_INTEGER)
          .lte("cardCreatedAt", args.createdBefore ?? Number.MAX_SAFE_INTEGER)
      )
      .order(args.sort === "oldest" ? "asc" : "desc")
      .take(takeLimit);
  } else if (type !== undefined) {
    tagDocuments = await ctx.db
      .query("cardSearchTags")
      .withIndex("by_user_tag_deleted_type", (range) =>
        range
          .eq("userId", args.userId)
          .eq("tag", tag)
          .eq("isDeleted", args.isDeleted)
          .eq("type", type)
          .gte("cardCreatedAt", args.createdAfter ?? Number.MIN_SAFE_INTEGER)
          .lte("cardCreatedAt", args.createdBefore ?? Number.MAX_SAFE_INTEGER)
      )
      .order(args.sort === "oldest" ? "asc" : "desc")
      .take(takeLimit);
  } else if (isFavorited === undefined) {
    tagDocuments = await ctx.db
      .query("cardSearchTags")
      .withIndex("by_user_tag_deleted_created", (range) =>
        range
          .eq("userId", args.userId)
          .eq("tag", tag)
          .eq("isDeleted", args.isDeleted)
          .gte("cardCreatedAt", args.createdAfter ?? Number.MIN_SAFE_INTEGER)
          .lte("cardCreatedAt", args.createdBefore ?? Number.MAX_SAFE_INTEGER)
      )
      .order(args.sort === "oldest" ? "asc" : "desc")
      .take(takeLimit);
  } else {
    tagDocuments = await ctx.db
      .query("cardSearchTags")
      .withIndex("by_user_tag_deleted_favorited", (range) =>
        range
          .eq("userId", args.userId)
          .eq("tag", tag)
          .eq("isDeleted", args.isDeleted)
          .eq("isFavorited", isFavorited === true ? true : undefined)
          .gte("cardCreatedAt", args.createdAfter ?? Number.MIN_SAFE_INTEGER)
          .lte("cardCreatedAt", args.createdBefore ?? Number.MAX_SAFE_INTEGER)
      )
      .order(args.sort === "oldest" ? "asc" : "desc")
      .take(takeLimit);
  }
  const cards = await Promise.all(
    tagDocuments.map((document) => ctx.db.get("cards", document.cardId))
  );
  return Array.from(
    new Map(
      cards
        .filter((card): card is Doc<"cards"> => card !== null)
        .map((card) => [card._id, card] as const)
    ).values()
  ).filter(args.resultFilter ?? (() => true));
};

export const searchCardsByDocument = async (
  ctx: QueryCtx,
  args: {
    userId: string;
    searchQuery: string;
    isDeleted?: boolean;
    isFavorited?: boolean;
    type?: Doc<"cards">["type"];
    limit: number;
    resultFilter?: (card: Doc<"cards">) => boolean;
  }
): Promise<Doc<"cards">[]> => {
  // Convex permits at most 4,096 documents in a single query result. Grow to
  // that platform bound only when overlap or post-index filters require it.
  const maximumSourceLimit = 4096;
  let sourceLimit = Math.min(100, Math.max(1, args.limit));
  while (true) {
    const derivedDocuments = await ctx.db
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
      .take(sourceLimit);
    const cardsById = new Map<Id<"cards">, Doc<"cards">>();
    const derivedCards = await Promise.all(
      derivedDocuments.map((document) => ctx.db.get("cards", document.cardId))
    );
    for (const card of derivedCards) {
      if (card) {
        cardsById.set(card._id, card);
      }
    }
    const cards = Array.from(cardsById.values()).filter(
      args.resultFilter ?? (() => true)
    );
    const sourceExhausted = derivedDocuments.length < sourceLimit;
    if (
      cards.length >= args.limit ||
      sourceExhausted ||
      sourceLimit >= maximumSourceLimit
    ) {
      return cards;
    }
    sourceLimit = Math.min(sourceLimit * 2, maximumSourceLimit);
  }
};
