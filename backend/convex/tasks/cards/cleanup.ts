import { internalMutation } from "../../_generated/server";

// Internal mutation for scheduled cleanup
export const cleanupOldDeletedCards = internalMutation({
  args: {},
  handler: async (ctx) => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

    // Find cards that were soft-deleted more than 30 days ago
    const cardsToCleanup = await ctx.db
      .query("cards")
      .filter((q) =>
        q.and(
          q.eq(q.field("isDeleted"), true),
          q.lt(q.field("deletedAt"), thirtyDaysAgo)
        )
      )
      .collect();

    let cleanedCount = 0;

    for (const card of cardsToCleanup) {
      try {
        // Delete associated files if they exist
        if (card.fileId) {
          await ctx.storage.delete(card.fileId);
        }
        if (card.thumbnailId) {
          await ctx.storage.delete(card.thumbnailId);
        }

        // Permanently delete from database
        await ctx.db.delete(card._id);
        cleanedCount++;
      } catch (error) {
        console.error(`Failed to cleanup card ${card._id}:`, error);
      }
    }

    console.log(
      `Cleaned up ${cleanedCount} cards that were deleted more than 30 days ago`
    );
    return { cleanedCount };
  },
});