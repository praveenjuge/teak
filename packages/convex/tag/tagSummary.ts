import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
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
import { isOptimisticConcurrencyError } from "../publicApi/http/shared";
import { getSessionUser, requireTeakUserId } from "../securitySessions";
import { captureBackendException } from "../telemetry/posthog";

export const TAG_SUMMARY_DEBOUNCE_MS = 15_000;
const TAG_SUMMARY_STALE_MS = 5 * 60_000;
export const TAG_SUMMARY_PAGE_ROWS = 4000;
export const TAG_SUMMARY_MAX_PAGES = 60;
export const MAX_TAG_SUMMARY_ITEMS = 3000;
export const TAG_COUNT_FOLD_ROWS = 1000;
export const TAG_SUMMARY_RETRY_MAX_ATTEMPTS = 8;

/** Backoff for a failed tag-summary recompute: 5s doubling, capped at 2 minutes. */
export const tagSummaryRetryDelayMs = (attempt: number): number | null =>
  attempt >= TAG_SUMMARY_RETRY_MAX_ATTEMPTS
    ? null
    : Math.min(5000 * 2 ** attempt, 120_000);

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

/**
 * A finished account deletion removes its `accountDeletionStates` row and
 * leaves only `users.deletedAt`, so a delayed recompute checks both before it
 * writes anything back for the user.
 */
const accountClosedOrClosing = async (ctx: QueryCtx, userId: string) => {
  if (await getAccountDeletionState(ctx, userId)) {
    return true;
  }
  const owner = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", userId))
    .unique();
  return owner?.deletedAt !== undefined;
};

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

export type TagCountDeltas = Map<string, Map<string, number>>;

/** Whether a tag row counts toward its tag: outside Trash and Archive. */
export const isCountedTagRow = (
  row: Pick<Doc<"cardSearchTags">, "isArchived" | "isDeleted">
) => row.isDeleted === undefined && row.isArchived === undefined;

export const addTagCountDelta = (
  deltas: TagCountDeltas,
  userId: string,
  tag: string,
  delta: number
) => {
  const tags = deltas.get(userId) ?? new Map<string, number>();
  tags.set(tag, (tags.get(tag) ?? 0) + delta);
  deltas.set(userId, tags);
};

export const recordTagCountDeltas = async (
  ctx: MutationCtx,
  deltas: TagCountDeltas
) => {
  for (const [userId, tags] of deltas) {
    for (const [tag, delta] of tags) {
      if (delta !== 0) {
        await ctx.db.insert("tagCountDeltas", { userId, tag, delta });
      }
    }
  }
};

export const applyTagCounts = async (
  ctx: MutationCtx,
  userId: string,
  deltas: Map<string, number>
) => {
  for (const [tag, delta] of deltas) {
    if (delta === 0) {
      continue;
    }
    const row = await ctx.db
      .query("userTagCounts")
      .withIndex("by_userId_and_tag", (q) =>
        q.eq("userId", userId).eq("tag", tag)
      )
      .unique();
    const count = (row?.count ?? 0) + delta;
    if (!row) {
      await ctx.db.insert("userTagCounts", { userId, tag, count });
    } else if (count === 0) {
      await ctx.db.delete("userTagCounts", row._id);
    } else {
      await ctx.db.patch("userTagCounts", row._id, { count });
    }
  }
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
      .withIndex("by_user_tag_deleted_archived_saved", (q) =>
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

export const countTagCountsPage = internalQuery({
  args: { userId: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    counts: v.array(tagSummaryItemValidator),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { userId, cursor }) => {
    const page = await ctx.db
      .query("userTagCounts")
      .withIndex("by_userId_and_tag", (q) => q.eq("userId", userId))
      .paginate({ cursor, numItems: TAG_SUMMARY_PAGE_ROWS });
    return {
      counts: page.page.flatMap((row) =>
        row.count > 0 ? [{ name: row.tag, count: row.count }] : []
      ),
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const tagCountsReady = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) =>
    (await ctx.db
      .query("tagCountStates")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique()) !== null,
});

/** Folds a page of the user's count changes into `userTagCounts`. */
export const foldTagCountDeltas = internalMutation({
  args: { userId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { userId }) => {
    if (await getAccountDeletionState(ctx, userId)) {
      return true;
    }
    const rows = await ctx.db
      .query("tagCountDeltas")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(TAG_COUNT_FOLD_ROWS);
    const totals = new Map<string, number>();
    for (const row of rows) {
      totals.set(row.tag, (totals.get(row.tag) ?? 0) + row.delta);
      await ctx.db.delete("tagCountDeltas", row._id);
    }
    await applyTagCounts(ctx, userId, totals);
    return rows.length < TAG_COUNT_FOLD_ROWS;
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
    if (await accountClosedOrClosing(ctx, userId)) {
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

/** Re-marks the summary dirty after a failed recompute gave up retrying. */
export const rearmTagSummaryRefresh = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    if (await accountClosedOrClosing(ctx, userId)) {
      return null;
    }
    await markTagSummaryDirty(ctx, userId);
    return null;
  },
});

export const recomputeTagSummary = internalAction({
  args: {
    userId: v.string(),
    claimedAt: v.optional(v.number()),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { userId, claimedAt, attempt }) => {
    // A retry carries the original claim through claimedAt, so only the first
    // attempt consumes the pending refresh.
    let claimed: number | null = claimedAt ?? null;
    if (claimed === null) {
      claimed = await ctx.runMutation(
        internal.tag.tagSummary.claimTagSummaryRefresh,
        { userId }
      );
      if (claimed === null) {
        return null;
      }
    }
    try {
      let folded = false;
      for (
        let round = 0;
        !folded && round < TAG_SUMMARY_MAX_PAGES;
        round += 1
      ) {
        folded = await ctx.runMutation(
          internal.tag.tagSummary.foldTagCountDeltas,
          { userId }
        );
      }
      // The full recount of `cardSearchTags` stays as the repair path for
      // tag rows that are not counted yet.
      const pageQuery =
        folded &&
        (await ctx.runQuery(internal.tag.tagSummary.tagCountsReady, {}))
          ? internal.tag.tagSummary.countTagCountsPage
          : internal.tag.tagSummary.countTagSummaryPage;
      const totals = new Map<string, number>();
      let cursor: string | null = null;
      let isDone = false;
      let pages = 0;
      while (!isDone && pages < TAG_SUMMARY_MAX_PAGES) {
        const page: {
          counts: TagCount[];
          continueCursor: string | null;
        } = await ctx.runQuery(pageQuery, { userId, cursor });
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
        claimedAt: claimed,
      });
      return null;
    } catch (caught) {
      // foldTagCountDeltas conflicts with syncCardSearchTagsBatch inserts into
      // the same tagCountDeltas range; Convex retries the mutation, but a fold
      // that still fails permanently must not strand the summary - the pending
      // refresh is already consumed by the claim. Back off and re-run; after
      // the cap, report and re-arm the refresh through the normal debounce so
      // it recomputes even if no new edits arrive. Only write conflicts are
      // transient: any other error would fail the same way on every retry and
      // every re-arm, so it fails once, as before.
      if (!isOptimisticConcurrencyError(caught)) {
        throw caught;
      }
      const delay = tagSummaryRetryDelayMs(attempt ?? 0);
      if (delay === null) {
        console.error("[tagSummary] recompute retry budget exhausted", caught);
        await captureBackendException(caught, {
          properties: { source: "tag_summary_recompute_retry_exhausted" },
        });
        await ctx.runMutation(internal.tag.tagSummary.rearmTagSummaryRefresh, {
          userId,
        });
        return null;
      }
      await ctx.scheduler.runAfter(
        delay,
        internal.tag.tagSummary.recomputeTagSummary,
        { userId, claimedAt: claimed, attempt: (attempt ?? 0) + 1 }
      );
      return null;
    }
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
