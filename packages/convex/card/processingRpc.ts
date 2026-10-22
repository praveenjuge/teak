import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { getR2KeyPrefix } from "../storage/r2Keys";
import {
  mergeProcessingStages,
  type ProcessingStatus,
  stageInProgress,
} from "./processingStatus";
import { patchCardWithSearchSync } from "./searchSync";

export const getCardForProcessing = internalQuery({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    const card = await ctx.db.get("cards", cardId);
    return card ? { card, keyPrefix: getR2KeyPrefix() } : null;
  },
});

const stageKeyValidator = v.union(
  v.literal("classify"),
  v.literal("categorize"),
  v.literal("metadata"),
  v.literal("renderables"),
  v.literal("screenshot")
);

export const markStagesInProgress = internalMutation({
  args: { cardId: v.id("cards"), stages: v.array(stageKeyValidator) },
  returns: v.boolean(),
  handler: async (ctx, { cardId, stages }) => {
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      return false;
    }
    const now = Date.now();
    const current = card.processingStatus;
    const updates: ProcessingStatus = {};
    for (const stage of stages) {
      updates[stage] = stageInProgress(now, current?.[stage]);
    }
    return await patchCardWithSearchSync(ctx, cardId, {
      processingStatus: mergeProcessingStages(current, updates),
    });
  },
});
