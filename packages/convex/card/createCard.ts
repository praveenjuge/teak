import {
  buildColorFacets,
  extractPaletteColors,
} from "@teak/convex/shared/utils/colorUtils";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
} from "../_generated/server";
import { type CardType, cardTypeValidator, colorValidator } from "../schema";
import {
  getSessionUser,
  requireTeakUserId,
  type TeakUserId,
} from "../securitySessions";
import type { CardCreationSource } from "../shared/analytics";
import { normalizeErrorClass } from "../shared/telemetry";
import { assertSafeExternalUrl } from "../shared/utils/safeUrl";
import { normalizeUrlHost } from "../shared/utils/urlHost";
import { buildR2UserPrefix } from "../storage/r2";
import { scheduleCardOutcome } from "../telemetry/schedule";
import { startWorkflow } from "../workflows/manager";
import { insertCountedCard } from "./cardUsage";
import { validateTextCardContent } from "./markdown";
import {
  buildInitialProcessingStatus,
  stageCompleted,
  stagePending,
} from "./processingStatus";
import { authorizeCardCreation } from "./quota";
import { normalizeQuoteContent } from "./quoteFormatting";
import { syncCardSearch } from "./searchDocumentHelpers";
import { newShuffleKey } from "./shuffle";
import { extractUrlFromContent } from "./validationUtils";

// The signed-in apps say which surface saved the card, for analytics only.
// Older app versions omit it and report "unknown".
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
  metadata: v.optional(v.any()), // Allow any metadata from client, we'll process it
  colors: v.optional(v.array(colorValidator)), // For palette cards
} as const;

const PIPELINE_OWNED_METADATA_FIELDS = ["linkCategory", "linkPreview"] as const;

const sessionCreateCardArgs = {
  ...createCardArgs,
  source: v.optional(clientCardSourceValidator),
} as const;

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
  createdAt?: number;
  isArchived?: boolean;
  isFavorited?: boolean;
  metadataTitle?: string;
}

const MAX_IMPORTED_TITLE_LENGTH = 512;

/**
 * An explicit type is always kept, so a note a client saves as text stays
 * text even when it mentions a URL. Otherwise quoted text is a quote and a URL
 * makes a link, as the classifier would decide, so a link never shows as text
 * before classification runs.
 */
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

export const createCardForUserHandler = async (
  ctx: MutationCtx,
  userId: TeakUserId,
  args: CreateCardArgs,
  options: {
    importedVisibleFields?: ImportedVisibleFields;
    source?: CardCreationSource;
  } = {}
): Promise<Id<"cards">> => {
  const { hasPremium } = await authorizeCardCreation(ctx, userId);

  // Client-supplied storage keys must live in the caller's namespace so a
  // stale or forged key can never persist and break later reads.
  const userPrefix = `${buildR2UserPrefix(userId)}/`;
  for (const [label, key] of [
    ["fileKey", args.fileKey],
    ["thumbnailKey", args.thumbnailKey],
  ] as const) {
    if (key !== undefined && !key.startsWith(userPrefix)) {
      throw new ConvexError({
        code: "INVALID_STORAGE_KEY",
        message: `${label} does not belong to the current user`,
      });
    }
  }

  const now = Date.now();

  const providedType = args.type;
  const explicitText = providedType === "text";
  let finalContent = args.content;
  let finalUrl = assertSafeExternalUrl(args.url);
  const originalMetadata = args.metadata || {};
  let fileMetadata: any;
  const classificationRequired = !providedType;
  const classificationStatus = classificationRequired
    ? stagePending()
    : stageCompleted(now, 1);

  const processedMetadata = { ...originalMetadata } as Record<string, unknown>;

  const fileRelatedFields = [
    "fileName",
    "fileSize",
    "mimeType",
    "duration",
    "width",
    "height",
    "recordingTimestamp",
  ] as const;
  const extractedFileMetadata: any = {};

  for (const field of fileRelatedFields) {
    if (processedMetadata[field] !== undefined) {
      extractedFileMetadata[field] = processedMetadata[field];
      delete processedMetadata[field];
    }
  }

  for (const field of PIPELINE_OWNED_METADATA_FIELDS) {
    delete processedMetadata[field];
  }

  if (args.fileKey) {
    fileMetadata =
      Object.keys(extractedFileMetadata).length > 0
        ? extractedFileMetadata
        : undefined;
  } else if (Object.keys(extractedFileMetadata).length > 0) {
    fileMetadata = extractedFileMetadata;
  }

  if (!(explicitText || finalUrl) && args.content?.trim()) {
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

  let resolvedColors = args.colors;
  if (!resolvedColors && cardType === "palette") {
    const paletteText = [
      finalContent ?? "",
      args.notes ?? "",
      Array.isArray(args.tags) ? args.tags.join(" ") : "",
    ]
      .filter(Boolean)
      .join("\n");

    const parsedColors = extractPaletteColors(paletteText, 12);
    resolvedColors = parsedColors.length > 0 ? parsedColors : undefined;
  }
  const { colorHexes, colorHues } = buildColorFacets(resolvedColors);

  const importedTitle = options.importedVisibleFields?.metadataTitle
    ?.trim()
    .slice(0, MAX_IMPORTED_TITLE_LENGTH);

  const cardData = {
    userId,
    content: finalContent,
    type: cardType,
    url: finalUrl,
    urlHost: normalizeUrlHost(finalUrl) ?? undefined,
    fileKey: args.fileKey,
    thumbnailKey: args.thumbnailKey,
    tags: args.tags,
    notes: args.notes,
    metadata:
      Object.keys(processedMetadata).length > 0 ? processedMetadata : undefined,
    fileMetadata,
    colors: resolvedColors,
    colorHexes,
    colorHues,
    processingStatus: buildInitialProcessingStatus({
      now,
      cardType,
      classificationStatus,
    }),
    createdAt: options.importedVisibleFields?.createdAt ?? now,
    updatedAt: now,
    shuffleKey: newShuffleKey(),
    isFavorited: options.importedVisibleFields?.isFavorited,
    ...(options.importedVisibleFields?.isArchived
      ? { isArchived: true as const, archivedAt: now }
      : {}),
    ...(importedTitle
      ? { metadataTitle: importedTitle, metadataTitleEdited: true }
      : {}),
    ...(cardType === "link" && { metadataStatus: "pending" as const }),
  };

  const cardId = await insertCountedCard(ctx, cardData, { hasPremium });
  await syncCardSearch(ctx, cardId, userId);

  await startWorkflow(
    ctx,
    (internal as any)["workflows/cardProcessing"].cardProcessingWorkflow,
    { cardId },
    { startAsync: true }
  );

  await scheduleCardOutcome(ctx, {
    cardId,
    cardType,
    outcome: "success",
    source: options.source ?? "unknown",
    userId,
  });

  return cardId;
};

export const createCard = mutation({
  args: sessionCreateCardArgs,
  returns: v.id("cards"),
  handler: async (ctx, { source: clientSource, ...args }) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      throw new Error("User must be authenticated");
    }
    const source: CardCreationSource = clientSource ?? "unknown";

    try {
      return await createCardForUserHandler(ctx, user.teakUserId, args, {
        source,
      });
    } catch (error) {
      await scheduleCardOutcome(ctx, {
        cardType: args.type,
        errorClass: normalizeErrorClass(error),
        outcome: "failure",
        source,
        userId: user.teakUserId,
      });
      throw error;
    }
  },
});

export const createCardForUser = internalMutation({
  args: {
    userId: v.string(),
    ...createCardArgs,
  },
  returns: v.id("cards"),
  handler: async (ctx, args) => {
    const { userId, ...createArgs } = args;
    return createCardForUserHandler(
      ctx,
      await requireTeakUserId(ctx, userId),
      createArgs
    );
  },
});
