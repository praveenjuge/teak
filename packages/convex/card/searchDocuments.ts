import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import {
  syncCardSearchDocumentHandler,
  syncCardSearchTagsBatchHandler,
} from "./searchDocumentHelpers";

export const syncCardSearchDocument = internalMutation({
  args: { cardId: v.id("cards") },
  returns: v.null(),
  handler: (ctx, { cardId }) => syncCardSearchDocumentHandler(ctx, cardId),
});

export const syncCardSearchTagsBatch = internalMutation({
  args: { cardId: v.id("cards") },
  returns: v.object({
    complete: v.boolean(),
    processed: v.number(),
    writes: v.number(),
  }),
  handler: (ctx, { cardId }) => syncCardSearchTagsBatchHandler(ctx, cardId),
});
