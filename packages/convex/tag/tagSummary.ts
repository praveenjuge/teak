import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
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

/** How long after a tag change the snapshot is recomputed. */
export const TAG_SUMMARY_DEBOUNCE_MS = 15_000;
const TAG_SUMMARY_STALE_MS = 5 * 60_000;
/** Tag index rows one snapshot page reads. */
export const TAG_SUMMARY_PAGE_ROWS = 4000;
/**
 * Distinct tags one snapshot page counts. Each tag is two index lookups, and
 * a function may only make so many, so a vault of many small tags pages by
 * tags rather than rows.
 */
export const TAG_SUMMARY_PAGE_TAGS = 500;
/** Pages one recompute reads before it stops and marks itself incomplete. */
export const TAG_SUMMARY_MAX_PAGES = 60;
/** Most tags a snapshot keeps, most-used first. */
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
interface Position {
  cardCreatedAt: number;
  cardId: Id<"cards">;
}

const pendingRefresh = (ctx: QueryCtx, userId: string) =>
  ctx.db
    .query("tagSummaryRefreshes")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();

/**
 * Schedules a snapshot recompute unless one is already pending, so a burst
 * of tag changes (an import, a library-wide rename) recomputes once. An
 * account being deleted gets none, so no marker outlives the sweep.
 */
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

const resumeValidator = v.object({
  tag: v.string(),
  count: v.number(),
  cardCreatedAt: v.number(),
  cardId: v.id("cards"),
});

const pageStateValidator = v.object({
  afterTag: v.optional(v.string()),
  resume: v.optional(resumeValidator),
});

/**
 * Counts active (not in Trash, not archived) cards per tag over at most
 * TAG_SUMMARY_PAGE_ROWS index rows, resuming where the previous page
 * stopped, even part way through one tag.
 */
export const countTagSummaryPage = internalQuery({
  args: { userId: v.string(), state: pageStateValidator },
  returns: v.object({
    counts: v.array(tagSummaryItemValidator),
    next: v.union(pageStateValidator, v.null()),
  }),
  handler: async (ctx, { userId, state }) => {
    let budget = TAG_SUMMARY_PAGE_ROWS;
    let tagsLeft = TAG_SUMMARY_PAGE_TAGS;
    const counts: TagCount[] = [];

    async function* activeRows(tag: string, after?: Position) {
      const active = (q: any) =>
        q
          .eq("userId", userId)
          .eq("tag", tag)
          .eq("isDeleted", undefined)
          .eq("isArchived", undefined);
      if (after) {
        yield* ctx.db
          .query("cardSearchTags")
          .withIndex("by_user_tag_deleted_archived_created_v2", (q) =>
            active(q)
              .eq("cardCreatedAt", after.cardCreatedAt)
              .gt("cardId", after.cardId)
          );
      }
      yield* ctx.db
        .query("cardSearchTags")
        .withIndex("by_user_tag_deleted_archived_created_v2", (q) =>
          after ? active(q).gt("cardCreatedAt", after.cardCreatedAt) : active(q)
        );
    }

    const countTag = async (tag: string, start: number, after?: Position) => {
      let count = start;
      let position = after;
      for await (const row of activeRows(tag, after)) {
        if (budget <= 0) {
          return { count, position, cutOff: true };
        }
        budget -= 1;
        count += 1;
        position = { cardCreatedAt: row.cardCreatedAt, cardId: row.cardId };
      }
      return { count, position, cutOff: false };
    };

    let afterTag = state.afterTag;
    if (state.resume) {
      const { tag, count: start, cardCreatedAt, cardId } = state.resume;
      const result = await countTag(tag, start, { cardCreatedAt, cardId });
      if (result.cutOff && result.position) {
        return {
          counts,
          next: { resume: { tag, count: result.count, ...result.position } },
        };
      }
      if (result.count > 0) {
        counts.push({ name: tag, count: result.count });
      }
      afterTag = tag;
    }

    while (budget > 0 && tagsLeft > 0) {
      tagsLeft -= 1;
      const seekAfter = afterTag;
      const next = await ctx.db
        .query("cardSearchTags")
        .withIndex("by_user_tag_deleted_created", (q) =>
          seekAfter === undefined
            ? q.eq("userId", userId)
            : q.eq("userId", userId).gt("tag", seekAfter)
        )
        .first();
      if (!next) {
        return { counts, next: null };
      }
      budget -= 1;
      const result = await countTag(next.tag, 0);
      if (result.cutOff) {
        return {
          counts,
          next: result.position
            ? {
                resume: {
                  tag: next.tag,
                  count: result.count,
                  ...result.position,
                },
              }
            : { afterTag: seekAfter },
        };
      }
      if (result.count > 0) {
        counts.push({ name: next.tag, count: result.count });
      }
      afterTag = next.tag;
    }
    return { counts, next: { afterTag } };
  },
});

/**
 * Starts a recompute: clears the pending marker so tag changes from here on
 * schedule another, and returns when it was claimed. Null when there is
 * nothing to do (the marker is gone, for example swept by account deletion)
 * or the account is being deleted.
 */
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
    /** When the recompute claimed its marker: what the counts are as of. */
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
    // Recomputes can overlap; one that started earlier never replaces the
    // counts of one that started later.
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

/**
 * Recomputes the user's tag snapshot from the tag index. Reads run as
 * queries, so the recompute never conflicts with card writes landing
 * meanwhile; a change during the recompute schedules another one.
 */
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
    let state: { afterTag?: string; resume?: any } | null = {};
    let pages = 0;
    while (state && pages < TAG_SUMMARY_MAX_PAGES) {
      const page: {
        counts: TagCount[];
        next: { afterTag?: string; resume?: any } | null;
      } = await ctx.runQuery(internal.tag.tagSummary.countTagSummaryPage, {
        userId,
        state,
      });
      for (const { name, count } of page.counts) {
        totals.set(name, count);
      }
      state = page.next;
      pages += 1;
    }
    const items = sortTagCounts(
      Array.from(totals, ([name, count]) => ({ name, count }))
    );
    await ctx.runMutation(internal.tag.tagSummary.writeTagSummary, {
      userId,
      items: items.slice(0, MAX_TAG_SUMMARY_ITEMS),
      isComplete: state === null && items.length <= MAX_TAG_SUMMARY_ITEMS,
      claimedAt,
    });
    return null;
  },
});

/** A user's tag snapshot, for GET /v1/tags when the live listing stops short. */
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

/** Builds a user's first snapshot (GET /v1/tags on a large library). */
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

/**
 * The signed-in user's tag snapshot, or null before the first one is built
 * (the app then calls requestTagSummary).
 */
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

/** Builds the first snapshot right away; later ones follow tag changes. */
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
