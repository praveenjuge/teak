import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "../_generated/server";
import { getAccountDeletionState } from "../accountDeletion";
import { getSessionUser, requireTeakUserId } from "../securitySessions";

export const TAG_SUMMARY_DEBOUNCE_MS = 15_000;
const TAG_SUMMARY_STALE_MS = 5 * 60_000;
export const TAG_SUMMARY_PAGE_ROWS = 4000;
export const TAG_SUMMARY_MAX_PAGES = 60;
export const MAX_TAG_SUMMARY_ITEMS = 3000;

export const tagSummaryItemValidator = v.object({
  name: v.string(),
  count: v.number(),
});

export const tagSummaryValidator = v.object({
  items: v.array(tagSummaryItemValidator),
  isComplete: v.boolean(),
  computedAt: v.number(),
});

interface TagCount {
  count: number;
  name: string;
}

const pendingRefresh = (ctx: QueryCtx, userId: string) =>
  ctx.db
    .query("tagSummaryRefreshes")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();

export const markTagSummaryDirty = async (
  ctx: MutationCtx,
  userId: string,
  delayMs = TAG_SUMMARY_DEBOUNCE_MS
) => {
  if (await getAccountDeletionState(ctx, userId)) {
    return;
  }
  const now = Date.now();
  const pending = await pendingRefresh(ctx, userId);
  if (
    pending &&
    pending.dueAt + TAG_SUMMARY_STALE_MS > now &&
    pending.dueAt <= now + delayMs
  ) {
    return;
  }
  if (pending) {
    await ctx.db.patch("tagSummaryRefreshes", pending._id, {
      dueAt: now + delayMs,
    });
  } else {
    await ctx.db.insert("tagSummaryRefreshes", {
      userId,
      dueAt: now + delayMs,
    });
  }
  await ctx.scheduler.runAfter(
    delayMs,
    internal.tag.tagSummary.recomputeTagSummary,
    { userId }
  );
};

const sortTagCounts = (items: TagCount[]): TagCount[] =>
  items.sort((left, right) =>
    left.count === right.count
      ? left.name.localeCompare(right.name)
      : right.count - left.count
  );

export const countTagSummaryPage = internalQuery({
  args: { userId: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    counts: v.array(tagSummaryItemValidator),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { userId, cursor }) => {
    const page = await ctx.db
      .query("cardSearchTags")
      .withIndex("by_user_tag_deleted_archived_created_v2", (q) =>
        q.eq("userId", userId)
      )
      .paginate({ cursor, numItems: TAG_SUMMARY_PAGE_ROWS });
    const counts = new Map<string, number>();
    for (const row of page.page) {
      if (row.isDeleted === undefined && row.isArchived === undefined) {
        counts.set(row.tag, (counts.get(row.tag) ?? 0) + 1);
      }
    }
    return {
      counts: Array.from(counts, ([name, count]) => ({ name, count })),
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const claimTagSummaryRefresh = internalMutation({
  args: { userId: v.string() },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { userId }) => {
    if (await getAccountDeletionState(ctx, userId)) {
      return null;
    }
    const pending = await pendingRefresh(ctx, userId);
    if (!pending) {
      return null;
    }
    await ctx.db.delete("tagSummaryRefreshes", pending._id);
    return Date.now();
  },
});

export const writeTagSummary = internalMutation({
  args: {
    userId: v.string(),
    items: v.array(tagSummaryItemValidator),
    isComplete: v.boolean(),
    claimedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { userId, items, isComplete, claimedAt }) => {
    if (await getAccountDeletionState(ctx, userId)) {
      return null;
    }
    const value = { userId, items, isComplete, computedAt: claimedAt };
    const existing = await ctx.db
      .query("userTagSummaries")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (existing && existing.computedAt > claimedAt) {
      return null;
    }
    if (existing) {
      await ctx.db.replace("userTagSummaries", existing._id, value);
    } else {
      await ctx.db.insert("userTagSummaries", value);
    }
    return null;
  },
});

export const recomputeTagSummary = internalAction({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const claimedAt: number | null = await ctx.runMutation(
      internal.tag.tagSummary.claimTagSummaryRefresh,
      { userId }
    );
    if (claimedAt === null) {
      return null;
    }
    const totals = new Map<string, number>();
    let cursor: string | null = null;
    let isDone = false;
    let pages = 0;
    while (!isDone && pages < TAG_SUMMARY_MAX_PAGES) {
      const page: {
        counts: TagCount[];
        continueCursor: string | null;
      } = await ctx.runQuery(internal.tag.tagSummary.countTagSummaryPage, {
        userId,
        cursor,
      });
      for (const { name, count } of page.counts) {
        totals.set(name, (totals.get(name) ?? 0) + count);
      }
      cursor = page.continueCursor;
      isDone = cursor === null;
      pages += 1;
    }
    const items = sortTagCounts(
      Array.from(totals, ([name, count]) => ({ name, count }))
    );
    await ctx.runMutation(internal.tag.tagSummary.writeTagSummary, {
      userId,
      items: items.slice(0, MAX_TAG_SUMMARY_ITEMS),
      isComplete: isDone && items.length <= MAX_TAG_SUMMARY_ITEMS,
      claimedAt,
    });
    return null;
  },
});

export const getTagSummaryForUser = internalQuery({
  args: { userId: v.string() },
  returns: v.union(tagSummaryValidator, v.null()),
  handler: async (ctx, { userId }) => {
    const owner = await requireTeakUserId(ctx, userId);
    const summary = await ctx.db
      .query("userTagSummaries")
      .withIndex("by_userId", (q) => q.eq("userId", owner))
      .first();
    return summary
      ? {
          items: summary.items,
          isComplete: summary.isComplete,
          computedAt: summary.computedAt,
        }
      : null;
  },
});

export const requestTagSummaryForUser = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const owner = await requireTeakUserId(ctx, userId);
    const existing = await ctx.db
      .query("userTagSummaries")
      .withIndex("by_userId", (q) => q.eq("userId", owner))
      .first();
    if (!existing) {
      await markTagSummaryDirty(ctx, owner, 0);
    }
    return null;
  },
});

export const listTagSummary = query({
  args: {},
  returns: v.union(tagSummaryValidator, v.null()),
  handler: async (ctx) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return null;
    }
    const summary = await ctx.db
      .query("userTagSummaries")
      .withIndex("by_userId", (q) => q.eq("userId", user.teakUserId))
      .first();
    return summary
      ? {
          items: summary.items,
          isComplete: summary.isComplete,
          computedAt: summary.computedAt,
        }
      : null;
  },
});

export const requestTagSummary = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return null;
    }
    const existing = await ctx.db
      .query("userTagSummaries")
      .withIndex("by_userId", (q) => q.eq("userId", user.teakUserId))
      .first();
    if (!existing) {
      await markTagSummaryDirty(ctx, user.teakUserId, 0);
    }
    return null;
  },
});
