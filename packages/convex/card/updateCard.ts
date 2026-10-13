import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
} from "../_generated/server";
import { truncateCardTitle } from "../publicApiHttpShared";
import {
  getSessionUser,
  requireTeakUserId,
  type TeakUserId,
} from "../securitySessions";
import { parseCardTitle } from "../shared/cardTitle";
import { CARD_ERROR_CODES, CARD_ERROR_MESSAGES } from "../shared/constants";
import { RATE_LIMIT_CONFIG, rateLimiter } from "../shared/rateLimits";
import { assertSafeExternalUrl } from "../shared/utils/safeUrl";
import {
  ensureCardUsageShards,
  ensureCardUsageShardsForRemoval,
  recordActiveCardCreated,
  recordActiveCardRemoved,
} from "./cardUsage";
import { validateTextCardContent } from "./markdown";
import {
  buildInitialProcessingStatus,
  type ProcessingStatus,
  stagePending,
  withStageStatus,
} from "./processingStatus";
import { getCardQuotaEntitlement } from "./quota";
import { normalizeQuoteContent } from "./quoteFormatting";
import { scheduleCardSearchSync } from "./searchDocumentHelpers";

const updateCardFieldValidator = v.union(
  v.literal("content"),
  v.literal("url"),
  v.literal("notes"),
  v.literal("metadataTitle"),
  v.literal("tags"),
  v.literal("aiSummary"),
  v.literal("isFavorited"),
  v.literal("removeAiTag"),
  v.literal("delete"),
  v.literal("restore"),
  v.literal("archive"),
  v.literal("unarchive")
);

interface UpdateCardFieldForUserArgs {
  cardId: Id<"cards">;
  field:
    | "content"
    | "url"
    | "notes"
    | "metadataTitle"
    | "tags"
    | "aiSummary"
    | "isFavorited"
    | "removeAiTag"
    | "delete"
    | "restore"
    | "archive"
    | "unarchive";
  tagToRemove?: string;
  userId: TeakUserId;
  value?: unknown;
}

interface UpdateCardFieldForUserOptions {
  deferPipelineSchedule?: boolean;
  deferSearchSync?: boolean;
}

interface UpdateCardFieldForUserResult {
  shouldSchedulePipeline: boolean;
}

type ReprocessLimitName = "cardReprocessPerCard" | "cardReprocess";

const REPROCESS_LIMIT_MESSAGES: Record<ReprocessLimitName, string> = {
  cardReprocessPerCard: "This card is already queued for reprocessing",
  cardReprocess: CARD_ERROR_MESSAGES.RATE_LIMITED,
};

const assertReprocessAllowed = (
  name: ReprocessLimitName,
  result: { ok: boolean; retryAfter?: number },
  messages: Record<ReprocessLimitName, string> = REPROCESS_LIMIT_MESSAGES
): void => {
  if (result.ok) {
    return;
  }
  throw new ConvexError({
    code: CARD_ERROR_CODES.RATE_LIMITED,
    message: messages[name],
    limit: RATE_LIMIT_CONFIG[name].capacity,
    retryAt:
      typeof result.retryAfter === "number"
        ? Date.now() + result.retryAfter
        : undefined,
  });
};

// "Refresh details" is asked for directly, so its limits say so instead of the
// card-creation wording the edit path shares.
const RERUN_AI_LIMIT_MESSAGES: Record<ReprocessLimitName, string> = {
  cardReprocessPerCard:
    "This card is already refreshing. Try again in a minute.",
  cardReprocess:
    "You've refreshed a lot of cards. Wait a minute and try again.",
};

// Charges one reprocess for a card update: callers run it once per update,
// however many fields change.
const consumeCardReprocessLimit = async (
  ctx: MutationCtx,
  userId: string,
  cardId: Id<"cards">,
  messages: Record<ReprocessLimitName, string> = REPROCESS_LIMIT_MESSAGES
): Promise<void> => {
  assertReprocessAllowed(
    "cardReprocessPerCard",
    await rateLimiter.limit(ctx, "cardReprocessPerCard", {
      key: String(cardId),
      throws: false,
    }),
    messages
  );
  assertReprocessAllowed(
    "cardReprocess",
    await rateLimiter.limit(ctx, "cardReprocess", {
      key: userId,
      throws: false,
    }),
    messages
  );
};

export const updateCard = mutation({
  args: {
    id: v.id("cards"),
    content: v.optional(v.string()),
    url: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  returns: v.null(), // db.patch returns void/null
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      throw new Error("User must be authenticated");
    }

    const { id, ...updates } = args;
    const card = await ctx.db.get("cards", id);

    if (!card) {
      throw new Error("Card not found");
    }

    if (card.userId !== user.teakUserId) {
      throw new Error("Not authorized to update this card");
    }

    if (updates.url !== undefined) {
      updates.url = assertSafeExternalUrl(updates.url);
    }

    const now = Date.now();
    let processingStatus = card.processingStatus as
      | ProcessingStatus
      | undefined;

    if (updates.content !== undefined) {
      if (card.type === "quote") {
        updates.content = normalizeQuoteContent(updates.content).text;
      } else if (card.type === "text") {
        updates.content = validateTextCardContent(updates.content);
      }
    }
    const contentChanged =
      updates.content !== undefined && updates.content !== card.content;
    if (contentChanged) {
      processingStatus = processingStatus
        ? withStageStatus(processingStatus, "metadata", stagePending())
        : buildInitialProcessingStatus({
            now,
            cardType: card.type,
            classificationStatus: stagePending(),
          });

      if (card.type === "link" && processingStatus) {
        processingStatus = withStageStatus(
          processingStatus,
          "categorize",
          stagePending()
        );
      }
    }

    if (contentChanged) {
      await consumeCardReprocessLimit(ctx, user.teakUserId, id);
    }

    await ctx.db.patch("cards", id, {
      ...updates,
      ...(processingStatus ? { processingStatus } : {}),
      updatedAt: now,
    });
    await scheduleCardSearchSync(ctx, id, card.userId, card);

    // If content was updated, regenerate AI metadata
    if (contentChanged) {
      await ctx.scheduler.runAfter(
        0,
        (internal as any)["workflows/manager"].startCardProcessingWorkflow,
        {
          cardId: id,
        }
      );
    }

    return null;
  },
});

type EditableCardField =
  | "content"
  | "url"
  | "notes"
  | "metadataTitle"
  | "tags"
  | "removeAiTag";

export interface CardFieldEdit {
  field: EditableCardField;
  tagToRemove?: string;
  value?: unknown;
}

const EDITABLE_CARD_FIELDS = new Set<string>([
  "content",
  "url",
  "notes",
  "metadataTitle",
  "tags",
  "removeAiTag",
]);

interface CardEditState {
  card: Doc<"cards">;
  processingStatus: ProcessingStatus | undefined;
  shouldSchedulePipeline: boolean;
  updateData: Record<string, unknown>;
}

// Applies one field edit to the in-memory state. Validation errors throw
// before anything is written, so a multi-field edit is all-or-nothing.
// Returns false when the edit leaves the card unchanged.
const applyCardFieldEdit = (
  state: CardEditState,
  { field, value, tagToRemove }: CardFieldEdit,
  now: number
): boolean => {
  const card = state.card;
  const pendingMetadata = (cardType: Doc<"cards">["type"]) =>
    state.processingStatus
      ? withStageStatus(state.processingStatus, "metadata", stagePending())
      : buildInitialProcessingStatus({
          now,
          cardType,
          classificationStatus: stagePending(),
        });

  switch (field) {
    case "content": {
      let nextContent =
        typeof value === "string" && card.type !== "text"
          ? value.trim()
          : value;
      if (typeof nextContent === "string" && card.type === "quote") {
        nextContent = normalizeQuoteContent(nextContent).text;
      } else if (typeof nextContent === "string" && card.type === "text") {
        nextContent = validateTextCardContent(nextContent);
      }
      if (nextContent === card.content) {
        return false;
      }
      state.updateData.content = nextContent;
      state.processingStatus = pendingMetadata(card.type);
      if (card.type === "link" && state.processingStatus) {
        state.processingStatus = withStageStatus(
          state.processingStatus,
          "categorize",
          stagePending()
        );
      }
      state.shouldSchedulePipeline = true;
      return true;
    }

    case "url": {
      const nextUrl =
        typeof value === "string" ? assertSafeExternalUrl(value) : value;
      if (nextUrl === card.url) {
        return false;
      }
      state.updateData.url = nextUrl;
      const baseStatus = state.processingStatus
        ? withStageStatus(state.processingStatus, "classify", stagePending())
        : buildInitialProcessingStatus({
            now,
            cardType: card.type,
            classificationStatus: stagePending(),
          });
      state.processingStatus = withStageStatus(
        withStageStatus(baseStatus, "metadata", stagePending()),
        "categorize",
        stagePending()
      );
      state.shouldSchedulePipeline = true;

      const nextMetadata = { ...(card.metadata ?? {}) };
      if ("linkPreview" in nextMetadata) {
        (nextMetadata as Record<string, unknown>).linkPreview = undefined;
      }
      if ("linkCategory" in nextMetadata) {
        (nextMetadata as Record<string, unknown>).linkCategory = undefined;
      }
      state.updateData.metadata =
        Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
      state.updateData.metadataStatus = "pending";
      return true;
    }

    case "metadataTitle": {
      const title = parseCardTitle(truncateCardTitle(value));
      if (title === undefined) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Title must be a string or null",
        });
      }
      state.updateData.metadataTitle = title ?? undefined;
      state.updateData.metadataTitleEdited = true;
      return true;
    }

    case "notes":
      if (value === null) {
        state.updateData.notes = undefined;
      } else {
        state.updateData.notes =
          typeof value === "string" ? value.trim() || undefined : value;
      }
      return true;

    case "tags":
      state.updateData.tags =
        Array.isArray(value) && value.length > 0 ? value : undefined;
      return true;

    case "removeAiTag": {
      const aiTags = card.aiTags;
      if (!(tagToRemove && aiTags)) {
        return false;
      }
      const updatedAiTags = aiTags.filter((tag) => tag !== tagToRemove);
      state.updateData.aiTags =
        updatedAiTags.length > 0 ? updatedAiTags : undefined;
      return true;
    }

    default:
      throw new Error(`Unsupported field: ${field satisfies never}`);
  }
};

const loadOwnedCard = async (
  ctx: MutationCtx,
  userId: TeakUserId,
  cardId: Id<"cards">
): Promise<Doc<"cards">> => {
  const card = await ctx.db.get("cards", cardId);
  if (!card) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Card not found" });
  }

  if (card.userId !== userId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Card not found",
    });
  }
  return card;
};

/**
 * Applies several field edits to one card as a single update: every value is
 * validated first, the reprocess rate limit is charged at most once, and the
 * card is written with one patch. Nothing is written if any edit is invalid
 * or the reprocess limit is exhausted.
 */
export const updateCardFieldsForUserHandler = async (
  ctx: MutationCtx,
  {
    userId,
    cardId,
    edits,
  }: { cardId: Id<"cards">; edits: CardFieldEdit[]; userId: TeakUserId },
  options: UpdateCardFieldForUserOptions = {}
): Promise<UpdateCardFieldForUserResult> => {
  const card = await loadOwnedCard(ctx, userId, cardId);
  const now = Date.now();
  const state: CardEditState = {
    card,
    processingStatus: card.processingStatus as ProcessingStatus | undefined,
    shouldSchedulePipeline: false,
    updateData: {},
  };

  let changed = false;
  for (const edit of edits) {
    if (applyCardFieldEdit(state, edit, now)) {
      changed = true;
      state.card = { ...state.card, ...state.updateData } as Doc<"cards">;
    }
  }

  if (!changed) {
    return { shouldSchedulePipeline: false };
  }

  if (state.shouldSchedulePipeline) {
    await consumeCardReprocessLimit(ctx, userId, cardId);
  }

  await ctx.db.patch("cards", cardId, {
    ...state.updateData,
    ...(state.processingStatus
      ? { processingStatus: state.processingStatus }
      : {}),
    updatedAt: now,
  });
  if (!options.deferSearchSync) {
    await scheduleCardSearchSync(ctx, cardId, userId, card);
  }

  if (state.shouldSchedulePipeline && !options.deferPipelineSchedule) {
    await ctx.scheduler.runAfter(
      0,
      (internal as any)["workflows/manager"].startCardProcessingWorkflow,
      {
        cardId,
      }
    );
  }

  return { shouldSchedulePipeline: state.shouldSchedulePipeline };
};

export const updateCardFieldForUserHandler = async (
  ctx: MutationCtx,
  { userId, cardId, field, value, tagToRemove }: UpdateCardFieldForUserArgs,
  options: UpdateCardFieldForUserOptions = {}
): Promise<UpdateCardFieldForUserResult> => {
  if (EDITABLE_CARD_FIELDS.has(field)) {
    return updateCardFieldsForUserHandler(
      ctx,
      {
        userId,
        cardId,
        edits: [{ field: field as EditableCardField, value, tagToRemove }],
      },
      options
    );
  }

  const card = await loadOwnedCard(ctx, userId, cardId);
  const now = Date.now();
  const updateData: Partial<Doc<"cards">> & { updatedAt: number } = {
    updatedAt: now,
  };

  switch (field) {
    case "aiSummary":
      updateData.aiSummary =
        typeof value === "string"
          ? value.trim() || undefined
          : (value as string | undefined);
      break;

    case "isFavorited":
      updateData.isFavorited =
        typeof value === "boolean" ? value : !card.isFavorited;
      break;

    case "delete":
      updateData.isDeleted = true;
      updateData.deletedAt = now;
      break;

    case "restore":
      if (!card.isDeleted) {
        throw new Error("Card is not deleted");
      }
      updateData.isDeleted = undefined;
      updateData.deletedAt = undefined;
      break;

    // Archive hides a card from the library without deleting it, so it
    // still counts toward the card limit. A card in Trash keeps its archived
    // state, and restoring it returns it to Archive.
    case "archive":
      if (card.isArchived) {
        return { shouldSchedulePipeline: false };
      }
      updateData.isArchived = true;
      updateData.archivedAt = now;
      break;

    case "unarchive":
      if (!card.isArchived) {
        return { shouldSchedulePipeline: false };
      }
      updateData.isArchived = undefined;
      updateData.archivedAt = undefined;
      break;

    default:
      throw new Error(`Unsupported field: ${field}`);
  }

  if (field === "delete") {
    await ensureCardUsageShardsForRemoval(ctx, userId);
  }
  const hasPremium =
    field === "restore"
      ? await getCardQuotaEntitlement(ctx, userId)
      : undefined;
  if (field === "restore") {
    await ensureCardUsageShards(ctx, userId, hasPremium ?? false);
  }

  // Count a restored card before writing it: at the card limit this throws
  // with nothing written, so a bulk restore that carries on past the refusal
  // never leaves a restored card uncounted.
  if (field === "restore" && card.isDeleted) {
    await recordActiveCardCreated(ctx, userId, cardId, { hasPremium });
  }
  await ctx.db.patch("cards", cardId, updateData);
  if (field === "delete" && !card.isDeleted) {
    await recordActiveCardRemoved(ctx, userId, cardId);
  }
  if (!options.deferSearchSync) {
    await scheduleCardSearchSync(ctx, cardId, userId, card);
  }

  return { shouldSchedulePipeline: false };
};

// Unified mutation for updating any card field
export const updateCardField = mutation({
  args: {
    cardId: v.id("cards"),
    field: updateCardFieldValidator,
    value: v.optional(v.any()),
    tagToRemove: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { cardId, field, value, tagToRemove }) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      throw new Error("User must be authenticated");
    }

    await updateCardFieldForUserHandler(ctx, {
      userId: user.teakUserId,
      cardId,
      field,
      value,
      tagToRemove,
    });

    return null;
  },
});

export const updateCardFieldForUser = internalMutation({
  args: {
    userId: v.string(),
    cardId: v.id("cards"),
    field: updateCardFieldValidator,
    value: v.optional(v.any()),
    tagToRemove: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await updateCardFieldForUserHandler(ctx, {
      ...args,
      userId: await requireTeakUserId(ctx, args.userId),
    });
    return null;
  },
});

/**
 * Runs the whole processing pipeline again for one card ("Refresh details"): the
 * AI summary, tags and transcript are cleared and regenerated, along with
 * link metadata and previews. Checks ownership, Trash and both reprocess
 * limits before writing anything, so a refused request changes nothing.
 */
export const reprocessCardForUserHandler = async (
  ctx: MutationCtx,
  { userId, cardId }: { cardId: Id<"cards">; userId: TeakUserId }
): Promise<{ cardId: Id<"cards">; requestedAt: number }> => {
  const card = await loadOwnedCard(ctx, userId, cardId);
  if (card.isDeleted) {
    throw new ConvexError({
      code: "CONFLICT",
      message: "Restore this card from Trash before refreshing it",
    });
  }

  // Check both limits before spending either token, so a refusal by the
  // account-wide limit doesn't use up this card's minute.
  assertReprocessAllowed(
    "cardReprocessPerCard",
    await rateLimiter.check(ctx, "cardReprocessPerCard", {
      key: String(cardId),
    }),
    RERUN_AI_LIMIT_MESSAGES
  );
  assertReprocessAllowed(
    "cardReprocess",
    await rateLimiter.check(ctx, "cardReprocess", { key: userId }),
    RERUN_AI_LIMIT_MESSAGES
  );
  await consumeCardReprocessLimit(ctx, userId, cardId, RERUN_AI_LIMIT_MESSAGES);

  await ctx.scheduler.runAfter(
    0,
    (internal as any)["workflows/manager"].startCardProcessingWorkflow,
    { cardId }
  );

  return { cardId, requestedAt: Date.now() };
};

const reprocessCardResultValidator = v.object({
  cardId: v.id("cards"),
  requestedAt: v.number(),
});

// Refusals the person can act on. Each happens before anything is written,
// so returning one instead of throwing commits nothing.
const REPROCESS_REFUSAL_CODES = new Set([
  "CONFLICT",
  "NOT_FOUND",
  "RATE_LIMITED",
]);

/**
 * "Refresh details" from the app. Refusals (rate limited, in Trash, not found) are
 * returned rather than thrown, so the app shows them as a message instead of
 * a failed request.
 */
export const reprocessCard = mutation({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.object({
      status: v.literal("queued"),
      cardId: v.id("cards"),
      requestedAt: v.number(),
    }),
    v.object({
      status: v.literal("refused"),
      code: v.string(),
      message: v.string(),
      retryAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, { cardId }) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      throw new Error("User must be authenticated");
    }
    try {
      const result = await reprocessCardForUserHandler(ctx, {
        userId: user.teakUserId,
        cardId,
      });
      return { status: "queued" as const, ...result };
    } catch (error) {
      const data = (error instanceof ConvexError ? error.data : null) as {
        code?: unknown;
        message?: unknown;
        retryAt?: unknown;
      } | null;
      if (
        !(
          data &&
          REPROCESS_REFUSAL_CODES.has(String(data.code)) &&
          typeof data.message === "string"
        )
      ) {
        throw error;
      }
      return {
        status: "refused" as const,
        code: String(data.code),
        message: data.message,
        ...(typeof data.retryAt === "number" ? { retryAt: data.retryAt } : {}),
      };
    }
  },
});

export const reprocessCardForUser = internalMutation({
  args: { cardId: v.id("cards"), userId: v.string() },
  returns: reprocessCardResultValidator,
  handler: async (ctx, { cardId, userId }) =>
    await reprocessCardForUserHandler(ctx, {
      userId: await requireTeakUserId(ctx, userId),
      cardId,
    }),
});
