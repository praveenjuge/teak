import { ConvexError, v } from "convex/values";
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
import { explainInvalidCardTags, normalizeTagList } from "../shared/tags";
import { assertSafeExternalUrl } from "../shared/utils/safeUrl";
import { queueCardProcessing } from "../workflowDispatch";
import {
  ensureCardUsageShards,
  ensureCardUsageShardsForRemoval,
  recordActiveCardRemoved,
  restoreCountedCard,
} from "./cardUsage";
import { withHiddenFlag } from "./hiddenCards";
import { validateTextCardContent } from "./markdown";
import {
  buildInitialProcessingStatus,
  type ProcessingStatus,
  stagePending,
  withStageStatus,
} from "./processingStatus";
import { getCardQuotaEntitlement } from "./quota";
import { normalizeQuoteContent } from "./quoteFormatting";
import { syncCardSearch, withUrlHost } from "./searchDocumentHelpers";

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
  v.literal("unarchive"),
  v.literal("done"),
  v.literal("undone")
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
    | "unarchive"
    | "done"
    | "undone";
  tagToRemove?: string;
  userId: TeakUserId;
  value?: unknown;
}

interface UpdateCardFieldForUserOptions {
  deferPipelineSchedule?: boolean;
  deferSearchSync?: boolean;
}

interface UpdateCardFieldForUserResult {
  pipelineDelayMs: number | null;
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

const RERUN_AI_LIMIT_MESSAGES: Record<ReprocessLimitName, string> = {
  cardReprocessPerCard:
    "This card is already refreshing. Try again in a minute.",
  cardReprocess:
    "You've refreshed a lot of cards. Wait a minute and try again.",
};

const reserveEditReprocess = async (
  ctx: MutationCtx,
  userId: string,
  cardId: Id<"cards">
): Promise<number | null> => {
  const perCardArgs = { key: String(cardId), reserve: true } as const;
  const accountArgs = { key: userId, reserve: true } as const;
  // Check both before reserving either: a bulk update catches each item's
  // refusal and commits, so a reservation made before the account refuses
  // would stay behind, and this card's later edits would join a run that
  // was never scheduled.
  if (!(await rateLimiter.check(ctx, "cardReprocessPerCard", perCardArgs)).ok) {
    return null;
  }
  assertReprocessAllowed(
    "cardReprocess",
    await rateLimiter.check(ctx, "cardReprocess", accountArgs)
  );
  const perCard = await rateLimiter.limit(ctx, "cardReprocessPerCard", {
    ...perCardArgs,
    throws: false,
  });
  const account = await rateLimiter.limit(ctx, "cardReprocess", {
    ...accountArgs,
    throws: false,
  });
  return Math.max(perCard.retryAfter ?? 0, account.retryAfter ?? 0);
};

const spendCardReprocessLimits = async (
  ctx: MutationCtx,
  userId: string,
  cardId: Id<"cards">,
  messages: Record<ReprocessLimitName, string> = REPROCESS_LIMIT_MESSAGES
): Promise<void> => {
  assertReprocessAllowed(
    "cardReprocessPerCard",
    await rateLimiter.check(ctx, "cardReprocessPerCard", {
      key: String(cardId),
    }),
    messages
  );
  assertReprocessAllowed(
    "cardReprocess",
    await rateLimiter.check(ctx, "cardReprocess", { key: userId }),
    messages
  );
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

/**
 * Normalizes the tags a card write sets and refuses ones the card can't hold.
 * `previousCount` is how many tags the card had before the write.
 */
export const normalizeCardTags = (
  tags: readonly unknown[],
  previousCount = 0
): string[] | undefined => {
  if (tags.some((tag) => typeof tag !== "string")) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Tags must be strings",
    });
  }
  const normalized = normalizeTagList(tags as string[]);
  const problem = explainInvalidCardTags(normalized, previousCount);
  if (problem) {
    throw new ConvexError({ code: "INVALID_INPUT", message: problem });
  }
  return normalized.length > 0 ? normalized : undefined;
};

export const updateCard = mutation({
  args: {
    id: v.id("cards"),
    content: v.optional(v.string()),
    url: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  returns: v.null(),
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
    if (updates.tags !== undefined) {
      updates.tags = normalizeCardTags(updates.tags, card.tags?.length);
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

    const pipelineDelayMs = contentChanged
      ? await reserveEditReprocess(ctx, user.teakUserId, id)
      : null;

    await ctx.db.patch(
      "cards",
      id,
      withUrlHost({
        ...updates,
        ...(processingStatus ? { processingStatus } : {}),
        updatedAt: now,
      })
    );
    await syncCardSearch(ctx, id, card.userId, card);

    if (pipelineDelayMs !== null) {
      await queueCardProcessing(ctx, id, {
        delayMs: pipelineDelayMs,
        reset: true,
      });
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
      const parsed = parseCardTitle(truncateCardTitle(value));
      if (parsed.kind === "invalid") {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Title must be a string or null",
        });
      }
      state.updateData.metadataTitle =
        parsed.kind === "title" ? parsed.title : undefined;
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
      state.updateData.tags = Array.isArray(value)
        ? normalizeCardTags(value, card.tags?.length)
        : undefined;
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

const assertCanMarkDone = (card: Doc<"cards">) => {
  if (card.isDeleted) {
    throw new ConvexError({
      code: "CONFLICT",
      message: "Restore this card from Trash before marking it done",
    });
  }
  if (card.type !== "link") {
    throw new ConvexError({
      code: "TYPE_MISMATCH",
      message: "Only link cards can be marked done",
    });
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
    return { pipelineDelayMs: null };
  }

  const pipelineDelayMs = state.shouldSchedulePipeline
    ? await reserveEditReprocess(ctx, userId, cardId)
    : null;

  await ctx.db.patch(
    "cards",
    cardId,
    withHiddenFlag(
      withUrlHost({
        ...state.updateData,
        ...(state.processingStatus
          ? { processingStatus: state.processingStatus }
          : {}),
        updatedAt: now,
      })
    )
  );
  if (!options.deferSearchSync) {
    await syncCardSearch(ctx, cardId, userId, card);
  }

  if (pipelineDelayMs !== null && !options.deferPipelineSchedule) {
    await queueCardProcessing(ctx, cardId, {
      delayMs: pipelineDelayMs,
      reset: true,
    });
  }

  return { pipelineDelayMs };
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

    case "archive":
      if (card.isArchived) {
        return { pipelineDelayMs: null };
      }
      updateData.isArchived = true;
      updateData.archivedAt = now;
      break;

    case "unarchive":
      if (!card.isArchived) {
        return { pipelineDelayMs: null };
      }
      updateData.isArchived = undefined;
      updateData.archivedAt = undefined;
      break;

    case "done":
    case "undone":
      assertCanMarkDone(card);
      if ((field === "done") === (card.completedAt !== undefined)) {
        return { pipelineDelayMs: null };
      }
      updateData.completedAt = field === "done" ? now : undefined;
      break;

    default:
      throw new Error(`Unsupported field: ${field}`);
  }

  if (field === "restore") {
    const hasPremium = await getCardQuotaEntitlement(ctx, userId);
    await ensureCardUsageShards(ctx, userId, hasPremium);
    await restoreCountedCard(ctx, card, updateData, { hasPremium });
  } else {
    if (field === "delete") {
      await ensureCardUsageShardsForRemoval(ctx, userId);
    }
    await ctx.db.patch("cards", cardId, updateData);
    if (field === "delete" && !card.isDeleted) {
      try {
        await recordActiveCardRemoved(ctx, userId, cardId);
      } catch (error) {
        // Bulk deletes catch each card's error and commit the rest, and Convex
        // has no savepoints, so the card is put back before the error leaves.
        await ctx.db.patch("cards", cardId, {
          isDeleted: card.isDeleted,
          deletedAt: card.deletedAt,
          updatedAt: card.updatedAt,
        });
        throw error;
      }
    }
  }
  if (!options.deferSearchSync) {
    await syncCardSearch(ctx, cardId, userId, card);
  }

  return { pipelineDelayMs: null };
};

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

  await spendCardReprocessLimits(ctx, userId, cardId, RERUN_AI_LIMIT_MESSAGES);

  await queueCardProcessing(ctx, cardId, { refresh: true, reset: true });

  return { cardId, requestedAt: Date.now() };
};

const reprocessCardResultValidator = v.object({
  cardId: v.id("cards"),
  requestedAt: v.number(),
});

const REPROCESS_REFUSAL_CODES = new Set([
  "CONFLICT",
  "NOT_FOUND",
  "RATE_LIMITED",
]);

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
