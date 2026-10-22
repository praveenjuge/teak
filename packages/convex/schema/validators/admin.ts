import { v } from "convex/values";
import {
  metadataStatusValidator,
  processingStatusValidator,
  stageSummaryValidator,
} from "./cards";

/** `admin:getOverview`'s result (`AdminOverview` in admin/stats.ts). */
export const adminOverviewFields = {
  generatedAt: v.number(),
  totals: v.object({
    totalCards: v.number(),
    activeCards: v.number(),
    deletedCards: v.number(),
    uniqueUsers: v.number(),
  }),
  growth: v.object({
    createdLastSevenDays: v.number(),
    createdLastThirtyDays: v.number(),
  }),
  cardsByType: v.record(v.string(), v.number()),
  metadataStatus: v.object({
    pending: v.number(),
    completed: v.number(),
    failed: v.number(),
    unset: v.number(),
  }),
  aiPipeline: v.object({
    missingAiMetadata: v.number(),
    pendingEnrichment: v.number(),
    failedCards: v.number(),
    stageSummaries: v.object({
      classify: stageSummaryValidator,
      categorize: stageSummaryValidator,
      metadata: stageSummaryValidator,
      renderables: stageSummaryValidator,
    }),
    missingCards: v.array(
      v.object({
        cardId: v.id("cards"),
        type: v.string(),
        createdAt: v.number(),
        metadataStatus: v.optional(metadataStatusValidator),
        processingStatus: processingStatusValidator,
        reasons: v.array(v.string()),
      })
    ),
  }),
  isApproximate: v.boolean(),
};
