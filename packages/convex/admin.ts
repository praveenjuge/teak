import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalMutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import type {
  ProcessingStageKey,
  ProcessingStatus,
} from "./card/processingStatus";
import { stagePending } from "./card/processingStatus";

type StageSummary = {
  pending: number;
  inProgress: number;
  failed: number;
};

type MissingCardSummary = {
  cardId: Id<"cards">;
  type: string;
  createdAt: number;
  metadataStatus?: "pending" | "completed" | "failed";
  processingStatus?: ProcessingStatus;
  reasons: string[];
};

const STAGE_KEYS: ProcessingStageKey[] = [
  "classify",
  "categorize",
  "metadata",
  "renderables",
];

const SEVEN_DAYS_IN_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_MISSING_CARDS = 50;
// Maximum cards to process in admin overview to prevent memory issues
// For larger datasets, consider denormalizing counters or using pagination
const ADMIN_OVERVIEW_LIMIT = 10_000;
const ADMIN_LIST_LIMIT = 200;

type AdminCtx = QueryCtx | ActionCtx;

const SINGLE_RESULT_PAGE = {
  cursor: null,
  numItems: 1,
} as const;

const getFirstUserId = async (ctx: AdminCtx) => {
  const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "user",
    sortBy: { field: "createdAt", direction: "asc" },
    limit: 1,
    paginationOpts: SINGLE_RESULT_PAGE,
  })) as { page?: Array<{ _id: string }> };

  const firstUser = result?.page?.[0];
  return firstUser?._id ?? null;
};

const ensureAdmin = async (ctx: AdminCtx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }

  const firstUserId = await getFirstUserId(ctx);

  if (!firstUserId || identity.subject !== firstUserId) {
    throw new Error("Unauthorized");
  }
};

const clampPagination = (paginationOpts: {
  cursor: string | null;
  numItems: number;
}) => ({
  ...paginationOpts,
  numItems: Math.min(paginationOpts.numItems, ADMIN_LIST_LIMIT),
});

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
  linkPreviewImageUrl?: string;
};

const attachCardUrls = async (
  ctx: QueryCtx,
  cards: Doc<"cards">[]
): Promise<CardWithUrls[]> =>
  Promise.all(
    cards.map(async (card) => {
      const [fileUrl, thumbnailUrl, screenshotUrl, linkPreviewImageUrl] =
        await Promise.all([
          card.fileId ? ctx.storage.getUrl(card.fileId) : Promise.resolve(null),
          card.thumbnailId
            ? ctx.storage.getUrl(card.thumbnailId)
            : Promise.resolve(null),
          card.metadata?.linkPreview?.screenshotStorageId
            ? ctx.storage.getUrl(card.metadata.linkPreview.screenshotStorageId)
            : Promise.resolve(null),
          card.metadata?.linkPreview?.imageStorageId
            ? ctx.storage.getUrl(card.metadata.linkPreview.imageStorageId)
            : Promise.resolve(null),
        ]);

      return {
        ...card,
        fileUrl: fileUrl || undefined,
        thumbnailUrl: thumbnailUrl || undefined,
        screenshotUrl: screenshotUrl || undefined,
        linkPreviewImageUrl: linkPreviewImageUrl || undefined,
      };
    })
  );

const getActiveCardCountForUser = async (
  ctx: QueryCtx,
  userId: string
): Promise<number> => {
  const cards = await ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (q) =>
      q.eq("userId", userId).eq("isDeleted", undefined)
    )
    .collect();

  return cards.length;
};

export const getAccess = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { allowed: false } as const;
    }

    const firstUserId = await getFirstUserId(ctx);
    const allowed = Boolean(firstUserId && identity.subject === firstUserId);

    return {
      allowed,
    };
  },
});

export const getOverview = query({
  args: {},
  handler: async (ctx) => {
    await ensureAdmin(ctx);

    const now = Date.now();
    const sevenDaysAgo = now - SEVEN_DAYS_IN_MS;
    const thirtyDaysAgo = now - THIRTY_DAYS_IN_MS;

    const typeCounts: Record<string, number> = {};
    const metadataStatusCounts: Record<
      "pending" | "completed" | "failed" | "unset",
      number
    > = {
      pending: 0,
      completed: 0,
      failed: 0,
      unset: 0,
    };

    const stageSummaries: Record<ProcessingStageKey, StageSummary> =
      STAGE_KEYS.reduce(
        (acc, key) => {
          acc[key] = { pending: 0, inProgress: 0, failed: 0 };
          return acc;
        },
        {} as Record<ProcessingStageKey, StageSummary>
      );

    let totalCards = 0;
    let activeCards = 0;
    let deletedCards = 0;
    let createdLastSevenDays = 0;
    let createdLastThirtyDays = 0;
    let missingAiMetadata = 0;
    let pendingEnrichment = 0;
    let failedCards = 0;
    const missingCards: MissingCardSummary[] = [];

    const uniqueUsers = new Set<string>();

    // Use .take() with limit instead of unbounded .collect() to prevent memory issues
    // For production at scale, consider denormalizing these counts into a separate table
    const cards = await ctx.db.query("cards").take(ADMIN_OVERVIEW_LIMIT);
    const isLimitReached = cards.length === ADMIN_OVERVIEW_LIMIT;

    for (const card of cards) {
      totalCards += 1;
      const isDeleted = card.isDeleted === true;
      if (isDeleted) {
        deletedCards += 1;
      } else {
        activeCards += 1;
      }

      uniqueUsers.add(card.userId);

      if (card.createdAt >= sevenDaysAgo && !isDeleted) {
        createdLastSevenDays += 1;
      }

      if (card.createdAt >= thirtyDaysAgo && !isDeleted) {
        createdLastThirtyDays += 1;
      }

      const typeKey = card.type ?? "unknown";
      typeCounts[typeKey] = (typeCounts[typeKey] ?? 0) + 1;

      if (!isDeleted) {
        if (card.metadataStatus === "pending") {
          metadataStatusCounts.pending += 1;
        } else if (card.metadataStatus === "completed") {
          metadataStatusCounts.completed += 1;
        } else if (card.metadataStatus === "failed") {
          metadataStatusCounts.failed += 1;
        } else {
          metadataStatusCounts.unset += 1;
        }
      }

      const reasons: string[] = [];

      const hasAiSummary = Boolean(card.aiSummary);
      const hasAiTags = Boolean(card.aiTags && card.aiTags.length > 0);
      const hasAiTranscript = Boolean(card.aiTranscript);
      const hasAnyAiMetadata = hasAiSummary || hasAiTags || hasAiTranscript;

      if (!hasAnyAiMetadata) {
        if (!isDeleted) {
          missingAiMetadata += 1;
        }
        reasons.push("AI metadata missing");
      }

      if (!hasAiSummary) {
        reasons.push("AI summary missing");
      }

      if (!hasAiTags) {
        reasons.push("AI tags missing");
      }

      if (card.type === "link" && card.metadataStatus === "pending") {
        reasons.push("Link metadata still pending");
      }

      if (
        !isDeleted &&
        reasons.length > 0 &&
        missingCards.length < MAX_MISSING_CARDS
      ) {
        missingCards.push({
          cardId: card._id,
          type: card.type,
          createdAt: card.createdAt,
          metadataStatus: card.metadataStatus,
          processingStatus: card.processingStatus,
          reasons,
        });
      }

      const processing = card.processingStatus;
      if (processing) {
        let hasFailure = false;
        for (const stageKey of STAGE_KEYS) {
          const stageStatus = processing[stageKey];
          if (!stageStatus) {
            continue;
          }

          if (stageStatus.status === "failed") {
            stageSummaries[stageKey].failed += 1;
            hasFailure = true;
          } else if (stageStatus.status === "pending") {
            stageSummaries[stageKey].pending += 1;
          } else if (stageStatus.status === "in_progress") {
            stageSummaries[stageKey].inProgress += 1;
          }
        }

        if (hasFailure && !isDeleted) {
          failedCards += 1;
        }

        if (
          !isDeleted &&
          STAGE_KEYS.some((stageKey) => {
            const stageStatus = processing[stageKey];
            return (
              stageStatus &&
              (stageStatus.status === "pending" ||
                stageStatus.status === "in_progress")
            );
          })
        ) {
          pendingEnrichment += 1;
        }
      }
    }

    return {
      generatedAt: now,
      totals: {
        totalCards,
        activeCards,
        deletedCards,
        uniqueUsers: uniqueUsers.size,
      },
      growth: {
        createdLastSevenDays,
        createdLastThirtyDays,
      },
      cardsByType: typeCounts,
      metadataStatus: metadataStatusCounts,
      aiPipeline: {
        missingAiMetadata,
        pendingEnrichment,
        failedCards,
        stageSummaries,
        missingCards,
      },
      // Warn if we hit the limit - counts may be incomplete
      isApproximate: isLimitReached,
    };
  },
});

export const listAllCards = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { paginationOpts }) => {
    await ensureAdmin(ctx);

    const safePagination = clampPagination(paginationOpts);

    const result = await ctx.db
      .query("cards")
      .order("desc")
      .paginate(safePagination);

    const page = await attachCardUrls(ctx, result.page);

    return {
      ...result,
      page,
    };
  },
});

const normalizeUserId = (user: Record<string, unknown>) =>
  (user as { _id?: string; id?: string; userId?: string; subject?: string })
    ._id ??
  (user as { _id?: string; id?: string; userId?: string; subject?: string })
    .id ??
  (user as { _id?: string; id?: string; userId?: string; subject?: string })
    .userId ??
  (user as { _id?: string; id?: string; userId?: string; subject?: string })
    .subject ??
  null;

export const listAllUsers = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { paginationOpts }) => {
    await ensureAdmin(ctx);

    const safePagination = clampPagination(paginationOpts);

    const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "user",
      sortBy: { field: "createdAt", direction: "desc" },
      limit: safePagination.numItems,
      paginationOpts: safePagination,
    })) as {
      page?: Record<string, unknown>[];
      continueCursor?: string | null;
      isDone?: boolean;
    };

    const page = await Promise.all(
      (result.page ?? []).map(async (user) => {
        const id = normalizeUserId(user);
        const cardsCount = id ? await getActiveCardCountForUser(ctx, id) : 0;

        return {
          id,
          email: (user as { email?: string }).email ?? null,
          name: (user as { name?: string }).name ?? null,
          image: (user as { image?: string | null }).image ?? null,
          createdAt: (user as { createdAt?: number }).createdAt ?? null,
          updatedAt: (user as { updatedAt?: number }).updatedAt ?? null,
          emailVerified:
            (user as { emailVerified?: boolean }).emailVerified ?? null,
          isAnonymous: (user as { isAnonymous?: boolean }).isAnonymous ?? null,
          displayUsername:
            (user as { displayUsername?: string | null }).displayUsername ??
            null,
          username: (user as { username?: string | null }).username ?? null,
          phoneNumber:
            (user as { phoneNumber?: string | null }).phoneNumber ?? null,
          phoneNumberVerified:
            (user as { phoneNumberVerified?: boolean }).phoneNumberVerified ??
            null,
          twoFactorEnabled:
            (user as { twoFactorEnabled?: boolean }).twoFactorEnabled ?? null,
          cardsCount,
        };
      })
    );

    return {
      ...result,
      page,
    };
  },
});

type BackfillSummary = {
  requestedAt: number;
  enqueuedCount: number;
  pendingSampleCount: number;
  failedCardIds: Id<"cards">[];
};

type PendingSample = { cardId: Id<"cards"> };
type AiBackfillWorkflowResult = {
  enqueuedCount: number;
  failedCardIds: Id<"cards">[];
};

export const resetCardProcessingState = internalMutation({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    clearedThumbnail: v.boolean(),
  }),
  handler: async (ctx, { cardId }) => {
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      throw new Error(`Card ${cardId} not found`);
    }

    let clearedThumbnail = false;
    if (card.thumbnailId) {
      try {
        await ctx.storage.delete(card.thumbnailId);
      } catch (error) {
        console.error("[admin] Failed to delete thumbnail during refresh", {
          cardId,
          thumbnailId: card.thumbnailId,
          error,
        });
      }
      clearedThumbnail = true;
    }

    const processingStatus = card.processingStatus ?? {};
    const updatedProcessing = {
      ...processingStatus,
      classify: stagePending(),
    };

    await ctx.db.patch("cards", cardId, {
      thumbnailId: undefined,
      aiTags: undefined,
      aiSummary: undefined,
      aiTranscript: undefined,
      processingStatus: updatedProcessing,
      updatedAt: Date.now(),
    });

    return {
      clearedThumbnail,
    };
  },
});

export const retryAiBackfill = action({
  args: {},
  handler: async (ctx): Promise<BackfillSummary> => {
    await ensureAdmin(ctx);

    const workflowResult = (await ctx.runMutation(
      internal.workflows.aiBackfill.startAiBackfillWorkflow,
      { startAsync: false }
    )) as AiBackfillWorkflowResult | { workflowId: string };

    const normalizedResult: AiBackfillWorkflowResult =
      "workflowId" in workflowResult
        ? { enqueuedCount: 0, failedCardIds: [] }
        : workflowResult;

    // Retrieve a sample of outstanding cards to provide context without exposing IDs
    const pendingSample = (await ctx.runQuery(
      internal.ai.queries.findCardsMissingAi,
      {}
    )) as PendingSample[];

    return {
      requestedAt: Date.now(),
      enqueuedCount: normalizedResult.enqueuedCount,
      pendingSampleCount: pendingSample.length,
      failedCardIds: normalizedResult.failedCardIds,
    };
  },
});

export const refreshCardProcessing = action({
  args: {
    cardId: v.id("cards"),
  },
  handler: async (
    ctx,
    { cardId }
  ): Promise<{
    requestedAt: number;
    success: boolean;
    reason?: "not_found";
  }> => {
    await ensureAdmin(ctx);

    const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
      cardId,
    });

    if (!card) {
      return {
        requestedAt: Date.now(),
        success: false,
        reason: "not_found",
      };
    }

    await ctx.runMutation((internal as any).admin.resetCardProcessingState, {
      cardId,
    });

    await ctx.scheduler.runAfter(
      0,
      (internal as any)["workflows/manager"].startCardProcessingWorkflow,
      { cardId }
    );

    return {
      requestedAt: Date.now(),
      success: true,
    };
  },
});
