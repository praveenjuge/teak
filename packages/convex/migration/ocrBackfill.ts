import type { FunctionReference } from "convex/server";
import { type ObjectType, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";
import { readUserFlags } from "../adminAccess";
import { isFilesWorkerConfigured } from "../storage/filesWorkerClient";

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;

export const ocrBackfillTotalsValidator = v.object({
  examined: v.number(),
  alreadyRead: v.number(),
  noSource: v.number(),
  trashed: v.number(),
  queued: v.number(),
  skippedDeletingAccounts: v.number(),
  skippedAiDisabled: v.number(),
});

export type OcrBackfillTotals = typeof ocrBackfillTotalsValidator.type;

export const ocrBackfillArgs = {
  cursor: v.optional(v.union(v.string(), v.null())),
  dryRun: v.optional(v.boolean()),
  batchSize: v.optional(v.number()),
  once: v.optional(v.boolean()),
  userId: v.optional(v.string()),
  totals: v.optional(ocrBackfillTotalsValidator),
};

export const ocrBackfillReturns = v.object({
  dryRun: v.boolean(),
  isDone: v.boolean(),
  continueCursor: v.union(v.string(), v.null()),
  continuationScheduled: v.boolean(),
  batch: ocrBackfillTotalsValidator,
  totals: ocrBackfillTotalsValidator,
});

type OcrBackfillPageArgs = ObjectType<typeof ocrBackfillArgs>;

const emptyTotals = (): OcrBackfillTotals => ({
  examined: 0,
  alreadyRead: 0,
  noSource: 0,
  trashed: 0,
  queued: 0,
  skippedDeletingAccounts: 0,
  skippedAiDisabled: 0,
});

export const runOcrBackfillPage = async (
  ctx: MutationCtx,
  args: OcrBackfillPageArgs,
  backfill: {
    cardAction: FunctionReference<
      "action",
      "internal",
      { cardId: Id<"cards"> }
    >;
    isKind: (card: Doc<"cards">) => boolean;
    hasSource: (card: Doc<"cards">) => boolean;
    name: string;
    nextPage: FunctionReference<"mutation", "internal", OcrBackfillPageArgs>;
    spacingMs: number;
  }
) => {
  const dryRun = args.dryRun ?? true;
  if (!(dryRun || isFilesWorkerConfigured())) {
    throw new Error("files_worker_not_configured");
  }
  const batchSize = Math.min(
    MAX_BATCH_SIZE,
    Math.max(1, Math.floor(args.batchSize ?? DEFAULT_BATCH_SIZE))
  );
  const { userId } = args;
  const cards = userId
    ? ctx.db
        .query("cards")
        .withIndex("by_created", (q) => q.eq("userId", userId))
    : ctx.db.query("cards");
  const page = await cards.paginate({
    cursor: args.cursor ?? null,
    numItems: batchSize,
  });

  const batch = emptyTotals();
  const accountDeleting = createAccountDeletionGate(ctx);
  const aiDisabled = new Map<string, boolean>();
  for (const card of page.page) {
    batch.examined += 1;
    if (!backfill.isKind(card)) {
      continue;
    }
    if (card.ocrCheckedAt !== undefined) {
      batch.alreadyRead += 1;
      continue;
    }
    if (card.isDeleted) {
      batch.trashed += 1;
      continue;
    }
    if (!backfill.hasSource(card)) {
      batch.noSource += 1;
      continue;
    }
    if (await accountDeleting(card.userId)) {
      batch.skippedDeletingAccounts += 1;
      continue;
    }
    let disabled = aiDisabled.get(card.userId);
    if (disabled === undefined) {
      disabled = Boolean((await readUserFlags(ctx, card.userId))?.aiDisabled);
      aiDisabled.set(card.userId, disabled);
    }
    if (disabled) {
      batch.skippedAiDisabled += 1;
      continue;
    }
    if (!dryRun) {
      await ctx.scheduler.runAfter(
        batch.queued * backfill.spacingMs,
        backfill.cardAction,
        { cardId: card._id }
      );
    }
    batch.queued += 1;
  }

  const previous = args.totals ?? emptyTotals();
  const totals = Object.fromEntries(
    Object.entries(batch).map(([key, value]) => [
      key,
      previous[key as keyof OcrBackfillTotals] + value,
    ])
  ) as OcrBackfillTotals;
  const isDone = page.isDone;
  const continuationScheduled = !(isDone || args.once);
  if (continuationScheduled) {
    await ctx.scheduler.runAfter(
      dryRun ? 0 : batch.queued * backfill.spacingMs,
      backfill.nextPage,
      {
        cursor: page.continueCursor,
        dryRun,
        batchSize,
        ...(userId ? { userId } : {}),
        totals,
      }
    );
  } else if (isDone) {
    console.log(`${backfill.name} finished`, {
      dryRun,
      ...(userId ? { userId } : {}),
      ...totals,
    });
  }
  return {
    dryRun,
    isDone,
    continueCursor: isDone ? null : page.continueCursor,
    continuationScheduled,
    batch,
    totals,
  };
};
