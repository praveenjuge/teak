import { AI_PIPELINE_STAGES } from "@teak/files-protocol";
import { v } from "convex/values";
import {
  fieldsFor,
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
    stageSummaries: v.object(
      fieldsFor(AI_PIPELINE_STAGES, stageSummaryValidator)
    ),
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

export const snapshotBillingValidator = v.object({
  currency: v.string(),
  mrr: v.number(),
  mrrAtRisk: v.number(),
  netMrr: v.number(),
  paying: v.number(),
  trialing: v.number(),
  pastDue: v.number(),
  canceling: v.number(),
});

/**
 * An `adminDailyMetrics` row, apart from the retired totals that
 * `.agents/records/sunset.md` drops from the writer and the table in turn.
 */
export const adminDailyMetricFields = {
  date: v.string(),
  capturedAt: v.number(),
  accounts: v.number(),
  signups: v.number(),
  cardsSaved: v.number(),
  activeSavers1d: v.number(),
  activeSavers7d: v.number(),
  activeSavers28d: v.number(),
  storageBytesAdded: v.number(),
  aiCostUsd: v.number(),
  aiCalls: v.number(),
  billing: v.optional(snapshotBillingValidator),
  isApproximate: v.boolean(),
};
