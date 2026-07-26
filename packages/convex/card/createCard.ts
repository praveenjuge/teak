import {
  buildColorFacets,
  extractPaletteColors,
} from "@teak/convex/shared/utils/colorUtils";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
} from "../_generated/server";
import { ensureCardCreationAllowed } from "../auth";
import { cardTypeValidator, colorValidator } from "../schema";
import type { CardCreationSource } from "../shared/metrics";
import { normalizeErrorClass } from "../shared/telemetry";
import { assertSafeExternalUrl } from "../shared/utils/safeUrl";
import { scheduleCardOutcome } from "../telemetry/schedule";
import { workflow } from "../workflows/manager";
import { validateTextCardContent } from "./markdown";
import {
  buildInitialProcessingStatus,
  stageCompleted,
  stagePending,
} from "./processingStatus";
import { normalizeQuoteContent } from "./quoteFormatting";
import { extractUrlFromContent } from "./validationUtils";

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
}

export const createCardForUserHandler = async (
  ctx: MutationCtx,
  userId: string,
  args: CreateCardArgs,
  options: {
    importedVisibleFields?: ImportedVisibleFields;
    source?: CardCreationSource;
  } = {}
): Promise<Id<"cards">> => {
  // Check rate limit and card count limit
  await ensureCardCreationAllowed(ctx, userId);

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
    finalUrl = urlExtraction.url ?? finalUrl;
    finalContent = urlExtraction.cleanedContent;
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

  // Set initial metadataStatus for link cards
  const cardData = {
    userId,
    content: finalContent,
    type: cardType,
    url: finalUrl,
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
    isFavorited: options.importedVisibleFields?.isFavorited,
    // Set pending status for link cards that need metadata extraction
    ...(cardType === "link" && { metadataStatus: "pending" as const }),
  };

  const cardId = await ctx.db.insert("cards", cardData);

  // Start the card processing workflow
  await workflow.start(
    ctx,
    (internal as any)["workflows/cardProcessing"].cardProcessingWorkflow,
    { cardId }
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
  args: createCardArgs,
  returns: v.id("cards"),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User must be authenticated");
    }

    try {
      return await createCardForUserHandler(ctx, user.subject, args);
    } catch (error) {
      await scheduleCardOutcome(ctx, {
        cardType: args.type,
        errorClass: normalizeErrorClass(error),
        outcome: "failure",
        source: "unknown",
        userId: user.subject,
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
  handler: (ctx, args) => {
    const { userId, ...createArgs } = args;
    return createCardForUserHandler(ctx, userId, createArgs);
  },
});
