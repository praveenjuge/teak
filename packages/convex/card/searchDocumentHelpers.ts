import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { accountDeletionOwnsRows } from "../accountDeletion";
import {
  markCardForEmbedding,
  tombstoneCardEmbedding,
} from "../embedding/state";
import {
  cardFolderRowsMayChange,
  deletedCardMayHaveFolderRows,
  syncCardFolderRows,
} from "../folder/folderRows";
import { normalizeUrlHost } from "../shared/utils/urlHost";
import { markTagSummaryDirty } from "../tag/tagSummary";
import { type ArchivedFilter, archivedFilterMatch } from "./listQuery";
import { deleteCardTextContents } from "./textContents";

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

/**
 * The text a card is found by: its own fields, then, when given, the
 * searchable prefix of text extracted from its file (card/documentText.ts).
 */
export const buildCardSearchText = (
  card: Doc<"cards">,
  extractedText?: string
): string =>
  [
    ...SEARCH_FIELDS.map((field) => card[field]),
    ...(card.tags ?? []),
    ...(card.aiTags ?? []),
    extractedText,
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0
    )
    .join("\n");

export const normalizeCardSearchTag = (tag: string): string =>
  tag.trim().toLowerCase();

export const buildCardSearchTags = (
  card: Pick<Doc<"cards">, "tags" | "aiTags">
): string[] =>
  Array.from(
    new Set(
      [...(card.tags ?? []), ...(card.aiTags ?? [])]
        .map(normalizeCardSearchTag)
        .filter(Boolean)
    )
  ).sort();

export const syncCardSearch = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  userId?: string,
  previousCard?: Doc<"cards">
) => {
  await syncCardSearchDocumentHandler(ctx, cardId, userId, previousCard);
};

export const scheduleCardSearchTagSync = async (
  ctx: Pick<MutationCtx, "scheduler">,
  cardId: Id<"cards">,
  userId?: string,
  generation?: number
) => {
  await ctx.scheduler.runAfter(
    0,
    internalAny["card/searchDocuments"].syncCardSearchTagsBatch,
    { cardId, userId, generation }
  );
};

interface CardSyncSnapshot {
  aiTags?: string[];
  cardCreatedAt: number;
  isArchived?: true;
  isDeleted?: boolean;
  isFavorited?: boolean;
  tags?: string[];
  type: Doc<"cards">["type"];
  userId: string;
}

const cardSyncSnapshotFromCard = (card: Doc<"cards">): CardSyncSnapshot => ({
  userId: card.userId,
  tags: card.tags,
  aiTags: card.aiTags,
  isDeleted: card.isDeleted,
  type: card.type,
  isFavorited: card.isFavorited,
  isArchived: card.isArchived === true ? true : undefined,
  cardCreatedAt: card.createdAt,
});

export type TagSyncSnapshotUpdate =
  | { kind: "record"; card: Doc<"cards"> }
  | { kind: "clear" }
  | { kind: "keep" };

const mayChangeTagCounts = (
  previous: Doc<"cardSearchTagSyncStates">,
  snapshot: TagSyncSnapshotUpdate
): boolean => {
  if (snapshot.kind === "keep") {
    return true;
  }
  if (previous.pending && previous.tagCountsChanged !== false) {
    return true;
  }
  if (snapshot.kind === "clear" || previous.userId === undefined) {
    return true;
  }
  const { card } = snapshot;
  return (
    previous.userId !== card.userId ||
    (previous.isDeleted === true) !== (card.isDeleted === true) ||
    (previous.isArchived === true) !== (card.isArchived === true) ||
    JSON.stringify(buildCardSearchTags(previous)) !==
      JSON.stringify(buildCardSearchTags(card))
  );
};

export const restartCardSearchTagSync = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  sourceUpdatedAt?: number,
  userId?: string,
  snapshotUpdate: TagSyncSnapshotUpdate = { kind: "keep" }
) => {
  let snapshot: Partial<CardSyncSnapshot> = {};
  if (snapshotUpdate.kind === "clear") {
    snapshot = {
      userId,
      tags: undefined,
      aiTags: undefined,
      isDeleted: undefined,
      type: undefined,
      isFavorited: undefined,
      isArchived: undefined,
      cardCreatedAt: undefined,
    };
  } else if (snapshotUpdate.kind === "record") {
    snapshot = cardSyncSnapshotFromCard(snapshotUpdate.card);
  }
  const existingState = await ctx.db
    .query("cardSearchTagSyncStates")
    .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
    .unique();
  if (existingState) {
    const generation = existingState.generation + 1;
    await ctx.db.patch("cardSearchTagSyncStates", existingState._id, {
      generation,
      offset: 0,
      pending: true,
      phase: "tags",
      sourceUpdatedAt,
      ...snapshot,
      tagCountsChanged: mayChangeTagCounts(existingState, snapshotUpdate),
    });
    await scheduleCardSearchTagSync(ctx, cardId, userId, generation);
  } else {
    await ctx.db.insert("cardSearchTagSyncStates", {
      cardId,
      generation: 1,
      offset: 0,
      pending: true,
      phase: "tags",
      sourceUpdatedAt,
      ...snapshot,
    });
    await scheduleCardSearchTagSync(ctx, cardId, userId, 1);
  }
};

/**
 * A card write with `urlHost` kept beside a changed `url`, so the site
 * lands in the same write (the search sync repairs any write without it).
 */
export const withUrlHost = <T extends object>(value: T): T => {
  if (!("url" in value)) {
    return value;
  }
  const { url } = value as { url?: unknown };
  return {
    ...value,
    urlHost:
      normalizeUrlHost(typeof url === "string" ? url : undefined) ?? undefined,
  };
};

/** False when account deletion owns the card's rows and nothing was written. */
export const patchCardWithSearchSync = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  value: Partial<Omit<Doc<"cards">, "_creationTime" | "_id">>
) => {
  const card = await ctx.db.get("cards", cardId);
  if (await accountDeletionOwnsRows(ctx, card?.userId)) {
    return false;
  }
  await ctx.db.patch("cards", cardId, withUrlHost(value));
  const searchableFields = [
    ...SEARCH_FIELDS,
    "tags",
    "aiTags",
    "userId",
    "type",
    "isDeleted",
    "isFavorited",
    "isArchived",
    "createdAt",
    "folderIds",
    "url",
  ];
  if (searchableFields.some((field) => Object.keys(value).includes(field))) {
    await syncCardSearch(ctx, cardId, undefined, card ?? undefined);
  }
  return true;
};

export const syncCardSearchDocumentHandler = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  userId?: string,
  previousCard?: Doc<"cards">
) => {
  const [card, existing] = await Promise.all([
    ctx.db.get("cards", cardId),
    ctx.db
      .query("cardSearchDocuments")
      .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
      .unique(),
  ]);

  const ownerId = card?.userId ?? existing?.userId ?? userId;
  if (await accountDeletionOwnsRows(ctx, ownerId)) {
    return null;
  }

  if (!card) {
    if (existing) {
      await ctx.db.delete("cardSearchDocuments", existing._id);
    }
    if (!previousCard || previousCard.hasExtractedText) {
      await deleteCardTextContents(ctx, cardId);
    }
    if (deletedCardMayHaveFolderRows(previousCard)) {
      await syncCardFolderRows(ctx, cardId, null);
    }
    await restartCardSearchTagSync(ctx, cardId, undefined, ownerId, {
      kind: "clear",
    });
    await tombstoneCardEmbedding(ctx, cardId);
    return null;
  }

  if (cardFolderRowsMayChange(previousCard, card)) {
    await syncCardFolderRows(ctx, cardId, card);
  }

  const urlHost = normalizeUrlHost(card.url) ?? undefined;
  if (card.urlHost !== urlHost) {
    await ctx.db.patch("cards", cardId, { urlHost });
  }

  const value = {
    cardId,
    userId: card.userId,
    searchableText: buildCardSearchText(card),
    isDeleted: card.isDeleted,
    type: card.type,
    isFavorited: card.isFavorited,
    isArchived: card.isArchived === true ? (true as const) : undefined,
    urlHost,
    sourceUpdatedAt: card.updatedAt,
  };
  if (existing) {
    if (
      existing.userId !== value.userId ||
      existing.searchableText !== value.searchableText ||
      existing.isDeleted !== value.isDeleted ||
      existing.type !== value.type ||
      existing.isFavorited !== value.isFavorited ||
      existing.isArchived !== value.isArchived ||
      existing.urlHost !== value.urlHost
    ) {
      await ctx.db.replace("cardSearchDocuments", existing._id, value);
    }
  } else {
    await ctx.db.insert("cardSearchDocuments", value);
  }
  // A vector carries its card's type, which `mood:` filters on.
  if (
    existing?.searchableText !== value.searchableText ||
    existing.type !== value.type
  ) {
    await markCardForEmbedding(ctx, cardId, card.userId);
  }

  const currentTags = JSON.stringify(buildCardSearchTags(card));
  // An edit that changes no tag-sync field skips the tag-sync state: even
  // reading that row puts it in the caller's OCC set and races the running
  // tag chain.
  if (
    existing &&
    previousCard &&
    previousCard.userId === card.userId &&
    previousCard.type === card.type &&
    (previousCard.isDeleted === true) === (card.isDeleted === true) &&
    (previousCard.isFavorited === true) === (card.isFavorited === true) &&
    (previousCard.isArchived === true) === (card.isArchived === true) &&
    previousCard.createdAt === card.createdAt &&
    currentTags === JSON.stringify(buildCardSearchTags(previousCard))
  ) {
    return null;
  }

  // Text changes do not require rewriting every exact-tag row. The snapshot
  // also repairs older states that predate snapshot-based synchronization.
  const tagState = await ctx.db
    .query("cardSearchTagSyncStates")
    .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
    .unique();
  const tagsChanged =
    !tagState ||
    tagState.userId !== card.userId ||
    tagState.type !== card.type ||
    (tagState.isDeleted === true) !== (card.isDeleted === true) ||
    (tagState.isFavorited === true) !== (card.isFavorited === true) ||
    (tagState.isArchived === true) !== (card.isArchived === true) ||
    tagState.cardCreatedAt !== card.createdAt ||
    JSON.stringify(buildCardSearchTags(tagState)) !== currentTags;
  if (tagsChanged) {
    await restartCardSearchTagSync(ctx, cardId, card.updatedAt, card.userId, {
      kind: "record",
      card,
    });
  }
  return null;
};

interface CardSyncSource {
  aiTags?: string[];
  createdAt: number;
  isArchived?: true;
  isDeleted?: boolean;
  isFavorited?: boolean;
  tags?: string[];
  type: Doc<"cards">["type"];
  updatedAt: number;
  userId: string;
}

const cardSyncSourceFromState = (
  state: Doc<"cardSearchTagSyncStates">
): CardSyncSource | null => {
  if (
    state.cardCreatedAt === undefined ||
    state.type === undefined ||
    state.userId === undefined ||
    state.sourceUpdatedAt === undefined
  ) {
    return null;
  }
  return {
    userId: state.userId,
    tags: state.tags,
    aiTags: state.aiTags,
    isDeleted: state.isDeleted,
    type: state.type,
    isFavorited: state.isFavorited,
    isArchived: state.isArchived,
    createdAt: state.cardCreatedAt,
    updatedAt: state.sourceUpdatedAt,
  };
};

/**
 * Every restart schedules the tag sync with a new generation, so an invocation
 * scheduled before the latest restart is stale. So is one whose state row was
 * pruned after scheduling (deleted card or account deletion): recreating a
 * generation-1 row would fence its continuation against its own row forever.
 */
export const isStaleTagSyncInvocation = (
  state: Pick<Doc<"cardSearchTagSyncStates">, "generation"> | null,
  generation: number | undefined
): boolean =>
  generation !== undefined && (!state || state.generation !== generation);

export const syncCardSearchTagsBatchHandler = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  userId?: string,
  generation?: number
) => {
  let state = await ctx.db
    .query("cardSearchTagSyncStates")
    .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
    .unique();

  if (isStaleTagSyncInvocation(state, generation)) {
    return { complete: true, processed: 0, writes: 0 };
  }

  // Sync from the snapshot recorded on the state row when one exists, so the
  // hot path never reads the cards table and cannot conflict with concurrent
  // card writes; rows written before snapshots existed fall back to reading
  // the card.
  let card: CardSyncSource | null = state
    ? cardSyncSourceFromState(state)
    : null;
  if (!card) {
    card = await ctx.db.get("cards", cardId);
  }

  // The card row, its sync state, and its tag rows are removed atomically by
  // the deletion batch, so a missing card with leftover rows means the batch
  // has not reached this card yet and the owner can still be resolved.
  let ownerId = card?.userId ?? state?.userId;
  if (!ownerId) {
    const searchDocument = await ctx.db
      .query("cardSearchDocuments")
      .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
      .unique();
    ownerId = searchDocument?.userId;
  }
  if (!ownerId) {
    const leftoverTag = (
      await ctx.db
        .query("cardSearchTags")
        .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
        .take(1)
    )[0];
    ownerId = leftoverTag?.userId;
  }
  ownerId = ownerId ?? userId;
  if (await accountDeletionOwnsRows(ctx, ownerId)) {
    return { complete: true, processed: 0, writes: 0 };
  }

  if (!state) {
    const stateId = await ctx.db.insert("cardSearchTagSyncStates", {
      cardId,
      generation: 1,
      offset: 0,
      pending: true,
      phase: "tags",
      sourceUpdatedAt: card?.updatedAt,
      ...(card
        ? {
            userId: card.userId,
            tags: card.tags,
            aiTags: card.aiTags,
            isDeleted: card.isDeleted,
            type: card.type,
            isFavorited: card.isFavorited,
            isArchived: card.isArchived === true ? true : undefined,
            cardCreatedAt: card.createdAt,
          }
        : {}),
    });
    state = await ctx.db.get("cardSearchTagSyncStates", stateId);
  }

  if (!state) {
    throw new Error("Failed to initialize card search tag synchronization");
  }
  if (state.phase === "complete") {
    return { complete: true, processed: 0, writes: 0 };
  }

  const chainGeneration = generation ?? state.generation;

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
      await scheduleCardSearchTagSync(ctx, cardId, ownerId, chainGeneration);
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
    if (ownerId && state.tagCountsChanged !== false) {
      await markTagSummaryDirty(ctx, ownerId);
    }
    return { complete: true, processed: oldTags.length, writes };
  }

  if (!card) {
    await ctx.db.patch("cardSearchTagSyncStates", state._id, {
      offset: 0,
      phase: "pruneOld",
    });
    await scheduleCardSearchTagSync(ctx, cardId, ownerId, chainGeneration);
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
      isArchived: card.isArchived === true ? (true as const) : undefined,
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
        existingTag.isArchived !== tagValue.isArchived ||
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
    await scheduleCardSearchTagSync(ctx, cardId, ownerId, chainGeneration);
    return { complete: false, processed: sourceSlice.length, writes };
  }
  if (state.phase === "tags") {
    await ctx.db.patch("cardSearchTagSyncStates", state._id, {
      offset: 0,
      phase: "aiTags",
    });
    await scheduleCardSearchTagSync(ctx, cardId, ownerId, chainGeneration);
    return { complete: false, processed: sourceSlice.length, writes };
  }
  await ctx.db.patch("cardSearchTagSyncStates", state._id, {
    offset: 0,
    phase: "pruneOld",
  });
  await scheduleCardSearchTagSync(ctx, cardId, ownerId, chainGeneration);
  return { complete: false, processed: sourceSlice.length, writes };
};

export const searchCardsByExactTag = async (
  ctx: QueryCtx,
  args: {
    userId: string;
    tag: string;
    isDeleted?: boolean;
    isFavorited?: boolean;
    /** Archived cards to match outside Trash; defaults to `"exclude"`. */
    archived?: ArchivedFilter;
    type?: Doc<"cards">["type"];
    createdAfter?: number;
    createdBefore?: number;
    limit: number;
    scanBudget?: { remaining: number; hitSearchLimit?: boolean };
    sort: "newest" | "oldest";
    resultFilter?: (card: Doc<"cards">) => boolean;
  }
): Promise<Doc<"cards">[]> => {
  const tag = normalizeCardSearchTag(args.tag);
  if (!tag) {
    return [];
  }
  const { isFavorited, type } = args;
  const favorited = isFavorited === true ? true : undefined;
  const archived = archivedFilterMatch(args.archived, args.isDeleted === true);
  const matchLimit = Math.min(4096, Math.max(1, args.limit));
  const order = args.sort === "oldest" ? "asc" : "desc";
  const createdBetween = (range: any) =>
    range
      .gte("cardCreatedAt", args.createdAfter ?? Number.MIN_SAFE_INTEGER)
      .lte("cardCreatedAt", args.createdBefore ?? Number.MAX_SAFE_INTEGER);
  const tags = ctx.db.query("cardSearchTags");
  let tagQuery: AsyncIterable<Doc<"cardSearchTags">>;
  if (archived === "any") {
    tagQuery = tags
      .withIndex("by_user_tag_deleted_created", (range) =>
        createdBetween(
          range
            .eq("userId", args.userId)
            .eq("tag", tag)
            .eq("isDeleted", args.isDeleted)
        )
      )
      .order(order);
  } else {
    const base = (range: any) =>
      range
        .eq("userId", args.userId)
        .eq("tag", tag)
        .eq("isDeleted", args.isDeleted)
        .eq("isArchived", archived);
    if (type !== undefined && isFavorited !== undefined) {
      tagQuery = tags
        .withIndex("by_user_tag_deleted_archived_type_favorited_v2", (range) =>
          createdBetween(
            base(range).eq("type", type).eq("isFavorited", favorited)
          )
        )
        .order(order);
    } else if (type !== undefined) {
      tagQuery = tags
        .withIndex("by_user_tag_deleted_archived_type_v2", (range) =>
          createdBetween(base(range).eq("type", type))
        )
        .order(order);
    } else if (isFavorited === undefined) {
      tagQuery = tags
        .withIndex("by_user_tag_deleted_archived_created_v2", (range) =>
          createdBetween(base(range))
        )
        .order(order);
    } else {
      tagQuery = tags
        .withIndex("by_user_tag_deleted_archived_favorited_v2", (range) =>
          createdBetween(base(range).eq("isFavorited", favorited))
        )
        .order(order);
    }
  }
  const cardsById = new Map<Id<"cards">, Doc<"cards">>();
  const scanBudget = args.scanBudget ?? { remaining: 4096 };
  for await (const document of tagQuery) {
    if (scanBudget.remaining <= 0) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Search is too broad. Add a type or date filter.",
      });
    }
    scanBudget.remaining -= 1;
    if (
      archived === "any" &&
      ((type !== undefined && document.type !== type) ||
        (isFavorited !== undefined &&
          (document.isFavorited === true) !== isFavorited))
    ) {
      continue;
    }
    const card = await ctx.db.get("cards", document.cardId);
    if (card && (!args.resultFilter || args.resultFilter(card))) {
      cardsById.set(card._id, card);
      if (cardsById.size >= matchLimit) {
        break;
      }
    }
  }
  return Array.from(cardsById.values());
};

export const searchCardsByDocument = async (
  ctx: QueryCtx,
  args: {
    userId: string;
    searchQuery: string;
    isDeleted?: boolean;
    isFavorited?: boolean;
    /** Archived cards to match outside Trash; defaults to `"exclude"`. */
    archived?: ArchivedFilter;
    type?: Doc<"cards">["type"];
    /** Only cards on this normalized host (`site:`). */
    urlHost?: string;
    limit: number;
    scanBudget?: {
      remaining: number;
      hitSearchLimit?: boolean;
      /** File-text rows left to read (FILE_TEXT_SEARCH_LIMIT to start). */
      textRemaining?: number;
    };
    /**
     * Keeps a card; gets the card's search text too, with its file text
     * when that is what matched (quoted phrases check it).
     */
    resultFilter?: (card: Doc<"cards">, searchableText: string) => boolean;
    /** Filled with each kept card's search text, for filtering later. */
    searchTexts?: Map<Id<"cards">, string>;
  }
): Promise<Doc<"cards">[]> => {
  const archived = archivedFilterMatch(args.archived, args.isDeleted === true);
  const scanBudget = args.scanBudget ?? { remaining: 4096 };
  const cardsById = new Map<Id<"cards">, Doc<"cards">>();
  const matchLimit = Math.min(1024, Math.max(1, args.limit));
  const sourceLimit = Math.min(1024, scanBudget.remaining);
  if (sourceLimit <= 0) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Search is too broad. Add a type or date filter.",
    });
  }
  const documents = await ctx.db
    .query("cardSearchDocuments")
    .withSearchIndex("search_searchableText", (query) => {
      let filtered = query
        .search("searchableText", args.searchQuery)
        .eq("userId", args.userId)
        .eq("isDeleted", args.isDeleted);
      if (archived !== "any") {
        filtered = filtered.eq("isArchived", archived);
      }
      if (args.type !== undefined) {
        filtered = filtered.eq("type", args.type);
      }
      if (args.isFavorited !== undefined) {
        filtered = filtered.eq(
          "isFavorited",
          args.isFavorited ? true : undefined
        );
      }
      if (args.urlHost !== undefined) {
        filtered = filtered.eq("urlHost", args.urlHost);
      }
      return filtered;
    })
    .take(sourceLimit);
  scanBudget.remaining -= documents.length;
  if (documents.length === sourceLimit) {
    scanBudget.hitSearchLimit = true;
  }
  for (const document of documents) {
    const card = await ctx.db.get("cards", document.cardId);
    if (
      card &&
      (!args.resultFilter || args.resultFilter(card, document.searchableText))
    ) {
      cardsById.set(card._id, card);
      args.searchTexts?.set(card._id, document.searchableText);
      if (cardsById.size >= matchLimit) {
        break;
      }
    }
  }
  // Convex checks its 1,024-result cap before probing exhaustion, so a
  // saturated search cannot prove that all post-filter matches were examined.
  if (documents.length === sourceLimit && cardsById.size < matchLimit) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Search is too broad. Add a type or date filter.",
    });
  }
  if (cardsById.size < matchLimit) {
    await addCardsFoundByFileText(ctx, args, archived, scanBudget, {
      cardsById,
      matchLimit,
    });
  }
  return Array.from(cardsById.values());
};

/**
 * A search's meaning matches that belong in its results, in ranking order:
 * the user's cards that pass the keyword side's index filters and `keep`.
 * `cardsById` holds the keyword matches; a match with a score under
 * `minScore` counts only when it is one of them, so weak matches are never
 * read. Cards read here are added to `cardsById`.
 */
export const loadSemanticMatches = async (
  ctx: QueryCtx,
  args: Pick<
    Parameters<typeof searchCardsByDocument>[1],
    "userId" | "isDeleted" | "isFavorited" | "archived" | "type" | "urlHost"
  >,
  ranking: readonly { cardId: Id<"cards">; score: number }[],
  cardsById: Map<Id<"cards">, Doc<"cards">>,
  options: { minScore: number; keep: (card: Doc<"cards">) => boolean }
): Promise<{ cardId: Id<"cards">; score: number }[]> => {
  const archived = archivedFilterMatch(args.archived, args.isDeleted === true);
  const kept: { cardId: Id<"cards">; score: number }[] = [];
  for (const match of ranking) {
    if (cardsById.has(match.cardId)) {
      kept.push(match);
      continue;
    }
    if (match.score < options.minScore) {
      continue;
    }
    const card = await ctx.db.get("cards", match.cardId);
    if (
      card &&
      card.userId === args.userId &&
      matchesSearchIndexFilters(card, args, archived) &&
      options.keep(card)
    ) {
      cardsById.set(card._id, card);
      kept.push(match);
    }
  }
  return kept;
};

/**
 * Text rows one search request reads, across all its calls. A row holds up
 * to 32 KiB, so a search stays far inside a transaction's read limit
 * however many files match; past it, only the closest matches are found.
 */
export const FILE_TEXT_SEARCH_LIMIT = 128;

const addCardsFoundByFileText = async (
  ctx: QueryCtx,
  args: Parameters<typeof searchCardsByDocument>[1],
  archived: true | undefined | "any",
  scanBudget: { textRemaining?: number },
  found: { cardsById: Map<Id<"cards">, Doc<"cards">>; matchLimit: number }
) => {
  if (args.type !== undefined && args.type !== "document") {
    return;
  }
  const textLimit = scanBudget.textRemaining ?? FILE_TEXT_SEARCH_LIMIT;
  if (textLimit <= 0) {
    return;
  }
  const rows = await ctx.db
    .query("cardTextContents")
    .withSearchIndex("search_text", (query) =>
      query.search("text", args.searchQuery).eq("userId", args.userId)
    )
    .take(textLimit);
  scanBudget.textRemaining = textLimit - rows.length;
  for (const row of rows) {
    if (found.cardsById.has(row.cardId)) {
      continue;
    }
    const card = await ctx.db.get("cards", row.cardId);
    if (!(card && card.userId === args.userId)) {
      continue;
    }
    const searchableText = buildCardSearchText(card, row.text);
    if (
      matchesSearchIndexFilters(card, args, archived) &&
      (!args.resultFilter || args.resultFilter(card, searchableText))
    ) {
      found.cardsById.set(card._id, card);
      args.searchTexts?.set(card._id, searchableText);
      if (found.cardsById.size >= found.matchLimit) {
        break;
      }
    }
  }
};

const matchesSearchIndexFilters = (
  card: Doc<"cards">,
  args: Pick<
    Parameters<typeof searchCardsByDocument>[1],
    "isDeleted" | "isFavorited" | "type" | "urlHost"
  >,
  archived: true | undefined | "any"
): boolean =>
  card.isDeleted === args.isDeleted &&
  (archived === "any" ||
    (card.isArchived === true ? true : undefined) === archived) &&
  (args.type === undefined || card.type === args.type) &&
  (args.isFavorited === undefined ||
    card.isFavorited === (args.isFavorited ? true : undefined)) &&
  (args.urlHost === undefined ||
    (normalizeUrlHost(card.url) ?? undefined) === args.urlHost);
