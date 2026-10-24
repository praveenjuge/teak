import {
  buildColorFacets,
  extractPaletteColors,
} from "@teak/convex/shared/utils/colorUtils";
import { ConvexError, type Infer, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { type MutationCtx, mutation } from "../_generated/server";
import { type CardType, cardTypeValidator, colorValidator } from "../schema";
import { requireSessionUser, type TeakUserId } from "../securitySessions";
import type { CardCreationSource } from "../shared/analytics";
import { normalizeCardSource } from "../shared/cardSource";
import { MAX_CARD_TITLE_LENGTH } from "../shared/cardTitle";
import { pageArchiveSkipReason } from "../shared/pageArchive";
import { normalizeErrorClass } from "../shared/telemetry";
import type { FileMetadata } from "../shared/types";
import { assertSafeExternalUrl } from "../shared/utils/safeUrl";
import { normalizeUrlHost } from "../shared/utils/urlHost";
import { urlKey } from "../shared/utils/urlKey";
import { buildR2UserPrefix, queueObjectDeletion } from "../storage/r2";
import { queueBackendEvent, queueCardOutcome } from "../telemetry/schedule";
import { queueCardProcessing } from "../workflowDispatch";
import { insertCountedCard } from "./cardUsage";
import { findLiveCardByUrl } from "./findDuplicateCard";
import { validateTextCardContent } from "./markdown";
import { acceptPendingPageSnapshot } from "./pageSnapshots";
import { isCardRunInFlight } from "./processingRuns";
import {
  buildInitialProcessingStatus,
  mergeProcessingStages,
  shouldRunArchiveStage,
  stageCompleted,
  stagePending,
} from "./processingStatus";
import { authorizeCardCreation } from "./quota";
import { normalizeQuoteContent } from "./quoteFormatting";
import { patchCardWithSearchSync, syncCardSearch } from "./searchSync";
import { newShuffleKey } from "./shuffle";
import { normalizeCardTags } from "./updateCard";
import { extractUrlFromContent } from "./validationUtils";

// Older app versions send no `source`, so their cards report "unknown".
export const clientCardSourceValidator = v.union(
  v.literal("web"),
  v.literal("apple"),
  v.literal("android")
);

const createCardArgs = {
  content: v.string(),
  type: v.optional(cardTypeValidator),
  url: v.optional(v.string()),
  fileKey: v.optional(v.string()),
  thumbnailKey: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  metadata: v.optional(v.any()),
  colors: v.optional(v.array(colorValidator)),
} as const;

const PIPELINE_OWNED_METADATA_FIELDS = ["linkCategory", "linkPreview"] as const;

const CLIENT_FILE_METADATA_FIELDS = {
  fileName: "string",
  fileSize: "number",
  mimeType: "string",
  duration: "number",
  width: "number",
  height: "number",
  recordingTimestamp: "number",
} as const satisfies Partial<
  Record<keyof NonNullable<FileMetadata>, "string" | "number">
>;

type ClientFileMetadata = Pick<
  NonNullable<FileMetadata>,
  keyof typeof CLIENT_FILE_METADATA_FIELDS
>;

// Moves the file facts a client sent inside `metadata` into `fileMetadata`.
// A value of the wrong type is refused, as the schema would refuse it on insert.
const takeClientFileMetadata = (
  metadata: Record<string, unknown>
): ClientFileMetadata | undefined => {
  const taken: Record<string, string | number> = {};
  for (const [field, expected] of Object.entries(CLIENT_FILE_METADATA_FIELDS)) {
    const value = metadata[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== expected) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `metadata.${field} must be a ${expected}`,
      });
    }
    taken[field] = value as string | number;
    delete metadata[field];
  }
  return Object.keys(taken).length > 0 ? taken : undefined;
};

const sessionCreateCardArgs = {
  ...createCardArgs,
  source: v.optional(clientCardSourceValidator),
} as const;
const sessionCreateCardArgsValidator = v.object(sessionCreateCardArgs);

interface CreateCardArgs {
  colors?: {
    hex: string;
    name?: string;
    rgb?: { r: number; g: number; b: number };
    hsl?: { h: number; s: number; l: number };
  }[];
  content: string;
  fileKey?: string;
  metadata?: unknown;
  notes?: string;
  /**
   * A link's page as the browser extension saw it: one of the caller's
   * pending snapshot uploads. Ignored when it isn't.
   */
  pageSnapshotKey?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  tags?: string[];
  thumbnailKey?: string;
  type?:
    | "text"
    | "link"
    | "image"
    | "video"
    | "audio"
    | "document"
    | "palette"
    | "quote";
  url?: string;
}

interface ImportedVisibleFields {
  completedAt?: number;
  createdAt?: number;
  isArchived?: boolean;
  isFavorited?: boolean;
  metadataTitle?: string;
  /** When the card was last saved; never before `createdAt`. */
  savedAt?: number;
}

/**
 * What a save did: made a new card, or found the link already in Teak and
 * moved that card to the top (`resaved`), bringing it back from Archive when
 * `wasArchived`.
 */
export interface CreateCardOutcome {
  cardId: Id<"cards">;
  outcome: "created" | "resaved";
  wasArchived?: boolean;
}

export const createCardOutcomeValidator = v.object({
  cardId: v.id("cards"),
  outcome: v.union(v.literal("created"), v.literal("resaved")),
  wasArchived: v.optional(v.boolean()),
});

/**
 * True when `content` adds nothing to the link in `url`: it is empty, or it
 * is only that link (or a variant of it). A link with words around it is a
 * note about the link, which is saved as its own card.
 */
export const isBareLinkContent = (content: string, url: string): boolean => {
  const trimmed = content.trim();
  if (!trimmed || trimmed === url) {
    return true;
  }
  const extracted = extractUrlFromContent(trimmed);
  if (!extracted.url || extracted.cleanedContent !== extracted.url) {
    return false;
  }
  return (
    extracted.url === url ||
    (urlKey(extracted.url) ?? extracted.url) === (urlKey(url) ?? url)
  );
};

export const resolveCreatedCardType = ({
  providedType,
  hasUrl,
  isQuoted,
}: {
  providedType: CardType | undefined;
  hasUrl: boolean;
  isQuoted: boolean;
}): CardType => {
  if (providedType) {
    return providedType;
  }
  if (isQuoted) {
    return "quote";
  }
  return hasUrl ? "link" : "text";
};

const assertClientKeysInUserNamespace = (
  userId: TeakUserId,
  keys: Record<string, string | undefined>
) => {
  const userPrefix = `${buildR2UserPrefix(userId)}/`;
  for (const [label, key] of Object.entries(keys)) {
    if (key !== undefined && !key.startsWith(userPrefix)) {
      throw new ConvexError({
        code: "INVALID_STORAGE_KEY",
        message: `${label} does not belong to the current user`,
      });
    }
  }
};

export const createCardForUserHandler = async (
  ctx: MutationCtx,
  userId: TeakUserId,
  args: CreateCardArgs,
  options: {
    importedVisibleFields?: ImportedVisibleFields;
    /** Runs once the card is counted, so a refused card makes no folders. */
    resolveFolderIds?: () => Promise<Id<"folders">[]>;
    /**
     * Always insert, even when the link is already saved. Imports skip
     * duplicates themselves and never move an existing card.
     */
    skipResave?: boolean;
    source?: CardCreationSource;
  } = {}
): Promise<CreateCardOutcome> => {
  const tags = args.tags && normalizeCardTags(args.tags);
  const { hasPremium } = await authorizeCardCreation(ctx, userId);

  assertClientKeysInUserNamespace(userId, {
    fileKey: args.fileKey,
    thumbnailKey: args.thumbnailKey,
  });

  const now = Date.now();

  const providedType = args.type;
  const explicitText = providedType === "text";
  let finalContent = args.content;
  let finalUrl = assertSafeExternalUrl(args.url);
  const originalMetadata = args.metadata || {};
  const classificationRequired = !providedType;
  const classificationStatus = classificationRequired
    ? stagePending()
    : stageCompleted(now, 1);

  const processedMetadata = { ...originalMetadata } as Record<string, unknown>;

  const fileMetadata = takeClientFileMetadata(processedMetadata);

  for (const field of PIPELINE_OWNED_METADATA_FIELDS) {
    delete processedMetadata[field];
  }

  if (!(explicitText || finalUrl) && args.content.trim()) {
    const urlExtraction = extractUrlFromContent(args.content);
    if (urlExtraction.url) {
      finalUrl = urlExtraction.url;
      finalContent = urlExtraction.cleanedContent;
    }
  }

  const quoteNormalization = normalizeQuoteContent(finalContent);
  const cardType = resolveCreatedCardType({
    providedType,
    hasUrl: Boolean(finalUrl),
    isQuoted: quoteNormalization.removedQuotes,
  });

  if (cardType === "quote" && quoteNormalization.removedQuotes) {
    finalContent = quoteNormalization.text;
  }

  if (cardType === "text") {
    finalContent = validateTextCardContent(finalContent);
  }

  const pageSnapshotKey =
    cardType === "link"
      ? await acceptPendingPageSnapshot(ctx, userId, args.pageSnapshotKey)
      : undefined;

  // Saving a link that's already in Teak moves that card to the top instead
  // of making a second one. The rate-limit token is spent above, and only the
  // insert below checks the free plan's cap, so a re-save at the cap works.
  if (
    !options.skipResave &&
    cardType === "link" &&
    finalUrl &&
    !(args.fileKey || args.thumbnailKey) &&
    isBareLinkContent(args.content, finalUrl)
  ) {
    const existing = await findLiveCardByUrl(ctx, userId, finalUrl);
    if (existing) {
      return await resaveCard(ctx, existing, {
        now,
        pageSnapshotKey,
        source: options.source ?? "unknown",
      });
    }
  }

  let resolvedColors = args.colors;
  if (!resolvedColors && cardType === "palette") {
    const paletteText = [
      finalContent,
      args.notes ?? "",
      tags ? tags.join(" ") : "",
    ]
      .filter(Boolean)
      .join("\n");

    const parsedColors = extractPaletteColors(paletteText, 12);
    resolvedColors = parsedColors.length > 0 ? parsedColors : undefined;
  }
  const { colorHexes, colorHues } = buildColorFacets(resolvedColors);

  const cardSource = normalizeCardSource({
    sourceTitle: args.sourceTitle,
    sourceUrl: args.sourceUrl,
  });

  const importedTitle = options.importedVisibleFields?.metadataTitle
    ?.trim()
    .slice(0, MAX_CARD_TITLE_LENGTH);

  const cardData = {
    userId,
    content: finalContent,
    type: cardType,
    url: finalUrl,
    ...cardSource,
    urlHost: normalizeUrlHost(finalUrl ?? cardSource.sourceUrl) ?? undefined,
    fileKey: args.fileKey,
    thumbnailKey: args.thumbnailKey,
    tags,
    notes: args.notes,
    metadata:
      Object.keys(processedMetadata).length > 0 ? processedMetadata : undefined,
    fileMetadata,
    colors: resolvedColors,
    colorHexes,
    colorHues,
    processingStatus: {
      ...buildInitialProcessingStatus({
        now,
        cardType,
        classificationStatus,
      }),
      ...(shouldRunArchiveStage(cardType) ? { archive: stagePending() } : {}),
    },
    ...(pageSnapshotKey
      ? { pendingPageSnapshotKey: pageSnapshotKey, pendingPageSnapshotAt: now }
      : {}),
    createdAt: options.importedVisibleFields?.createdAt ?? now,
    ...(options.importedVisibleFields?.savedAt === undefined
      ? {}
      : {
          savedAt: Math.max(
            options.importedVisibleFields.savedAt,
            options.importedVisibleFields.createdAt ?? now
          ),
        }),
    updatedAt: now,
    shuffleKey: newShuffleKey(),
    isFavorited: options.importedVisibleFields?.isFavorited,
    ...(cardType === "link" &&
      options.importedVisibleFields?.completedAt !== undefined && {
        completedAt: options.importedVisibleFields.completedAt,
      }),
    ...(options.importedVisibleFields?.isArchived
      ? { isArchived: true as const, archivedAt: now }
      : {}),
    ...(importedTitle
      ? { metadataTitle: importedTitle, metadataTitleEdited: true }
      : {}),
    ...(cardType === "link" && { metadataStatus: "pending" as const }),
  };

  const cardId = await insertCountedCard(ctx, cardData, { hasPremium });
  const folderIds = await options.resolveFolderIds?.();
  if (folderIds?.length) {
    await ctx.db.patch("cards", cardId, { folderIds });
  }
  await syncCardSearch(ctx, cardId, userId);

  await queueCardProcessing(ctx, cardId);

  await queueCardOutcome(ctx, {
    cardId,
    cardType,
    outcome: "success",
    source: options.source ?? "unknown",
    userId,
  });

  return { cardId, outcome: "created" };
};

/**
 * Moves a saved card to the top of "Newest first" and back from Archive. The
 * search sync carries the new `savedAt` to its folder and tag rows. Nothing
 * else changes, and the card isn't processed again, except that a page the
 * extension sent replaces the saved copy: at once, unless a run is in flight,
 * which picks the page up when it ends. Stages a run left pending, like AI
 * metadata waiting for its backfill, don't hold the page back.
 */
const resaveCard = async (
  ctx: MutationCtx,
  card: Doc<"cards">,
  {
    now,
    pageSnapshotKey,
    source,
  }: { now: number; pageSnapshotKey?: string; source: CardCreationSource }
): Promise<CreateCardOutcome> => {
  const wasArchived = card.isArchived === true;
  const snapshot = pageSnapshotKey
    ? { pendingPageSnapshotKey: pageSnapshotKey, pendingPageSnapshotAt: now }
    : null;
  if (
    snapshot &&
    card.pendingPageSnapshotKey &&
    card.pendingPageSnapshotKey !== pageSnapshotKey
  ) {
    await queueObjectDeletion(ctx, card.pendingPageSnapshotKey);
  }
  const archiveNow =
    snapshot !== null &&
    pageArchiveSkipReason({ ...card, ...snapshot }) === null &&
    !(await isCardRunInFlight(ctx, card));
  await patchCardWithSearchSync(ctx, card._id, {
    savedAt: now,
    updatedAt: now,
    ...(wasArchived ? { isArchived: undefined, archivedAt: undefined } : {}),
    ...(snapshot ?? {}),
    ...(archiveNow
      ? {
          processingStatus: mergeProcessingStages(card.processingStatus, {
            archive: stagePending(),
          }),
        }
      : {}),
  });
  if (archiveNow) {
    await queueCardProcessing(ctx, card._id, { archiveOnly: true });
  }
  await queueBackendEvent(ctx, "card_resaved", card.userId, {
    source,
    was_archived: wasArchived,
  });
  return {
    cardId: card._id,
    outcome: "resaved",
    ...(wasArchived ? { wasArchived: true } : {}),
  };
};

const createCardForSession = async (
  ctx: MutationCtx,
  {
    source: clientSource,
    ...args
  }: Infer<typeof sessionCreateCardArgsValidator>
): Promise<CreateCardOutcome> => {
  const user = await requireSessionUser(ctx);
  const source: CardCreationSource = clientSource ?? "unknown";

  try {
    return await createCardForUserHandler(ctx, user.teakUserId, args, {
      source,
    });
  } catch (error) {
    await queueCardOutcome(ctx, {
      cardType: args.type,
      errorClass: normalizeErrorClass(error),
      outcome: "failure",
      source,
      userId: user.teakUserId,
    });
    throw error;
  }
};

/** Returns only the card's id, which the native apps expect. */
export const createCard = mutation({
  args: sessionCreateCardArgs,
  returns: v.id("cards"),
  handler: async (ctx, args) => (await createCardForSession(ctx, args)).cardId,
});

/**
 * `createCard`, also saying whether the save made a new card or moved a card
 * already in Teak to the top (`resaved`).
 */
export const createCardWithOutcome = mutation({
  args: sessionCreateCardArgs,
  returns: createCardOutcomeValidator,
  handler: (ctx, args) => createCardForSession(ctx, args),
});
