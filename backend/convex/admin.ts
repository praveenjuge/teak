import { action, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type {
  ProcessingStageKey,
  ProcessingStatus,
} from "./tasks/cards/processingStatus";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

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

const adminIdsEnv =
  process.env.ADMIN_USERID ??
  process.env.ADMIN_USERIDS ??
  process.env.NEXT_PUBLIC_ADMIN_USERID ??
  "";

const ADMIN_USER_IDS = adminIdsEnv
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

const ensureAdmin = (identity: any) => {
  if (!identity || ADMIN_USER_IDS.length === 0) {
    throw new Error("Unauthorized");
  }

  if (!ADMIN_USER_IDS.includes(identity.subject)) {
    throw new Error("Unauthorized");
  }
};

export const getAccess = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const allowed =
      !!identity &&
      ADMIN_USER_IDS.length > 0 &&
      ADMIN_USER_IDS.includes(identity.subject);

    return {
      allowed,
    };
  },
});

export const getOverview = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    ensureAdmin(identity);

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
      STAGE_KEYS.reduce((acc, key) => {
        acc[key] = { pending: 0, inProgress: 0, failed: 0 };
        return acc;
      }, {} as Record<ProcessingStageKey, StageSummary>);

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

    const cards = await ctx.db.query("cards").collect();

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

      if (!card.aiModelMeta) {
        if (!isDeleted) {
          missingAiMetadata += 1;
        }
        reasons.push("AI metadata missing");
      }

      if (!card.aiSummary) {
        reasons.push("AI summary missing");
      }

      if (!card.aiTags || card.aiTags.length === 0) {
        reasons.push("AI tags missing");
      }

      if (
        card.type === "link" &&
        card.metadataStatus === "pending"
      ) {
        reasons.push("Link metadata still pending");
      }

      if (!isDeleted && reasons.length > 0 && missingCards.length < MAX_MISSING_CARDS) {
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
    };
  },
});

type BackfillSummary = {
  requestedAt: number;
  enqueuedCount: number;
  pendingSampleCount: number;
  error?: string;
};

type EnqueueResult = {
  enqueuedCount: number;
  error?: string;
};

type PendingSample = { cardId: Id<"cards"> };

export const retryAiBackfill = action({
  args: {},
  handler: async (ctx): Promise<BackfillSummary> => {
    const identity = await ctx.auth.getUserIdentity();
    ensureAdmin(identity);

    const result = (await ctx.runAction(
      internal.tasks.ai.actions.enqueueMissingAiGeneration,
      {}
    )) as EnqueueResult;

    // Retrieve a sample of outstanding cards to provide context without exposing IDs
    const pendingSample = (await ctx.runQuery(
      internal.tasks.ai.queries.findCardsMissingAi,
      {}
    )) as PendingSample[];

    return {
      requestedAt: Date.now(),
      enqueuedCount: result.enqueuedCount,
      pendingSampleCount: pendingSample.length,
      error: result.error,
    };
  },
});

export const retryCardEnrichment = action({
  args: {
    cardId: v.id("cards"),
  },
  handler: async (
    ctx,
    { cardId }
  ): Promise<{ requestedAt: number; success: boolean; reason?: "not_found" }> => {
    const identity = await ctx.auth.getUserIdentity();
    ensureAdmin(identity);

    const card = await ctx.runQuery(internal.tasks.ai.queries.getCardForAI, {
      cardId,
    });

    if (!card) {
      return {
        requestedAt: Date.now(),
        success: false,
        reason: "not_found",
      };
    }

    await ctx.scheduler.runAfter(
      0,
      internal.tasks.ai.actions.startProcessingPipeline,
      { cardId }
    );

    return {
      requestedAt: Date.now(),
      success: true,
    };
  },
});
