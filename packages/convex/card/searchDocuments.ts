import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import {
  syncCardSearchDocumentHandler,
  syncCardSearchTagsBatchHandler,
} from "./searchDocumentHelpers";

export const syncCardSearchDocument = internalMutation({
  args: { cardId: v.id("cards"), userId: v.optional(v.string()) },
  returns: v.null(),
  handler: (ctx, { cardId, userId }) =>
    syncCardSearchDocumentHandler(ctx, cardId, userId),
});

export const syncCardSearchTagsBatch = internalMutation({
  args: { cardId: v.id("cards"), userId: v.optional(v.string()) },
  returns: v.object({
    complete: v.boolean(),
    processed: v.number(),
    writes: v.number(),
  }),
  handler: (ctx, { cardId, userId }) =>
    syncCardSearchTagsBatchHandler(ctx, cardId, userId),
});
