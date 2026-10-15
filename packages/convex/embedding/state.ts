import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { getAccountDeletionState } from "../accountDeletion";
import { isFilesWorkerConfigured } from "../storage/filesWorkerClient";
import { buildEmbeddingText } from "./text";

/**
 * The `cardEmbeddings` ledger: one row per card that has, or is due for, a
 * vector. A row is written before its first upsert and removed only after
 * its vector is deleted, so every vector in the index has a row.
 *
 * `dueAt` is set exactly while an `embedDue` job is scheduled for the card,
 * and it doubles as a fence: a job records its result only if `dueAt` still
 * holds the value it read, so an older job can never mark a newer edit done.
 */

/** Edits within this window are embedded once, after the last one. */
export const EMBED_DEBOUNCE_MS = 30_000;
/** After this many failed attempts the card waits for the backfill. */
export const MAX_EMBED_ATTEMPTS = 5;
export const MAX_VECTOR_DELETE_ATTEMPTS = 5;

const embedRef = () => internal.embedding.embedCard;

const rowFor = (ctx: QueryCtx, cardId: Id<"cards">) =>
  ctx.db
    .query("cardEmbeddings")
    .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
    .unique();

/**
 * Embed the card about EMBED_DEBOUNCE_MS from now. Called by the search sync
 * whenever a card's searchable text changes, so a burst of edits costs one
 * embedding. Does nothing without a Files Worker (the local E2E stack).
 */
export const markCardForEmbedding = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  userId: string
) => {
  if (!isFilesWorkerConfigured()) {
    return;
  }
  const row = await rowFor(ctx, cardId);
  if (row?.pendingVectorDeleteAt !== undefined) {
    return;
  }
  const dueAt = Date.now() + EMBED_DEBOUNCE_MS;
  if (row) {
    await ctx.db.patch("cardEmbeddings", row._id, {
      attempts: undefined,
      dueAt,
      lastError: undefined,
    });
    // A job already waiting finds the later dueAt and waits for it; one
    // already running hands it to a new job when it records (handOffStaleJob).
    if (row.dueAt !== undefined) {
      return;
    }
  } else {
    await ctx.db.insert("cardEmbeddings", { cardId, dueAt, userId });
  }
  await ctx.scheduler.runAfter(EMBED_DEBOUNCE_MS, embedRef().embedDue, {
    cardIds: [cardId],
  });
};

/**
 * Mark a card the backfill found without a current vector as due at
 * `dueAt`. The backfill schedules one `embedDue` per batch of these, since a
 * row it re-queues may have lost its job.
 */
export const queueCardEmbedding = async (
  ctx: MutationCtx,
  row: Doc<"cardEmbeddings"> | null,
  cardId: Id<"cards">,
  userId: string,
  dueAt: number
) => {
  if (row) {
    await ctx.db.patch("cardEmbeddings", row._id, {
      attempts: undefined,
      dueAt,
      lastError: undefined,
    });
  } else {
    await ctx.db.insert("cardEmbeddings", { cardId, dueAt, userId });
  }
};

/**
 * The card is gone: mark its vector for deletion and schedule the delete.
 * The row stays until the delete succeeds, so a failed delete stays visible.
 */
export const tombstoneCardEmbedding = async (
  ctx: MutationCtx,
  cardId: Id<"cards">
) => {
  const row = await rowFor(ctx, cardId);
  if (!row || row.pendingVectorDeleteAt !== undefined) {
    return;
  }
  if (row.shard === undefined) {
    // Never embedded. A first embed still in flight finds no row and deletes
    // what it wrote (recordEmbedded).
    await ctx.db.delete("cardEmbeddings", row._id);
    return;
  }
  await ctx.db.patch("cardEmbeddings", row._id, {
    dueAt: undefined,
    pendingVectorDeleteAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, embedRef().deleteVectors, {
    attempt: 1,
    cardIds: [cardId],
  });
};

/**
 * A job finished after the row moved on. An edit made while it ran set a
 * later `dueAt` that no job is waiting for (`markCardForEmbedding` schedules
 * only when none is due), so schedule one. If this job wrote a vector, the
 * stored hash no longer says what the index holds (the vector may have
 * landed on top of a newer one, or the text may since have been reverted to
 * the hashed text): forget it so the next job embeds for real.
 */
const handOffStaleJob = async (
  ctx: MutationCtx,
  row: Doc<"cardEmbeddings">,
  wroteVector: boolean
) => {
  if (row.dueAt === undefined && !wroteVector) {
    return;
  }
  const dueAt = row.dueAt ?? Date.now();
  if (wroteVector) {
    await ctx.db.patch("cardEmbeddings", row._id, { dueAt, hash: undefined });
  }
  await ctx.scheduler.runAfter(
    Math.max(0, dueAt - Date.now()),
    embedRef().embedDue,
    { cardIds: [row.cardId] }
  );
};

const embeddingRowValidator = v.object({
  attempts: v.optional(v.number()),
  cardId: v.id("cards"),
  dueAt: v.optional(v.number()),
  embeddedAt: v.optional(v.number()),
  hash: v.optional(v.string()),
  namespace: v.optional(v.string()),
  shard: v.optional(v.number()),
  text: v.string(),
  userId: v.string(),
});

/** The due cards' rows and current text; skips gone cards and deletions. */
export const loadForEmbedding = internalQuery({
  args: { cardIds: v.array(v.id("cards")) },
  returns: v.array(embeddingRowValidator),
  handler: async (ctx, { cardIds }) => {
    const loaded: (typeof embeddingRowValidator.type)[] = [];
    for (const cardId of cardIds) {
      const [row, card] = await Promise.all([
        rowFor(ctx, cardId),
        ctx.db.get("cards", cardId),
      ]);
      if (
        !(row && card) ||
        row.pendingVectorDeleteAt !== undefined ||
        (await getAccountDeletionState(ctx, card.userId))
      ) {
        continue;
      }
      const extracted = card.hasExtractedText
        ? await ctx.db
            .query("cardTextContents")
            .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
            .unique()
        : null;
      loaded.push({
        attempts: row.attempts,
        cardId,
        dueAt: row.dueAt,
        embeddedAt: row.embeddedAt,
        hash: row.hash,
        namespace: row.namespace,
        shard: row.shard,
        text: buildEmbeddingText(card, extracted?.text),
        userId: card.userId,
      });
    }
    return loaded;
  },
});

/**
 * Record an embed (or, with no hash, a cleared vector) if the row's `dueAt`
 * is still the one the job read. A card deleted meanwhile gets its vector
 * deleted; a job overtaken by a newer completed one re-embeds current text.
 */
export const recordEmbedded = internalMutation({
  args: {
    cardId: v.id("cards"),
    expectedDueAt: v.optional(v.number()),
    hash: v.optional(v.string()),
    namespace: v.optional(v.string()),
    shard: v.optional(v.number()),
  },
  returns: v.union(
    v.literal("recorded"),
    v.literal("stale"),
    v.literal("card_gone")
  ),
  handler: async (ctx, args) => {
    const [row, card] = await Promise.all([
      rowFor(ctx, args.cardId),
      ctx.db.get("cards", args.cardId),
    ]);
    if (!(row && card) || row.pendingVectorDeleteAt !== undefined) {
      // The card went away while this job embedded it. Delete what it wrote,
      // and tombstone a row that no delete path has reached yet.
      if (row && !card && row.pendingVectorDeleteAt === undefined) {
        await ctx.db.patch("cardEmbeddings", row._id, {
          dueAt: undefined,
          namespace: args.namespace ?? row.namespace,
          shard: args.shard ?? row.shard,
        });
        await tombstoneCardEmbedding(ctx, args.cardId);
      } else if (args.shard !== undefined && args.hash !== undefined) {
        await ctx.scheduler.runAfter(0, embedRef().deleteVectorIds, {
          attempt: 1,
          ids: [args.cardId],
          shard: args.shard,
        });
      }
      return "card_gone" as const;
    }
    if (row.dueAt !== args.expectedDueAt) {
      await handOffStaleJob(ctx, row, args.hash !== undefined);
      return "stale" as const;
    }
    await ctx.db.patch("cardEmbeddings", row._id, {
      attempts: undefined,
      dueAt: undefined,
      embeddedAt: args.hash === undefined ? undefined : Date.now(),
      hash: args.hash,
      lastError: undefined,
      namespace: args.namespace ?? row.namespace,
      shard: args.shard ?? row.shard,
    });
    return "recorded" as const;
  },
});

/**
 * Count a failed attempt. Returns the delay before the card's retry, or null
 * when it gets none: out of retries (left for the backfill) or overtaken by
 * a newer job.
 */
const recordOneFailure = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  error: string,
  expectedDueAt: number | undefined
): Promise<number | null> => {
  const row = await rowFor(ctx, cardId);
  if (!row) {
    return null;
  }
  if (row.dueAt !== expectedDueAt) {
    await handOffStaleJob(ctx, row, false);
    return null;
  }
  const attempts = (row.attempts ?? 0) + 1;
  const lastError = error.slice(0, 200);
  if (attempts >= MAX_EMBED_ATTEMPTS) {
    await ctx.db.patch("cardEmbeddings", row._id, {
      attempts,
      dueAt: undefined,
      lastError,
    });
    return null;
  }
  const delay = EMBED_DEBOUNCE_MS * 2 ** attempts;
  await ctx.db.patch("cardEmbeddings", row._id, {
    attempts,
    dueAt: Date.now() + delay,
    lastError,
  });
  return delay;
};

/**
 * Back off and retry the cards of one failed attempt, or leave them for the
 * backfill after the last try. Cards retried after the same delay go out in
 * one job, so a failed batched write is retried as a batch: one job per card
 * would be the burst of small writes Vectorize rate-limits.
 */
export const recordEmbedFailures = internalMutation({
  args: {
    error: v.string(),
    items: v.array(
      v.object({
        cardId: v.id("cards"),
        expectedDueAt: v.optional(v.number()),
      })
    ),
  },
  returns: v.null(),
  handler: async (ctx, { error, items }) => {
    const retries = new Map<number, Id<"cards">[]>();
    for (const { cardId, expectedDueAt } of items) {
      const delay = await recordOneFailure(ctx, cardId, error, expectedDueAt);
      if (delay !== null) {
        retries.set(delay, [...(retries.get(delay) ?? []), cardId]);
      }
    }
    for (const [delay, cardIds] of retries) {
      await ctx.scheduler.runAfter(delay, embedRef().embedDue, { cardIds });
    }
    return null;
  },
});

/** Tombstoned rows of these cards, with where their vectors are. */
export const loadTombstones = internalQuery({
  args: { cardIds: v.array(v.id("cards")) },
  returns: v.array(v.object({ cardId: v.id("cards"), shard: v.number() })),
  handler: async (ctx, { cardIds }) => {
    const rows: Array<{ cardId: Id<"cards">; shard: number }> = [];
    for (const cardId of cardIds) {
      const row = await rowFor(ctx, cardId);
      if (row?.pendingVectorDeleteAt !== undefined && row.shard !== undefined) {
        rows.push({ cardId, shard: row.shard });
      }
    }
    return rows;
  },
});

/** Remove tombstoned rows once their vectors are deleted. */
export const forgetDeletedVectors = internalMutation({
  args: { cardIds: v.array(v.id("cards")) },
  returns: v.null(),
  handler: async (ctx, { cardIds }) => {
    for (const cardId of cardIds) {
      const row = await rowFor(ctx, cardId);
      if (row?.pendingVectorDeleteAt !== undefined) {
        await ctx.db.delete("cardEmbeddings", row._id);
      }
    }
    return null;
  },
});

/** A page of an account's rows, for account deletion. */
export const accountEmbeddingsPage = internalQuery({
  args: { userId: v.string() },
  returns: v.array(
    v.object({
      cardId: v.id("cards"),
      rowId: v.id("cardEmbeddings"),
      shard: v.optional(v.number()),
    })
  ),
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("cardEmbeddings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(500);
    return rows.map((row) => ({
      cardId: row.cardId,
      rowId: row._id,
      shard: row.shard,
    }));
  },
});

export const forgetAccountEmbeddings = internalMutation({
  args: { rowIds: v.array(v.id("cardEmbeddings")) },
  returns: v.null(),
  handler: async (ctx, { rowIds }) => {
    for (const rowId of rowIds) {
      if (await ctx.db.get("cardEmbeddings", rowId)) {
        await ctx.db.delete("cardEmbeddings", rowId);
      }
    }
    return null;
  },
});
