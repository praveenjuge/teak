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
import { cardTypeValidator, colorValidator } from "../schema";
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
import { recordActiveCardCreated } from "./cardUsage";
import { validateTextCardContent } from "./markdown";
import {
  buildInitialProcessingStatus,
  stageCompleted,
  stagePending,
} from "./processingStatus";
import { authorizeCardCreation } from "./quota";
import { normalizeQuoteContent } from "./quoteFormatting";
import { scheduleCardSearchSync } from "./searchDocumentHelpers";
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
  type: v.optional(cardTypeValidator), // Make type optional for auto-detection
  url: v.optional(v.string()),
  fileKey: v.optional(v.string()),
  thumbnailKey: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  metadata: v.optional(v.any()), // Allow any metadata from client, we'll process it
  colors: v.optional(v.array(colorValidator)), // For palette cards
} as const;

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
  isFavorited?: boolean;
  /** A title the user chose (e.g. a bookmark's name), kept over fetched page titles. */
  metadataTitle?: string;
}

const MAX_IMPORTED_TITLE_LENGTH = 512;

export const createCardForUserHandler = async (
  ctx: MutationCtx,
  userId: TeakUserId,
  args: CreateCardArgs,
  options: {
    importedVisibleFields?: ImportedVisibleFields;
    source?: CardCreationSource;
  } = {}
): Promise<Id<"cards">> => {
  // Check rate limit and card count limit
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
  let cardType = providedType ?? "text";
  let finalContent = args.content;
  let finalUrl = assertSafeExternalUrl(args.url);
  const originalMetadata = args.metadata || {};
  let fileMetadata: any;
  const classificationRequired = !providedType;
  const classificationStatus = classificationRequired
    ? stagePending()
    : stageCompleted(now, 1);

  // Separate file-related metadata from other metadata
  const processedMetadata = { ...originalMetadata } as Record<string, unknown>;

  // Move file-related fields to fileMetadata if present
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

  // When the client does not specify a type, let the backend decide: a resolved
  // URL upgrades the card to "link". This mirrors the deterministic classifier
  // (which always upgrades URL-bearing cards) and prevents links from sticking
  // as "text" before async classification runs. An explicit type is always
  // honored, so a note like "I read this at https://example.com" that a client
  // deliberately saves as text stays a text card.
  if (finalUrl && !providedType && cardType === "text") {
    cardType = "link";
  }

  const quoteNormalization = normalizeQuoteContent(finalContent);
  const shouldDefaultToQuote =
    !providedType && quoteNormalization.removedQuotes;

  if (shouldDefaultToQuote) {
    cardType = "quote";
  }

  if (cardType === "quote" && quoteNormalization.removedQuotes) {
    finalContent = quoteNormalization.text;
  }

  if (cardType === "text") {
    finalContent = validateTextCardContent(finalContent);
  }

  // Pre-populate palette colours when explicitly creating a palette card without provided colours
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

  // Set initial metadataStatus for link cards
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
    // An edited title survives link-preview refreshes (linkMetadata.ts).
    ...(importedTitle
      ? { metadataTitle: importedTitle, metadataTitleEdited: true }
      : {}),
    // Set pending status for link cards that need metadata extraction
    ...(cardType === "link" && { metadataStatus: "pending" as const }),
  };

  const cardId = await ctx.db.insert("cards", cardData);
  try {
    // The usage shards enforce the free-tier limit, and the shard slot is
    // keyed by the new card id, so the count is taken right after the insert.
    await recordActiveCardCreated(ctx, userId, cardId, { hasPremium });
  } catch (error) {
    // Convex has no savepoints: bulk create and import catch a per-item
    // CARD_LIMIT_REACHED and keep going, which would otherwise commit this
    // uncounted card. Remove it so a failed create leaves nothing behind.
    await ctx.db.delete("cards", cardId);
    throw error;
  }
  await scheduleCardSearchSync(ctx, cardId, userId);

  // Start the card processing workflow
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
