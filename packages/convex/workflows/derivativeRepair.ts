import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalQuery } from "../_generated/server";

const REPAIR_BATCH_SIZE = 10;
const REPAIR_SCAN_SIZE = 50;

export const oldestImageCandidates = internalQuery({
  args: {},
  returns: v.array(v.id("cards")),
  handler: async (ctx) => {
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_type_derivative_checked", (query) =>
        query.eq("type", "image")
      )
      .order("asc")
      .take(REPAIR_SCAN_SIZE);
    return cards
      .filter((card) => !card.isDeleted && Boolean(card.fileKey))
      .slice(0, REPAIR_BATCH_SIZE)
      .map((card) => card._id);
  },
});

export const repairImageDerivatives = internalAction({
  args: {},
  returns: v.object({ scheduled: v.number() }),
  handler: async (ctx) => {
    const cardIds = await ctx.runQuery(
      internal.workflows.derivativeRepair.oldestImageCandidates,
      {}
    );
    for (const cardId of cardIds) {
      await ctx.scheduler.runAfter(
        0,
        internal.workflows.steps.renderables.generate,
        { cardId, cardType: "image" }
      );
    }
    return { scheduled: cardIds.length };
  },
});
