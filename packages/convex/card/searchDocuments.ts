import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import {
  syncCardSearchDocumentHandler,
  syncCardSearchTagsBatchHandler,
} from "./searchDocumentHelpers";

// Legacy entry point: app code now syncs search documents inline via
// scheduleCardSearchSync (see searchDocumentHelpers), so nothing schedules
// this mutation anymore. It stays registered so invocations queued before
// the cutover still run.
export const syncCardSearchDocument = internalMutation({
  args: { cardId: v.id("cards"), userId: v.optional(v.string()) },
  returns: v.null(),
  handler: (ctx, { cardId, userId }) =>
    syncCardSearchDocumentHandler(ctx, cardId, userId),
});

export const syncCardSearchTagsBatch = internalMutation({
  args: {
    cardId: v.id("cards"),
    userId: v.optional(v.string()),
    // Generation the invocation was scheduled for; stale invocations exit
    // without writing (see syncCardSearchTagsBatchHandler).
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
