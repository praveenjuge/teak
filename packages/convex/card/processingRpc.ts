import { CARD_RUN_STAGES } from "@teak/files-protocol";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { getR2KeyPrefix } from "../storage/r2Keys";
import { patchCard } from "./cardWrites";
import {
  mergeProcessingStages,
  type ProcessingStatus,
  stageInProgress,
} from "./processingStatus";

export const getCardForProcessing = internalQuery({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    const card = await ctx.db.get("cards", cardId);
    return card ? { card, keyPrefix: getR2KeyPrefix() } : null;
  },
});

// The stages a run marks in progress, as files-protocol lists them.
const stageKeyValidator = v.union(
  ...CARD_RUN_STAGES.map((stage) => v.literal(stage))
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
    return await patchCard(ctx, cardId, {
      processingStatus: mergeProcessingStages(current, updates),
    });
  },
});
