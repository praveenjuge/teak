import type {
  FilesEmbedUpsertResult,
  FilesVectorDeleteResult,
} from "@teak/files-protocol";
import { VECTOR_DELETE_MAX_IDS } from "@teak/files-protocol";
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

export const embedDue = internalAction({
  args: { cardIds: v.array(v.id("cards")) },
  returns: v.null(),
  handler: async (ctx, { cardIds }) => {
    if (!isFilesWorkerConfigured()) {
      return null;
    }
    const rows = await ctx.runQuery(state().loadForEmbedding, { cardIds });
    const now = Date.now();
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
      await embedOne(ctx, row);
    }
    return null;
  },
});

const embedOne = async (
  ctx: ActionCtx,
  row: {
    cardId: Id<"cards">;
    dueAt?: number;
    embeddedAt?: number;
    hash?: string;
    namespace?: string;
    shard?: number;
    text: string;
    userId: string;
  }
) => {
  const expectedDueAt = row.dueAt;
  try {
    if (!row.text) {
      if (row.embeddedAt !== undefined && row.shard !== undefined) {
        await deleteVectorIdsOnWorker(row.shard, [row.cardId]);
      }
      await ctx.runMutation(state().recordEmbedded, {
        cardId: row.cardId,
        expectedDueAt,
      });
      return;
    }
    const hash = await embeddingHash(row.text);
    if (hash === row.hash) {
      await ctx.runMutation(state().recordEmbedded, {
        cardId: row.cardId,
        expectedDueAt,
        hash,
        namespace: row.namespace,
        shard: row.shard,
      });
      return;
    }
    const { namespace, shard } = await ctx.runMutation(
      internal.vectorShards.assignVectorShard,
      { userId: row.userId }
    );
    const outcome = await callFilesWorkerJson<FilesEmbedUpsertResult>({
      op: "embed-upsert",
      params: { items: [{ id: row.cardId, text: row.text }], namespace, shard },
    });
    if (outcome.kind !== "ok") {
      throw new Error(`embed_upsert_${outcome.code}`);
    }
    await ctx.runMutation(state().recordEmbedded, {
      cardId: row.cardId,
      expectedDueAt,
      hash,
      namespace,
      shard,
    });
  } catch (error) {
    console.warn("[embedding] card embed failed", {
      cardId: row.cardId,
      message: errorMessage(error),
    });
    await ctx.runMutation(state().recordEmbedFailure, {
      cardId: row.cardId,
      error: errorMessage(error),
      expectedDueAt,
    });
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

/**
 * One page of an account's vectors and rows, for account deletion. Returns
 * true while rows remain. Without a Files Worker there are no reachable
 * vectors, so only the rows go.
 */
export const purgeAccountVectorsPage = async (
  ctx: ActionCtx,
  userId: string
): Promise<boolean> => {
  const rows: Array<{
    cardId: Id<"cards">;
    rowId: Id<"cardEmbeddings">;
    shard?: number;
  }> = await ctx.runQuery(state().accountEmbeddingsPage, { userId });
  if (rows.length === 0) {
    return false;
  }
  if (isFilesWorkerConfigured()) {
    const byShard = new Map<number, string[]>();
    for (const row of rows) {
      if (row.shard !== undefined) {
        byShard.set(row.shard, [...(byShard.get(row.shard) ?? []), row.cardId]);
      }
    }
    for (const [shard, ids] of byShard) {
      await deleteVectorIdsOnWorker(shard, ids);
    }
  }
  await ctx.runMutation(state().forgetAccountEmbeddings, {
    rowIds: rows.map((row) => row.rowId),
  });
  return true;
};
