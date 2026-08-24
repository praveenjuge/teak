import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";

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

export const markCandidatesChecked = internalMutation({
  args: { cardIds: v.array(v.id("cards")) },
  returns: v.null(),
  handler: async (ctx, { cardIds }) => {
    const checkedAt = Date.now();
    for (const cardId of cardIds) {
      const card = await ctx.db.get("cards", cardId);
      if (card?.type === "image" && !card.isDeleted && card.fileKey) {
        await ctx.db.patch("cards", cardId, { derivativeCheckedAt: checkedAt });
      }
    }
    return null;
  },
});

export const repairImageDerivativesHandler = async (
  ctx: Pick<ActionCtx, "runMutation" | "runQuery" | "scheduler">
): Promise<{ scheduled: number }> => {
  const cardIds = await ctx.runQuery(
    internal.workflows.derivativeRepair.oldestImageCandidates,
    {}
  );
  if (cardIds.length > 0) {
    // Advance every attempted card before scheduling. A permanently invalid
    // source can then retry in a later rotation without starving newer cards.
    await ctx.runMutation(
      internal.workflows.derivativeRepair.markCandidatesChecked,
      { cardIds }
    );
  }
  for (const cardId of cardIds) {
    await ctx.scheduler.runAfter(
      0,
      internal.workflows.steps.renderables.generate,
      { cardId, cardType: "image" }
    );
  }
  return { scheduled: cardIds.length };
};

export const repairImageDerivatives = internalAction({
  args: {},
  returns: v.object({ scheduled: v.number() }),
  handler: repairImageDerivativesHandler,
});
