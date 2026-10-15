import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { syncCardSearchTagsBatchHandler } from "./searchDocumentHelpers";

export const syncCardSearchTagsBatch = internalMutation({
  args: {
    cardId: v.id("cards"),
    userId: v.optional(v.string()),
    generation: v.optional(v.number()),
  },
  returns: v.object({
    complete: v.boolean(),
    processed: v.number(),
    writes: v.number(),
  }),
  handler: (ctx, { cardId, userId, generation }) =>
    syncCardSearchTagsBatchHandler(ctx, cardId, userId, generation),
});
