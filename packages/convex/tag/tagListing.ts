/**
 * `GET /v1/tags`: every tag a person uses with its count of active cards, by
 * key. A settled tag summary answers when there is one; otherwise the tags
 * are counted live, and a library with too many to count in one read
 * answers from the stored summary, or asks for one to be made.
 */
import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { requireTeakUserId } from "../securitySessions";

/** Most `cardSearchTags` rows one live count reads. */
const MAX_TAG_ROWS_READ = 8000;
// Most distinct tags one live count reaches. Each is two index lookups, and
// a function may only make so many, so a vault of many small tags stops
// here and the listing answers from the background tag summary.
const MAX_TAGS_READ = 500;

export interface TagCountItem {
  count: number;
  name: string;
}

export interface TagListing {
  isComplete: boolean;
  items: TagCountItem[];
}

const tagCountItemValidator = v.object({
  name: v.string(),
  count: v.number(),
});

const byCountThenName = (left: TagCountItem, right: TagCountItem) =>
  left.count === right.count
    ? left.name.localeCompare(right.name)
    : right.count - left.count;

/**
 * Counts each tag's active cards (not archived, not in Trash) from the
 * search index, within the read bounds above. `isComplete` is false when a
 * bound stopped the count before the last tag.
 */
export const countTagsLive = async (
  ctx: Pick<QueryCtx, "db">,
  userId: string
): Promise<TagListing> => {
  const counts: TagCountItem[] = [];
  let budget = MAX_TAG_ROWS_READ;
  let tagsLeft = MAX_TAGS_READ;
  let isComplete = true;
  let previousTag: string | undefined;

  const nextTag = (afterTag: string | undefined) =>
    ctx.db
      .query("cardSearchTags")
      .withIndex("by_user_tag_deleted_saved", (query) =>
        afterTag === undefined
          ? query.eq("userId", userId)
          : query.eq("userId", userId).gt("tag", afterTag)
      )
      .first();

  while (isComplete) {
    if (tagsLeft <= 0) {
      isComplete = (await nextTag(previousTag)) === null;
      break;
    }
    tagsLeft -= 1;
    const next = await nextTag(previousTag);
    if (!next) {
      break;
    }
    budget -= 1;
    previousTag = next.tag;

    let count = 0;
    const activeRows = ctx.db
      .query("cardSearchTags")
      .withIndex("by_user_tag_deleted_archived_saved", (query) =>
        query
          .eq("userId", userId)
          .eq("tag", next.tag)
          .eq("isDeleted", undefined)
          .eq("isArchived", undefined)
      );
    for await (const _row of activeRows) {
      if (budget <= 0) {
        isComplete = false;
        break;
      }
      budget -= 1;
      count += 1;
    }
    if (count > 0) {
      counts.push({ name: next.tag, count });
    }
    if (budget <= 0) {
      isComplete = false;
    }
  }

  return { items: counts.sort(byCountThenName), isComplete };
};

const readTagSummary = (ctx: Pick<QueryCtx, "db">, userId: string) =>
  ctx.db
    .query("userTagSummaries")
    .withIndex("by_userId", (query) => query.eq("userId", userId))
    .first();

// The API lists tags by key; the casing a tag was typed in isn't part of its
// contract.
const byKey = (items: readonly TagCountItem[]): TagCountItem[] =>
  items.map(({ name, count }) => ({ name, count }));

/**
 * The tag summary's items when it is complete and no refresh is waiting, so
 * they match a live count; otherwise null.
 */
export const readSettledTagSummary = async (
  ctx: Pick<QueryCtx, "db">,
  userId: string
): Promise<TagCountItem[] | null> => {
  const summary = await readTagSummary(ctx, userId);
  if (!summary?.isComplete) {
    return null;
  }
  const pendingRefresh = await ctx.db
    .query("tagSummaryRefreshes")
    .withIndex("by_userId", (query) => query.eq("userId", userId))
    .first();
  return pendingRefresh ? null : byKey(summary.items);
};

/**
 * One person's tags for `GET /v1/tags`. `requestSummary` is true when the
 * live count stopped early and there is no summary to answer from yet: the
 * caller then asks for one (`requestTagSummaryForUser`) so a later listing
 * is complete.
 */
export const listTagsForUser = internalQuery({
  args: { userId: v.string() },
  returns: v.object({
    items: v.array(tagCountItemValidator),
    isComplete: v.boolean(),
    requestSummary: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const settled = await readSettledTagSummary(ctx, userId);
    if (settled) {
      return { items: settled, isComplete: true, requestSummary: false };
    }
    const live = await countTagsLive(ctx, userId);
    if (live.isComplete) {
      return { ...live, requestSummary: false };
    }
    const summary = await readTagSummary(ctx, userId);
    return summary
      ? {
          items: byKey(summary.items),
          isComplete: summary.isComplete,
          requestSummary: false,
        }
      : { ...live, requestSummary: true };
  },
});
