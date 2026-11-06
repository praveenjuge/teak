import { type Infer, v } from "convex/values";

/** The most cards one bulk action changes; clients send more in chunks. */
export const MAX_BULK_CARD_IDS = 100;

/** What one bulk action does to every card it names. */
export const bulkCardActionValidator = v.union(
  v.literal("favorite"),
  v.literal("unfavorite"),
  v.literal("archive"),
  v.literal("unarchive"),
  v.literal("addTags"),
  v.literal("removeTags"),
  v.literal("delete"),
  v.literal("restore"),
  v.literal("addToFolder"),
  v.literal("removeFromFolder"),
  v.literal("moveToFolder")
);

export type BulkCardAction = Infer<typeof bulkCardActionValidator>;
