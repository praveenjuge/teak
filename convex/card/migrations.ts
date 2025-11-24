import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

// Migration function to backfill metadata search fields for existing cards
export const backfillMetadataSearchFields = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, { batchSize = 100 }) => {
    // Get cards that have metadata but don't have metadataTitle/metadataDescription
    const cards = await ctx.db
      .query("cards")
      .filter((q) =>
        q.and(
          q.neq(q.field("metadata"), undefined),
          q.or(
            q.eq(q.field("metadataTitle"), undefined),
            q.eq(q.field("metadataDescription"), undefined)
          )
        )
      )
      .take(batchSize);

    let updatedCount = 0;

    for (const card of cards) {
      if (card.metadata) {
        const updateFields: any = { updatedAt: Date.now() };
        const linkPreview =
          card.metadata.linkPreview?.status === "success"
            ? card.metadata.linkPreview
            : undefined;

        // Populate metadataTitle if missing
        if (!card.metadataTitle) {
          const title = linkPreview?.title;
          if (title) {
            updateFields.metadataTitle = title;
          }
        }

        // Populate metadataDescription if missing
        if (!card.metadataDescription) {
          const description = linkPreview?.description;
          if (description) {
            updateFields.metadataDescription = description;
          }
        }

        // Only update if we have fields to update
        if (Object.keys(updateFields).length > 1) {
          await ctx.db.patch(card._id, updateFields);
          updatedCount++;
        }
      }
    }

    console.log(`Backfilled metadata search fields for ${updatedCount} cards`);
    return { updatedCount, hasMore: cards.length === batchSize };
  },
});
