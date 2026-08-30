import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { syncCardSearchDocumentHandler } from "./searchDocumentHelpers";

export const syncCardSearchDocument = internalMutation({
  args: { cardId: v.id("cards") },
  returns: v.null(),
  handler: (ctx, { cardId }) => syncCardSearchDocumentHandler(ctx, cardId),
});
