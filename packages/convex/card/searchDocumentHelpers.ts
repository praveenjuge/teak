import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getAccountDeletionState } from "../accountDeletion";

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

// Runs the card's search sync inline in the caller's mutation: the search
// document write (and tag-sync restart when its snapshot changed) is
// atomic with the card write that triggered it. This replaces the old
// runAfter(0) fan-out, under which a burst of patches to one card queued
// duplicate sync invocations that all wrote the same cardSearchDocuments and
// cardSearchTagSyncStates rows - the syncCardSearchDocument write-conflict
// retries seen in production. The tag chain itself still runs asynchronously
// and stays generation-fenced.
export const scheduleCardSearchSync = async (
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

// Card fields the tag sync needs, snapshotted onto the sync-state row by
// restarts. Batch invocations sync from the snapshot instead of reading the
// cards table, which removes the write-conflict window between a running
// sync chain and concurrent card writes (AI metadata, edits, deletes).
interface CardSyncSnapshot {
  aiTags?: string[];
  cardCreatedAt: number;
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
  cardCreatedAt: card.createdAt,
});

// card is the card document at restart time: provided to record a snapshot,
// null when the card is gone (clears the snapshot so the batch takes the
// deleted-card path), or omitted to leave any existing snapshot untouched.
export const restartCardSearchTagSync = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  sourceUpdatedAt?: number,
  userId?: string,
  card?: Doc<"cards"> | null
) => {
  let snapshot: Partial<CardSyncSnapshot> = {};
  if (card === null) {
    snapshot = {
      userId,
      tags: undefined,
      aiTags: undefined,
      isDeleted: undefined,
      type: undefined,
      isFavorited: undefined,
      cardCreatedAt: undefined,
    };
  } else if (card !== undefined) {
    snapshot = cardSyncSnapshotFromCard(card);
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

export const patchCardWithSearchSync = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  value: Partial<Omit<Doc<"cards">, "_creationTime" | "_id">>
) => {
  // While an account deletion runs, its batches delete every card the user
  // owns, and any concurrent card patch races them: Convex conflicts on
  // documents read from OR written to, so the deletion batch retries until
  // it exhausts and fails the whole deletion. Production evidence: a
  // deleteAccountDataBatch run failed permanently after repeatedly
  // conflicting with updateCardAI on a cards row. Card writers stand down,
  // mirroring the search-sync stand-down below; a missing card keeps the
  // previous behavior of letting db.patch throw.
  // Returns false so callers can tell the patch was skipped and hold back
  // follow-up work (for example screenshot scheduling) until deletion
  // finishes.
  const card = await ctx.db.get("cards", cardId);
  if (card && (await getAccountDeletionState(ctx, card.userId))) {
    return false;
  }
  await ctx.db.patch("cards", cardId, value);
  const searchableFields = [
    ...SEARCH_FIELDS,
    "tags",
    "aiTags",
    "userId",
    "type",
    "isDeleted",
    "isFavorited",
    "createdAt",
  ];
  if (searchableFields.some((field) => Object.keys(value).includes(field))) {
    await scheduleCardSearchSync(
      ctx,
      cardId,
      undefined,
      card ?? undefined
    );
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

  // While an account deletion is in progress the deletion batches own
  // cleanup of the search tables for that user's cards. Writing here would
  // race those batches with optimistic concurrency conflicts, so stand down.
  const ownerId = card?.userId ?? existing?.userId ?? userId;
  if (ownerId && (await getAccountDeletionState(ctx, ownerId))) {
    return null;
  }

  if (!card) {
    if (existing) {
      await ctx.db.delete("cardSearchDocuments", existing._id);
    }
    await restartCardSearchTagSync(ctx, cardId, undefined, ownerId, null);
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
    if (
      existing.userId !== value.userId ||
      existing.searchableText !== value.searchableText ||
      existing.isDeleted !== value.isDeleted ||
      existing.type !== value.type ||
      existing.isFavorited !== value.isFavorited
    ) {
      await ctx.db.replace("cardSearchDocuments", existing._id, value);
    }
  } else {
    await ctx.db.insert("cardSearchDocuments", value);
  }

  const currentTags = JSON.stringify(buildCardSearchTags(card));
  // A caller-provided pre-patch card proves an ordinary text-only edit
  // cannot invalidate the exact-tag snapshot. Avoid reading the mutable
  // batch progress row in that case: even a read-only lookup puts it into
  // the caller's OCC set and races the running tag chain. A missing search
  // document, direct sync invocation, or tag/filter change still takes the
  // repair path below. Invariant: every sync that creates a search document
  // also writes its tag-sync state, so an existing document implies a state
  // row; legacy rows are repaired by any direct sync or tag change.
  if (
    existing &&
    previousCard &&
    previousCard.userId === card.userId &&
    previousCard.type === card.type &&
    (previousCard.isDeleted === true) === (card.isDeleted === true) &&
    (previousCard.isFavorited === true) === (card.isFavorited === true) &&
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
    tagState.cardCreatedAt !== card.createdAt ||
    JSON.stringify(buildCardSearchTags(tagState)) !== currentTags;
  if (tagsChanged) {
    await restartCardSearchTagSync(
      ctx,
      cardId,
      card.updatedAt,
      card.userId,
      card
    );
  }
  return null;
};

// The view the batch handler syncs from: either the state-row snapshot or a
// card document, both normalized to the card's field names.
interface CardSyncSource {
  aiTags?: string[];
  createdAt: number;
  isDeleted?: boolean;
  isFavorited?: boolean;
  tags?: string[];
  type: Doc<"cards">["type"];
  updatedAt: number;
  userId: string;
}

// A state row carries a usable snapshot only when every field the tag writes
// depend on is present; partial rows fall back to reading the card.
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
    createdAt: state.cardCreatedAt,
    updatedAt: state.sourceUpdatedAt,
  };
};

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

  // Generation fencing: every restart schedules the batch with the new
  // generation, so an invocation scheduled before the latest restart is
  // stale. A missing state row with a generation argument means the row was
  // pruned after scheduling (deleted card or account deletion), so that
  // invocation is stale too - recreating a generation-1 row here would
  // leave its continuation fenced against its own row forever. Exit after
  // this single-row read instead of adding more writes to the state row -
  // the current generation's invocation does the work.
  if (generation !== undefined && (!state || state.generation !== generation)) {
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

  // While an account deletion is in progress the deletion batches own
  // cleanup of the search tables for that user's cards. Writing here would
  // race those batches with optimistic concurrency conflicts, so stand down.
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
  if (ownerId && (await getAccountDeletionState(ctx, ownerId))) {
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

  // Steps this chain schedules for itself stay fenced to the same generation.
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
