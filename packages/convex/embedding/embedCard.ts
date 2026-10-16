import type {
  FilesEmbedUpsertResult,
  FilesVectorDeleteResult,
} from "@teak/files-protocol";
import {
  EMBED_UPSERT_MAX_ITEMS,
  VECTOR_DELETE_MAX_IDS,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { type ActionCtx, internalAction } from "../_generated/server";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import { MAX_VECTOR_DELETE_ATTEMPTS } from "./state";
import { embeddingHash } from "./text";

const state = () => internal.embedding.state;
const self = () => internal.embedding.embedCard;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const deleteVectorIdsOnWorker = async (shard: number, ids: string[]) => {
  for (let start = 0; start < ids.length; start += VECTOR_DELETE_MAX_IDS) {
    const outcome = await callFilesWorkerJson<FilesVectorDeleteResult>({
      op: "vector-delete",
      params: { ids: ids.slice(start, start + VECTOR_DELETE_MAX_IDS), shard },
    });
    if (outcome.kind !== "ok") {
      throw new Error(`vector_delete_${outcome.code}`);
    }
  }
};

const retryDelayMs = (attempt: number) => 30_000 * 2 ** attempt;

interface DueRow {
  cardId: Id<"cards">;
  dueAt?: number;
  embeddedAt?: number;
  hash?: string;
  namespace?: string;
  shard?: number;
  text: string;
  userId: string;
}

/**
 * Embed the due cards among `cardIds`. Cards whose text needs a new vector
 * are embedded together, up to EMBED_UPSERT_MAX_ITEMS per `embed-upsert` and
 * one call per owner (a call writes one namespace): Vectorize answers many
 * small writes with 429s, so the backfill queues cards in batches.
 */
export const embedDue = internalAction({
  args: { cardIds: v.array(v.id("cards")) },
  returns: v.null(),
  handler: async (ctx, { cardIds }) => {
    if (!isFilesWorkerConfigured()) {
      return null;
    }
    const rows: DueRow[] = await ctx.runQuery(state().loadForEmbedding, {
      cardIds,
    });
    const now = Date.now();
    const toEmbed = new Map<string, { hash: string; row: DueRow }[]>();
    for (const row of rows) {
      if (row.dueAt === undefined) {
        continue;
      }
      if (row.dueAt > now + 1000) {
        await ctx.scheduler.runAfter(row.dueAt - now, self().embedDue, {
          cardIds: [row.cardId],
        });
        continue;
      }
      const hash = await settleWithoutEmbedding(ctx, row);
      if (hash) {
        toEmbed.set(row.userId, [
          ...(toEmbed.get(row.userId) ?? []),
          { hash, row },
        ]);
      }
    }
    for (const [userId, items] of toEmbed) {
      for (
        let start = 0;
        start < items.length;
        start += EMBED_UPSERT_MAX_ITEMS
      ) {
        await embedBatch(
          ctx,
          userId,
          items.slice(start, start + EMBED_UPSERT_MAX_ITEMS)
        );
      }
    }
    return null;
  },
});

/** One failed attempt for these cards; they are retried together. */
const recordFailure = async (
  ctx: ActionCtx,
  rows: DueRow[],
  error: unknown
) => {
  console.warn("[embedding] card embed failed", {
    cardIds: rows.map((row) => row.cardId),
    message: errorMessage(error),
  });
  await ctx.runMutation(state().recordEmbedFailures, {
    error: errorMessage(error),
    items: rows.map((row) => ({
      cardId: row.cardId,
      expectedDueAt: row.dueAt,
    })),
  });
};

/**
 * Record a card that needs no new vector: its text is empty (its old vector
 * is deleted) or unchanged. Returns the text's hash when it does need one.
 */
const settleWithoutEmbedding = async (
  ctx: ActionCtx,
  row: DueRow
): Promise<string | null> => {
  try {
    if (!row.text) {
      if (row.embeddedAt !== undefined && row.shard !== undefined) {
        await deleteVectorIdsOnWorker(row.shard, [row.cardId]);
      }
      await ctx.runMutation(state().recordEmbedded, {
        cardId: row.cardId,
        expectedDueAt: row.dueAt,
      });
      return null;
    }
    const hash = await embeddingHash(row.text);
    if (hash !== row.hash) {
      return hash;
    }
    // The text the vector came from is unchanged: no Workers AI call.
    await ctx.runMutation(state().recordEmbedded, {
      cardId: row.cardId,
      expectedDueAt: row.dueAt,
      hash,
      namespace: row.namespace,
      shard: row.shard,
    });
  } catch (error) {
    await recordFailure(ctx, [row], error);
  }
  return null;
};

/** Embed one owner's cards in one call; a failure retries each card. */
const embedBatch = async (
  ctx: ActionCtx,
  userId: string,
  items: { hash: string; row: DueRow }[]
) => {
  try {
    const { namespace, shard } = await ctx.runMutation(
      internal.vectorShards.assignVectorShard,
      { userId }
    );
    const outcome = await callFilesWorkerJson<FilesEmbedUpsertResult>({
      op: "embed-upsert",
      params: {
        items: items.map(({ row }) => ({ id: row.cardId, text: row.text })),
        namespace,
        shard,
      },
    });
    if (outcome.kind !== "ok") {
      throw new Error(`embed_upsert_${outcome.code}`);
    }
    for (const { hash, row } of items) {
      await ctx.runMutation(state().recordEmbedded, {
        cardId: row.cardId,
        expectedDueAt: row.dueAt,
        hash,
        namespace,
        shard,
      });
    }
  } catch (error) {
    await recordFailure(
      ctx,
      items.map(({ row }) => row),
      error
    );
  }
};

/** Delete the vectors of tombstoned rows, then the rows. */
export const deleteVectors = internalAction({
  args: { attempt: v.number(), cardIds: v.array(v.id("cards")) },
  returns: v.null(),
  handler: async (ctx, { attempt, cardIds }) => {
    const rows: Array<{ cardId: Id<"cards">; shard: number }> =
      await ctx.runQuery(state().loadTombstones, { cardIds });
    if (rows.length === 0) {
      return null;
    }
    try {
      if (isFilesWorkerConfigured()) {
        const byShard = new Map<number, string[]>();
        for (const row of rows) {
          byShard.set(row.shard, [
            ...(byShard.get(row.shard) ?? []),
            row.cardId,
          ]);
        }
        for (const [shard, ids] of byShard) {
          await deleteVectorIdsOnWorker(shard, ids);
        }
      }
      await ctx.runMutation(state().forgetDeletedVectors, {
        cardIds: rows.map((row) => row.cardId),
      });
    } catch (error) {
      console.warn("[embedding] vector delete failed", {
        attempt,
        message: errorMessage(error),
      });
      if (attempt < MAX_VECTOR_DELETE_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          retryDelayMs(attempt),
          self().deleteVectors,
          {
            attempt: attempt + 1,
            cardIds,
          }
        );
      }
    }
    return null;
  },
});

/** Delete vectors no row describes any more (a card deleted mid-embed). */
export const deleteVectorIds = internalAction({
  args: { attempt: v.number(), ids: v.array(v.string()), shard: v.number() },
  returns: v.null(),
  handler: async (ctx, { attempt, ids, shard }) => {
    if (!isFilesWorkerConfigured()) {
      return null;
    }
    try {
      await deleteVectorIdsOnWorker(shard, ids);
    } catch (error) {
      console.warn("[embedding] vector delete failed", {
        attempt,
        message: errorMessage(error),
      });
      if (attempt < MAX_VECTOR_DELETE_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          retryDelayMs(attempt),
          self().deleteVectorIds,
          { attempt: attempt + 1, ids, shard }
        );
      }
    }
    return null;
  },
});
