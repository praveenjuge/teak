import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { accountDeletionOwnsRows } from "../accountDeletion";
import { cardNeedsAiMetadata } from "../ai/queries";
import {
  markCardForEmbedding,
  tombstoneCardEmbedding,
} from "../embedding/state";
import {
  cardFolderRowsMayChange,
  deletedCardMayHaveFolderRows,
  syncCardFolderRows,
} from "../folder/folderRows";
import { deleteCardHighlightRows } from "../highlight/highlightRows";
import { cardLinkTokensToText } from "../shared/cardLinks";
import { isHiddenTagList } from "../shared/tags";
import { cardSiteHost } from "../shared/utils/urlHost";
import { urlKey } from "../shared/utils/urlKey";
import {
  addTagCountDelta,
  isCountedTagRow,
  markTagSummaryDirty,
  recordTagCountDeltas,
  type TagCountDeltas,
} from "../tag/tagSummary";
import {
  cardLinksMayChange,
  scheduleCardLinkSync,
  scheduleDeletedCardLinkCleanup,
} from "./cardLinks";
import { withHiddenFlag } from "./hiddenCards";
import { deleteLinkCheckRows } from "./linkCheckRows";
import {
  deleteLinkedPdfRowsAsDocument,
  deleteLinkedPdfRowsAsLink,
} from "./linkedPdfRows";
import { deleteCardTextRows, readCardTranscript } from "./textContents";

export const CARD_SEARCH_TAG_SYNC_BATCH_SIZE = 32;

const SEARCH_FIELDS = [
  "content",
  "notes",
  "aiSummary",
  "aiTranscript",
  "aiOcrText",
  "metadataTitle",
  "metadataDescription",
] as const;

export const buildCardSearchText = (
  card: Doc<"cards">,
  extractedText?: string,
  transcript?: string
): string =>
  [
    ...SEARCH_FIELDS.map((field) => {
      // A `[[Title|teak:<id>]]` link is searchable by its title, not its id.
      if (field === "content" && card.content) {
        return cardLinkTokensToText(card.content);
      }
      return field === "aiTranscript" ? transcript : card[field];
    }),
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
    internal["card/searchDocuments"].syncCardSearchTagsBatch,
    { cardId, userId, generation }
  );
};

interface CardSyncSnapshot {
  aiTags?: string[];
  cardCreatedAt: number;
  cardSavedAt: number;
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
  cardSavedAt: card.savedAt ?? card.createdAt,
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
      cardSavedAt: undefined,
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
    // The rows of an unchanged tag set stay in their generation, so a flag
    // change patches them in place and leaves nothing to prune.
    const keepsTagRows =
      snapshotUpdate.kind === "record" &&
      existingState.userId !== undefined &&
      existingState.userId === snapshotUpdate.card.userId &&
      JSON.stringify(buildCardSearchTags(existingState)) ===
        JSON.stringify(buildCardSearchTags(snapshotUpdate.card));
    await ctx.db.patch("cardSearchTagSyncStates", existingState._id, {
      generation,
      offset: 0,
      pending: true,
      phase: "tags",
      sourceUpdatedAt,
      ...snapshot,
      tagCountsChanged: mayChangeTagCounts(existingState, snapshotUpdate),
      tagGeneration: keepsTagRows
        ? (existingState.tagGeneration ?? existingState.generation)
        : generation,
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
      tagGeneration: 1,
    });
    await scheduleCardSearchTagSync(ctx, cardId, userId, 1);
  }
};

/**
 * A card write with `urlHost` kept beside a changed `url` or `sourceUrl`, and
 * `urlKey` beside a changed `url`, so both land in the same write. A write
 * that clears `url` without naming `sourceUrl` drops the host; the search
 * sync then restores it from the card's `sourceUrl`.
 */
export const withUrlFields = <T extends object>(value: T): T => {
  if (!("url" in value || "sourceUrl" in value)) {
    return value;
  }
  const { sourceUrl, url } = value as { sourceUrl?: unknown; url?: unknown };
  return {
    ...value,
    urlHost:
      cardSiteHost({
        sourceUrl: typeof sourceUrl === "string" ? sourceUrl : undefined,
        url: typeof url === "string" ? url : undefined,
      }) ?? undefined,
    ...("url" in value
      ? { urlKey: typeof url === "string" ? urlKey(url) : undefined }
      : {}),
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
  await ctx.db.patch("cards", cardId, withHiddenFlag(withUrlFields(value)));
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
    "savedAt",
    "folderIds",
    "url",
    "sourceUrl",
    "aiTranscriptCharCount",
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
    if (
      !previousCard ||
      previousCard.hasExtractedText ||
      previousCard.aiTranscriptCharCount !== undefined
    ) {
      await deleteCardTextRows(ctx, cardId);
    }
    if (!previousCard || previousCard.type === "link") {
      await deleteLinkedPdfRowsAsLink(ctx, cardId);
      await deleteLinkCheckRows(ctx, cardId);
    }
    if (!previousCard || previousCard.hasHighlights) {
      await deleteCardHighlightRows(ctx, cardId);
    }
    if (!previousCard || previousCard.type === "document") {
      await deleteLinkedPdfRowsAsDocument(ctx, cardId);
    }
    if (deletedCardMayHaveFolderRows(previousCard)) {
      await syncCardFolderRows(ctx, cardId, null);
    }
    await scheduleDeletedCardLinkCleanup(ctx, cardId);
    await restartCardSearchTagSync(ctx, cardId, undefined, ownerId, {
      kind: "clear",
    });
    await tombstoneCardEmbedding(ctx, cardId);
    return null;
  }

  if (cardFolderRowsMayChange(previousCard, card)) {
    await syncCardFolderRows(ctx, cardId, card);
  }
  if (cardLinksMayChange(previousCard, card)) {
    await scheduleCardLinkSync(ctx, cardId);
  }

  const urlHost = cardSiteHost(card) ?? undefined;
  const cardUrlKey = card.url ? urlKey(card.url) : undefined;
  const isHidden = isHiddenTagList(card.tags) ? (true as const) : undefined;
  const aiPending = cardNeedsAiMetadata(card) ? (true as const) : undefined;
  if (
    card.urlHost !== urlHost ||
    card.urlKey !== cardUrlKey ||
    card.isHidden !== isHidden ||
    card.aiPending !== aiPending
  ) {
    await ctx.db.patch("cards", cardId, {
      urlHost,
      urlKey: cardUrlKey,
      isHidden,
      aiPending,
    });
  }
  const cardSavedAt = card.savedAt ?? card.createdAt;

  const value = {
    cardId,
    userId: card.userId,
    searchableText: buildCardSearchText(
      card,
      undefined,
      await readCardTranscript(ctx, card)
    ),
    ocrText: card.aiOcrText,
    isDeleted: card.isDeleted,
    type: card.type,
    isFavorited: card.isFavorited,
    isArchived: card.isArchived === true ? (true as const) : undefined,
    isHidden,
    urlHost,
    sourceUpdatedAt: card.updatedAt,
    cardCreatedAt: card.createdAt,
    cardSavedAt,
    cardCreationTime: card._creationTime,
  };
  if (existing) {
    if (
      existing.cardCreatedAt !== value.cardCreatedAt ||
      existing.cardSavedAt !== value.cardSavedAt ||
      existing.cardCreationTime !== value.cardCreationTime ||
      existing.userId !== value.userId ||
      existing.searchableText !== value.searchableText ||
      existing.ocrText !== value.ocrText ||
      existing.isDeleted !== value.isDeleted ||
      existing.type !== value.type ||
      existing.isFavorited !== value.isFavorited ||
      existing.isArchived !== value.isArchived ||
      existing.isHidden !== value.isHidden ||
      existing.urlHost !== value.urlHost
    ) {
      await ctx.db.replace("cardSearchDocuments", existing._id, value);
    }
  } else {
    await ctx.db.insert("cardSearchDocuments", value);
  }
  if (
    existing?.searchableText !== value.searchableText ||
    existing.type !== value.type
  ) {
    await markCardForEmbedding(ctx, cardId, card.userId);
  }

  const currentTags = JSON.stringify(buildCardSearchTags(card));
  // Even reading the tag-sync state row puts it in this transaction's OCC
  // read set, where it races the running tag chain.
  if (
    existing &&
    previousCard &&
    previousCard.userId === card.userId &&
    previousCard.type === card.type &&
    (previousCard.isDeleted === true) === (card.isDeleted === true) &&
    (previousCard.isFavorited === true) === (card.isFavorited === true) &&
    (previousCard.isArchived === true) === (card.isArchived === true) &&
    previousCard.createdAt === card.createdAt &&
    previousCard.savedAt === card.savedAt &&
    currentTags === JSON.stringify(buildCardSearchTags(previousCard))
  ) {
    return null;
  }

  // The snapshot also repairs states written before snapshot-based sync.
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
    // A state from before `cardSavedAt` existed holds the card's date only
    // in `cardCreatedAt`, which is right until the card is saved again.
    (tagState.cardSavedAt ?? tagState.cardCreatedAt) !== cardSavedAt ||
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
  savedAt?: number;
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
    savedAt: state.cardSavedAt ?? state.cardCreatedAt,
    updatedAt: state.sourceUpdatedAt,
  };
};

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

  // The state row's snapshot keeps the cards table out of this transaction's
  // read set; rows written before snapshots existed fall back to the card.
  let card: CardSyncSource | null = state
    ? cardSyncSourceFromState(state)
    : null;
  if (!card) {
    card = await ctx.db.get("cards", cardId);
  }

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
        .withIndex("by_cardId_and_tag", (query) => query.eq("cardId", cardId))
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
            cardSavedAt: card.savedAt ?? card.createdAt,
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
  const tagGeneration = state.tagGeneration ?? state.generation;
  const chainState = state;
  const stateId = state._id;
  const countDeltas: TagCountDeltas = new Map();
  let budget = CARD_SEARCH_TAG_SYNC_BATCH_SIZE;
  let processed = 0;
  let writes = 0;
  let { offset, phase } = state;

  const continueLater = async () => {
    await ctx.db.patch("cardSearchTagSyncStates", stateId, { offset, phase });
    await recordTagCountDeltas(ctx, countDeltas);
    await scheduleCardSearchTagSync(ctx, cardId, ownerId, chainGeneration);
    return { complete: false, processed, writes };
  };

  // One invocation runs the phases in order until it has handled a batch of
  // rows, so a card with few tags syncs in a single transaction.
  while (phase === "tags" || phase === "aiTags") {
    if (!card) {
      phase = "pruneOld";
      offset = 0;
      break;
    }
    if (budget === 0) {
      return await continueLater();
    }
    const source = phase === "tags" ? (card.tags ?? []) : (card.aiTags ?? []);
    const sourceSlice = source.slice(offset, offset + budget);
    const tags = Array.from(
      new Set(sourceSlice.map(normalizeCardSearchTag).filter(Boolean))
    );
    for (const tag of tags) {
      writes += await writeCardSearchTag(
        ctx,
        cardId,
        card,
        tag,
        tagGeneration,
        countDeltas
      );
    }
    processed += sourceSlice.length;
    budget -= sourceSlice.length;
    offset += sourceSlice.length;
    if (offset >= source.length) {
      phase = phase === "tags" ? "aiTags" : "pruneOld";
      offset = 0;
    }
  }

  if (budget === 0) {
    return await continueLater();
  }
  const oldTags = await ctx.db
    .query("cardSearchTags")
    .withIndex("by_cardId_and_generation", (query) => {
      const cardRange = query.eq("cardId", cardId);
      return card
        ? cardRange.lt("syncGeneration", tagGeneration)
        : cardRange.lte("syncGeneration", chainState.generation);
    })
    .take(budget);
  for (const tagDocument of oldTags) {
    await ctx.db.delete("cardSearchTags", tagDocument._id);
    if (tagDocument.isCounted) {
      addTagCountDelta(countDeltas, tagDocument.userId, tagDocument.tag, -1);
    }
    writes += 1;
  }
  processed += oldTags.length;
  if (oldTags.length === budget) {
    return await continueLater();
  }
  if (card) {
    await ctx.db.patch("cardSearchTagSyncStates", stateId, {
      offset: 0,
      pending: false,
      phase: "complete",
    });
  } else {
    await ctx.db.delete("cardSearchTagSyncStates", stateId);
  }
  await recordTagCountDeltas(ctx, countDeltas);
  if (ownerId && state.tagCountsChanged !== false) {
    await markTagSummaryDirty(ctx, ownerId);
  }
  return { complete: true, processed, writes };
};

const TAG_ROW_SYNCED_FIELDS = [
  "userId",
  "isDeleted",
  "type",
  "isFavorited",
  "isArchived",
  "cardCreatedAt",
  "cardSavedAt",
  "sourceUpdatedAt",
  "syncGeneration",
] as const;

/** Writes one exact-tag row, patching only the fields that changed. */
const writeCardSearchTag = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  card: CardSyncSource,
  tag: string,
  tagGeneration: number,
  countDeltas: TagCountDeltas
): Promise<number> => {
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
    isDeleted: card.isDeleted === true ? (true as const) : undefined,
    type: card.type,
    isFavorited: card.isFavorited === true ? (true as const) : undefined,
    isArchived: card.isArchived === true ? (true as const) : undefined,
    cardCreatedAt: card.createdAt,
    cardSavedAt: card.savedAt ?? card.createdAt,
    sourceUpdatedAt: card.updatedAt,
    syncGeneration: tagGeneration,
  };
  const isCounted = isCountedTagRow(tagValue) ? (true as const) : undefined;
  if (!existingTag) {
    await ctx.db.insert("cardSearchTags", { ...tagValue, isCounted });
    if (isCounted) {
      addTagCountDelta(countDeltas, tagValue.userId, tag, 1);
    }
    return 1;
  }
  const changes: Partial<Doc<"cardSearchTags">> = {};
  for (const field of TAG_ROW_SYNCED_FIELDS) {
    if (existingTag[field] !== tagValue[field]) {
      Object.assign(changes, { [field]: tagValue[field] });
    }
  }
  if (existingTag.isCounted !== isCounted) {
    changes.isCounted = isCounted;
  }
  if (Object.keys(changes).length === 0) {
    return 0;
  }
  await ctx.db.patch("cardSearchTags", existingTag._id, changes);
  if (existingTag.isCounted) {
    addTagCountDelta(countDeltas, existingTag.userId, tag, -1);
  }
  if (isCounted) {
    addTagCountDelta(countDeltas, tagValue.userId, tag, 1);
  }
  return 1;
};
