import {
  buildColorFacets,
  extractPaletteColors,
  MAX_PALETTE_COLORS,
} from "@teak/convex/shared/utils/colorUtils";
import { ConvexError, type Infer, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { type MutationCtx, mutation } from "../_generated/server";
import { autoTagsForJoinedFolders } from "../folder/rules";
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
import { findLiveCardByUrl, findTrashedCardByUrl } from "./findDuplicateCard";
import { withHiddenFlag } from "./hiddenCards";
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
import { normalizeCardTags, updateCardFieldForUserHandler } from "./updateCard";
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

export interface CreateCardOutcome {
  cardId: Id<"cards">;
  /** `inTrash`: nothing was saved, since the link's card is in Trash. */
  outcome: "created" | "inTrash" | "resaved";
  wasArchived?: boolean;
  wasTrashed?: boolean;
}

export const createCardOutcomeValidator = v.object({
  cardId: v.id("cards"),
  outcome: v.union(
    v.literal("created"),
    v.literal("inTrash"),
    v.literal("resaved")
  ),
  wasArchived: v.optional(v.boolean()),
  wasTrashed: v.optional(v.boolean()),
});

/**
 * What a save does when the link's only card is in Trash: by default it makes
 * a new card, as it always has. `report` saves nothing and answers `inTrash`
 * with that card, so the client can offer to restore it; `restore` brings it
 * back from Trash and moves it to the top, like any re-save.
 */
export const trashedDuplicateValidator = v.optional(
  v.union(v.literal("report"), v.literal("restore"))
);
export type TrashedDuplicate = Infer<typeof trashedDuplicateValidator>;

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
    skipResave?: boolean;
    source?: CardCreationSource;
    trashedDuplicate?: TrashedDuplicate;
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
    const trashed = options.trashedDuplicate
      ? await findTrashedCardByUrl(ctx, userId, finalUrl)
      : null;
    if (trashed && options.trashedDuplicate === "report") {
      if (pageSnapshotKey) {
        await queueObjectDeletion(ctx, pageSnapshotKey);
      }
      return { cardId: trashed._id, outcome: "inTrash" };
    }
    if (trashed) {
      // Restoring counts the card again, so the free plan's cap applies.
      await updateCardFieldForUserHandler(ctx, {
        cardId: trashed._id,
        field: "restore",
        userId,
      });
      const restored = await ctx.db.get("cards", trashed._id);
      if (restored) {
        const outcome = await resaveCard(ctx, restored, {
          now,
          pageSnapshotKey,
          source: options.source ?? "unknown",
        });
        return { ...outcome, wasTrashed: true };
      }
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

    const parsedColors = extractPaletteColors(paletteText, MAX_PALETTE_COLORS);
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
      ...(shouldRunArchiveStage(cardType)
        ? { archive: stagePending(), article: stagePending() }
        : {}),
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
    const inserted = await ctx.db.get("cards", cardId);
    const { tags } = inserted
      ? await autoTagsForJoinedFolders(ctx, inserted, folderIds, [])
      : { tags: undefined };
    await ctx.db.patch(
      "cards",
      cardId,
      withHiddenFlag({ folderIds, ...(tags ? { tags } : {}) })
    );
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
 * extension sent replaces the saved copy (unless the card has highlights):
 * at once, unless a run is in flight, which picks the page up when it ends. Stages a run left pending, like AI
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
  const frozen =
    pageSnapshotKey !== undefined && pageArchiveSkipReason(card) === "frozen";
  if (frozen) {
    await queueObjectDeletion(ctx, pageSnapshotKey);
  }
  const snapshot =
    pageSnapshotKey && !frozen
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
            article: stagePending(),
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
  }: Infer<typeof sessionCreateCardArgsValidator>,
  trashedDuplicate?: TrashedDuplicate
): Promise<CreateCardOutcome> => {
  const user = await requireSessionUser(ctx);
  const source: CardCreationSource = clientSource ?? "unknown";

  try {
    return await createCardForUserHandler(ctx, user.teakUserId, args, {
      source,
      trashedDuplicate,
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

export const createCardWithOutcome = mutation({
  args: {
    ...sessionCreateCardArgs,
    trashedDuplicate: trashedDuplicateValidator,
  },
  returns: createCardOutcomeValidator,
  handler: (ctx, { trashedDuplicate, ...args }) =>
    createCardForSession(ctx, args, trashedDuplicate),
});
