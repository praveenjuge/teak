import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "../_generated/server";
import { getAccountDeletionState } from "../accountDeletion";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import { getSessionUser } from "../securitySessions";
import {
  explainInvalidTagName,
  explainInvalidTagSource,
  rewriteTagList,
  TAG_ERROR_MESSAGES,
  TAG_OPERATION_COUNT_LIMIT,
  TAG_OPERATION_STALL_MS,
  type TagOperationKind,
  tagExistsMessage,
  tagKey,
} from "../shared/tags";

/** Cards one batch rewrites before it schedules the next. */
export const TAG_OPERATION_BATCH_SIZE = 25;
/**
 * Passes over the tag index at most. A pass that changed cards is followed
 * by another, a little later, to catch cards the index had not caught up
 * with: one tagged just before the change started, or one restored from
 * Trash behind the cursor. The change completes after a pass changes none.
 */
export const TAG_OPERATION_MAX_PASSES = 4;
/** How long to wait before the next pass, so pending tag syncs land. */
export const TAG_OPERATION_PASS_DELAY_MS = 2000;
/**
 * Extra passes an operation makes while the user's tag syncs are still
 * running (a card tagged just before it may not be in the index yet), so a
 * stuck sync delays completion by at most half a minute.
 */
export const TAG_OPERATION_MAX_SYNC_WAITS = 15;
const hasPendingTagSync = async (ctx: MutationCtx, userId: string) =>
  (await ctx.db
    .query("cardSearchTagSyncStates")
    .withIndex("by_userId_and_pending", (q) =>
      q.eq("userId", userId).eq("pending", true)
    )
    .first()) !== null;

export const tagOperationKindValidator = v.union(
  v.literal("rename"),
  v.literal("merge"),
  v.literal("delete")
);

export const tagOperationReturnValidator = v.object({
  _id: v.id("tagOperations"),
  kind: tagOperationKindValidator,
  from: v.string(),
  to: v.optional(v.string()),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed")
  ),
  total: v.number(),
  processed: v.number(),
  changed: v.number(),
  error: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
});

export interface TagOperationSummary {
  _id: Id<"tagOperations">;
  changed: number;
  completedAt?: number;
  createdAt: number;
  error?: string;
  from: string;
  kind: TagOperationKind;
  processed: number;
  status: "running" | "completed" | "failed";
  to?: string;
  total: number;
  updatedAt: number;
}

export const toTagOperationSummary = (
  operation: Doc<"tagOperations">
): TagOperationSummary => ({
  _id: operation._id,
  kind: operation.kind,
  from: operation.from,
  ...(operation.to === undefined ? {} : { to: operation.to }),
  status: operation.status,
  total: operation.total,
  processed: operation.processed,
  changed: operation.changed,
  ...(operation.error === undefined ? {} : { error: operation.error }),
  createdAt: operation.createdAt,
  updatedAt: operation.updatedAt,
  ...(operation.completedAt === undefined
    ? {}
    : { completedAt: operation.completedAt }),
});

export interface StartTagOperationArgs {
  from: string;
  kind: TagOperationKind;
  to?: string;
}

const invalidInput = (message: string) =>
  new ConvexError({ code: "INVALID_INPUT", message });

const hasTagRow = async (
  ctx: QueryCtx,
  userId: string,
  key: string
): Promise<boolean> =>
  (await ctx.db
    .query("cardSearchTags")
    .withIndex("by_user_tag_deleted_created", (q) =>
      q.eq("userId", userId).eq("tag", key)
    )
    .first()) !== null;

const runningOperation = (ctx: QueryCtx, userId: string) =>
  ctx.db
    .query("tagOperations")
    .withIndex("by_userId_and_status", (q) =>
      q.eq("userId", userId).eq("status", "running")
    )
    .first();

/**
 * Starts renaming, merging or deleting a tag on every card the user has,
 * including cards in Trash and Archive, and returns the operation to poll.
 * One operation runs at a time per user.
 */
export const startTagOperationForUser = async (
  ctx: MutationCtx,
  userId: string,
  args: StartTagOperationArgs
): Promise<TagOperationSummary> => {
  const fromError = explainInvalidTagSource(args.from);
  if (fromError) {
    throw invalidInput(fromError);
  }
  const from = tagKey(args.from);
  let to: string | undefined;
  if (args.kind !== "delete") {
    const toError = explainInvalidTagName(args.to ?? "");
    if (toError) {
      throw invalidInput(toError);
    }
    to = (args.to ?? "").trim();
    if (args.kind === "merge" && tagKey(to) === from) {
      throw invalidInput(TAG_ERROR_MESSAGES.SAME_TAG);
    }
  }

  if (await getAccountDeletionState(ctx, userId)) {
    throw new ConvexError({
      code: "CONFLICT",
      message: "This account is being deleted",
    });
  }

  const now = Date.now();
  const running = await runningOperation(ctx, userId);
  if (running) {
    if (running.updatedAt + TAG_OPERATION_STALL_MS > now) {
      throw new ConvexError({
        code: "TAG_OPERATION_RUNNING",
        message: TAG_ERROR_MESSAGES.OPERATION_RUNNING,
      });
    }
    await ctx.db.patch("tagOperations", running._id, {
      status: "failed",
      error: "Stopped before it finished",
      updatedAt: now,
      completedAt: now,
    });
  }

  if (!(await hasTagRow(ctx, userId, from))) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: TAG_ERROR_MESSAGES.NOT_FOUND,
    });
  }
  if (
    args.kind === "rename" &&
    to !== undefined &&
    tagKey(to) !== from &&
    (await hasTagRow(ctx, userId, tagKey(to)))
  ) {
    throw new ConvexError({
      code: "TAG_EXISTS",
      message: tagExistsMessage(to),
    });
  }

  let total = 0;
  for await (const _row of ctx.db
    .query("cardSearchTags")
    .withIndex("by_user_tag_deleted_created", (q) =>
      q.eq("userId", userId).eq("tag", from)
    )) {
    total += 1;
    if (total >= TAG_OPERATION_COUNT_LIMIT) {
      break;
    }
  }

  const operationId = await ctx.db.insert("tagOperations", {
    userId,
    kind: args.kind,
    from,
    ...(to === undefined ? {} : { to }),
    status: "running",
    total,
    processed: 0,
    changed: 0,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.tag.tagOperations.runTagOperationBatch,
    { operationId }
  );
  const operation = await ctx.db.get("tagOperations", operationId);
  if (!operation) {
    throw new Error("Failed to start the tag operation");
  }
  return toTagOperationSummary(operation);
};

/** The user's operation for an id, or null when it is not theirs. */
export const getTagOperationForUser = async (
  ctx: QueryCtx,
  userId: string,
  operationId: string
): Promise<TagOperationSummary | null> => {
  const id = ctx.db.normalizeId("tagOperations", operationId);
  if (!id) {
    return null;
  }
  const operation = await ctx.db.get("tagOperations", id);
  return operation && operation.userId === userId
    ? toTagOperationSummary(operation)
    : null;
};

/**
 * Rewrites the tag on the next batch of cards. Reads each card fresh and
 * changes only its tags, so edits made meanwhile are kept.
 */
export const runTagOperationBatchHandler = async (
  ctx: MutationCtx,
  operationId: Id<"tagOperations">
): Promise<{ done: boolean }> => {
  const operation = await ctx.db.get("tagOperations", operationId);
  if (operation?.status !== "running") {
    return { done: true };
  }
  // Account deletion removes the user's cards and operations itself, and
  // card writes stand down meanwhile.
  if (await getAccountDeletionState(ctx, operation.userId)) {
    return { done: true };
  }
  const page = await ctx.db
    .query("cardSearchTags")
    .withIndex("by_user_tag_deleted_created", (q) =>
      q.eq("userId", operation.userId).eq("tag", operation.from)
    )
    .paginate({
      numItems: TAG_OPERATION_BATCH_SIZE,
      cursor: operation.cursor ?? null,
    });

  const rewrite = {
    kind: operation.kind,
    from: operation.from,
    to: operation.to,
  };
  const toKey = operation.to === undefined ? undefined : tagKey(operation.to);
  const hasTag = (list: readonly string[] | undefined, key: string) =>
    list?.some((tag) => tagKey(tag) === key) ?? false;
  const rewriteFor = (
    own: readonly string[] | undefined,
    other: readonly string[] | undefined
  ) =>
    toKey !== undefined &&
    toKey !== operation.from &&
    !hasTag(own, toKey) &&
    hasTag(other, toKey)
      ? { kind: "delete" as const, from: operation.from }
      : rewrite;
  const now = Date.now();
  let changed = 0;
  for (const row of page.page) {
    const card = await ctx.db.get("cards", row.cardId);
    if (!card || card.userId !== operation.userId) {
      continue;
    }
    const tags = rewriteTagList(card.tags, rewriteFor(card.tags, card.aiTags));
    const aiTags = rewriteTagList(
      card.aiTags,
      rewriteFor(card.aiTags, card.tags)
    );
    if (!(tags || aiTags)) {
      continue;
    }
    await patchCardWithSearchSync(ctx, card._id, {
      ...(tags ? { tags: tags.length > 0 ? tags : undefined } : {}),
      ...(aiTags ? { aiTags: aiTags.length > 0 ? aiTags : undefined } : {}),
      updatedAt: now,
    });
    changed += 1;
  }

  const passChanged = (operation.passChanged ?? 0) + changed;
  const progress = {
    processed:
      (operation.pass ?? 1) === 1
        ? operation.processed + page.page.length
        : operation.processed,
    changed: operation.changed + changed,
    updatedAt: now,
  };
  if (page.isDone) {
    const pass = operation.pass ?? 1;
    const syncWaits = operation.syncWaits ?? 0;
    if (passChanged === 0 || pass >= TAG_OPERATION_MAX_PASSES) {
      if (
        syncWaits < TAG_OPERATION_MAX_SYNC_WAITS &&
        (await hasPendingTagSync(ctx, operation.userId))
      ) {
        await ctx.db.patch("tagOperations", operationId, {
          ...progress,
          cursor: undefined,
          pass: pass + 1,
          passChanged: 0,
          syncWaits: syncWaits + 1,
        });
        await ctx.scheduler.runAfter(
          TAG_OPERATION_PASS_DELAY_MS,
          internal.tag.tagOperations.runTagOperationBatch,
          { operationId }
        );
        return { done: false };
      }
      await ctx.db.patch("tagOperations", operationId, {
        ...progress,
        status: "completed",
        cursor: undefined,
        completedAt: now,
      });
      return { done: true };
    }
    await ctx.db.patch("tagOperations", operationId, {
      ...progress,
      cursor: undefined,
      pass: pass + 1,
      passChanged: 0,
    });
    await ctx.scheduler.runAfter(
      TAG_OPERATION_PASS_DELAY_MS,
      internal.tag.tagOperations.runTagOperationBatch,
      { operationId }
    );
    return { done: false };
  }
  await ctx.db.patch("tagOperations", operationId, {
    ...progress,
    cursor: page.continueCursor,
    passChanged,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.tag.tagOperations.runTagOperationBatch,
    { operationId }
  );
  return { done: false };
};

export const runTagOperationBatch = internalMutation({
  args: { operationId: v.id("tagOperations") },
  returns: v.object({ done: v.boolean() }),
  handler: (ctx, { operationId }) =>
    runTagOperationBatchHandler(ctx, operationId),
});

const requireSignedIn = async (ctx: QueryCtx | MutationCtx) => {
  const user = await getSessionUser(ctx);
  if (!user) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Sign in to manage tags",
    });
  }
  return user.teakUserId;
};

export const startTagOperation = mutation({
  args: {
    kind: tagOperationKindValidator,
    from: v.string(),
    to: v.optional(v.string()),
  },
  returns: tagOperationReturnValidator,
  handler: async (ctx, args) =>
    startTagOperationForUser(ctx, await requireSignedIn(ctx), args),
});

export const getTagOperation = query({
  args: { operationId: v.string() },
  returns: v.union(tagOperationReturnValidator, v.null()),
  handler: async (ctx, { operationId }) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return null;
    }
    return getTagOperationForUser(ctx, user.teakUserId, operationId);
  },
});

/**
 * The user's latest operation, running or finished. A reloaded page picks a
 * running one's progress back up, and shows a just-finished one in the tag
 * list until the background counts catch up.
 */
export const getLatestTagOperation = query({
  args: {},
  returns: v.union(tagOperationReturnValidator, v.null()),
  handler: async (ctx) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return null;
    }
    const latest = await ctx.db
      .query("tagOperations")
      .withIndex("by_userId_and_createdAt", (q) =>
        q.eq("userId", user.teakUserId)
      )
      .order("desc")
      .first();
    return latest ? toTagOperationSummary(latest) : null;
  },
});
