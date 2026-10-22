import { EMBED_UPSERT_MAX_ITEMS } from "@teak/files-protocol";
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
import { getDocumentTextRow, readCardTranscript } from "../card/textContents";
import { cardTypeValidator } from "../schema";
import { isFilesWorkerConfigured } from "../storage/filesWorkerClient";
import { buildEmbeddingText } from "./text";

// `dueAt` is set exactly while an `embedDue` job is scheduled for the card,
// and it doubles as a fence: a job records its result only if `dueAt` still
// holds the value it read, so an older job can never mark a newer edit done.
//
// Vectorize answers a burst of small writes with 429s, so the first job to
// run claims the owner's due cards (`leaseUntil`) and writes them in batches.

export const EMBED_DEBOUNCE_MS = 30_000;
export const MAX_EMBED_ATTEMPTS = 5;
export const MAX_VECTOR_DELETE_ATTEMPTS = 5;
export const EMBED_CLAIM_MAX_CARDS = EMBED_UPSERT_MAX_ITEMS * 2;
export const EMBED_CLAIM_LEASE_MS = 10 * 60_000;
export const EMBED_CLAIM_GAP_MS = 3000;
export const LOST_EMBED_JOB_MS = 60 * 60 * 1000;

const embedRef = () => internal.embedding.embedCard;

const rowFor = (ctx: QueryCtx, cardId: Id<"cards">) =>
  ctx.db
    .query("cardEmbeddings")
    .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
    .unique();

const isClaimed = (row: Doc<"cardEmbeddings">, now: number) =>
  row.leaseUntil !== undefined && row.leaseUntil > now;

export type EmbeddingRowState =
  | "deleting"
  | "pending"
  | "lost_job"
  | "failed"
  | "embedded"
  | "missing";

export const classifyEmbeddingRow = (
  row: Doc<"cardEmbeddings"> | null,
  now: number
): EmbeddingRowState => {
  if (!row) {
    return "missing";
  }
  if (row.pendingVectorDeleteAt !== undefined) {
    return "deleting";
  }
  if (row.dueAt !== undefined) {
    return row.dueAt > now - LOST_EMBED_JOB_MS ? "pending" : "lost_job";
  }
  if (row.lastError !== undefined) {
    return "failed";
  }
  return row.hash === undefined ? "missing" : "embedded";
};

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

export const queueCardEmbedding = async (
  ctx: MutationCtx,
  row: Doc<"cardEmbeddings"> | null,
  cardId: Id<"cards">,
  userId: string,
  dueAt: number,
  { forgetHash = false }: { forgetHash?: boolean } = {}
) => {
  if (row) {
    await ctx.db.patch("cardEmbeddings", row._id, {
      attempts: undefined,
      dueAt,
      lastError: undefined,
      ...(forgetHash ? { hash: undefined } : {}),
    });
  } else {
    await ctx.db.insert("cardEmbeddings", { cardId, dueAt, userId });
  }
};

export const tombstoneCardEmbedding = async (
  ctx: MutationCtx,
  cardId: Id<"cards">
) => {
  const row = await rowFor(ctx, cardId);
  if (!row || row.pendingVectorDeleteAt !== undefined) {
    return;
  }
  if (row.shard === undefined) {
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
 * A job finished after the row moved on. If it wrote a vector, the stored
 * hash no longer says what the index holds: forget it so the next job
 * embeds for real.
 */
const handOffStaleJob = async (
  ctx: MutationCtx,
  row: Doc<"cardEmbeddings">,
  wroteVector: boolean
) => {
  if (row.dueAt === undefined && !wroteVector) {
    await ctx.db.patch("cardEmbeddings", row._id, { leaseUntil: undefined });
    return;
  }
  const dueAt = row.dueAt ?? Date.now();
  await ctx.db.patch("cardEmbeddings", row._id, {
    leaseUntil: undefined,
    ...(wroteVector ? { dueAt, hash: undefined } : {}),
  });
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
  type: cardTypeValidator,
  userId: v.string(),
});

export const claimDueEmbeddings = internalMutation({
  args: { cardIds: v.array(v.id("cards")) },
  returns: v.object({
    claimed: v.array(v.id("cards")),
    later: v.array(v.object({ cardId: v.id("cards"), dueAt: v.number() })),
  }),
  handler: async (ctx, { cardIds }) => {
    const now = Date.now();
    const dueBy = now + 1000;
    const claimed = new Set<Id<"cards">>();
    const owners = new Set<string>();
    const overflow: Id<"cards">[] = [];
    const later: { cardId: Id<"cards">; dueAt: number }[] = [];
    const claim = async (row: Doc<"cardEmbeddings">) => {
      await ctx.db.patch("cardEmbeddings", row._id, {
        leaseUntil: now + EMBED_CLAIM_LEASE_MS,
      });
      claimed.add(row.cardId);
      owners.add(row.userId);
    };
    for (const cardId of cardIds) {
      const row = await rowFor(ctx, cardId);
      if (
        !row ||
        row.dueAt === undefined ||
        row.pendingVectorDeleteAt !== undefined ||
        isClaimed(row, now) ||
        claimed.has(cardId)
      ) {
        continue;
      }
      if (row.dueAt > dueBy) {
        later.push({ cardId, dueAt: row.dueAt });
      } else if (claimed.size < EMBED_CLAIM_MAX_CARDS) {
        await claim(row);
      } else {
        overflow.push(cardId);
      }
    }
    for (const userId of owners) {
      if (claimed.size >= EMBED_CLAIM_MAX_CARDS) {
        break;
      }
      const due = await ctx.db
        .query("cardEmbeddings")
        .withIndex("by_userId_and_dueAt", (q) =>
          q.eq("userId", userId).gte("dueAt", 0).lte("dueAt", dueBy)
        )
        .take(EMBED_CLAIM_MAX_CARDS * 2);
      for (const row of due) {
        if (claimed.size >= EMBED_CLAIM_MAX_CARDS) {
          break;
        }
        if (
          !(
            claimed.has(row.cardId) ||
            row.pendingVectorDeleteAt !== undefined ||
            isClaimed(row, now)
          )
        ) {
          await claim(row);
        }
      }
    }
    if (overflow.length > 0) {
      await ctx.scheduler.runAfter(EMBED_CLAIM_GAP_MS, embedRef().embedDue, {
        cardIds: overflow,
      });
    }
    return { claimed: [...claimed], later };
  },
});

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
        ? await getDocumentTextRow(ctx, cardId)
        : null;
      const aiTranscript = await readCardTranscript(ctx, card, {
        maxParts: 1,
      });
      loaded.push({
        attempts: row.attempts,
        cardId,
        dueAt: row.dueAt,
        embeddedAt: row.embeddedAt,
        hash: row.hash,
        namespace: row.namespace,
        shard: row.shard,
        text: buildEmbeddingText({ ...card, aiTranscript }, extracted?.text),
        type: card.type,
        userId: card.userId,
      });
    }
    return loaded;
  },
});

export const recordEmbedded = internalMutation({
  args: {
    cardId: v.id("cards"),
    expectedDueAt: v.optional(v.number()),
    hash: v.optional(v.string()),
    namespace: v.optional(v.string()),
    shard: v.optional(v.number()),
    userId: v.optional(v.string()),
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
      if (row && !card && row.pendingVectorDeleteAt === undefined) {
        await ctx.db.patch("cardEmbeddings", row._id, {
          dueAt: undefined,
          leaseUntil: undefined,
          namespace: args.namespace ?? row.namespace,
          shard: args.shard ?? row.shard,
        });
        await tombstoneCardEmbedding(ctx, args.cardId);
      } else if (args.shard !== undefined && args.hash !== undefined) {
        const userId = row?.userId ?? args.userId;
        await ctx.scheduler.runAfter(0, embedRef().deleteVectorIds, {
          attempt: 1,
          ids: [args.cardId],
          shard: args.shard,
          ...(userId ? { userId } : {}),
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
      leaseUntil: undefined,
      namespace: args.namespace ?? row.namespace,
      shard: args.shard ?? row.shard,
    });
    return "recorded" as const;
  },
});

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
      leaseUntil: undefined,
    });
    return null;
  }
  const delay = EMBED_DEBOUNCE_MS * 2 ** attempts;
  await ctx.db.patch("cardEmbeddings", row._id, {
    attempts,
    dueAt: Date.now() + delay,
    lastError,
    leaseUntil: undefined,
  });
  return delay;
};

// One job per retried card would be the burst of small writes Vectorize
// rate-limits, so cards retried after the same delay go out in one job.
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

/**
 * Vectors whose delete ran out of retries, kept as tombstones so the ledger
 * sweep tries again. A card that already has a row keeps it.
 */
export const parkVectorDeletes = internalMutation({
  args: { ids: v.array(v.string()), shard: v.number(), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { ids, shard, userId }) => {
    for (const id of ids) {
      const cardId = ctx.db.normalizeId("cards", id);
      if (cardId && !(await rowFor(ctx, cardId))) {
        await ctx.db.insert("cardEmbeddings", {
          cardId,
          pendingVectorDeleteAt: Date.now(),
          shard,
          userId,
        });
      }
    }
    return null;
  },
});

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
