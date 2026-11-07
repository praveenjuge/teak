import type { FunctionReference } from "convex/server";
import { type ObjectType, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion/gate";
import { readUserFlags } from "../adminAccess";
import { isCoreWorkerConfigured } from "../storage/coreWorkerClient";
import { backfillArgs, backfillReturns, runBackfillPage } from "./runner";

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
  ...backfillArgs(ocrBackfillTotalsValidator),
  userId: v.optional(v.string()),
};

export const ocrBackfillReturns = backfillReturns(ocrBackfillTotalsValidator);

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

export const runOcrBackfillPage = (
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
  if (!((args.dryRun ?? true) || isCoreWorkerConfigured())) {
    throw new Error("files_worker_not_configured");
  }
  const { userId } = args;
  return runBackfillPage(ctx, args, {
    batchSize: { default: 25, max: 100 },
    empty: emptyTotals,
    name: userId ? `${backfill.name} for ${userId}` : backfill.name,
    // The queued cards run spaced out, so the next page waits for them.
    nextPageDelayMs: (batch, dryRun) =>
      dryRun ? 0 : batch.queued * backfill.spacingMs,
    read: (cursor, numItems) =>
      (userId
        ? ctx.db
            .query("cards")
            .withIndex("by_created", (q) => q.eq("userId", userId))
        : ctx.db.query("cards")
      ).paginate({ cursor, numItems }),
    self: backfill.nextPage,
    visit: async (cards, batch, dryRun) => {
      const accountDeleting = createAccountDeletionGate(ctx);
      const aiDisabled = new Map<string, boolean>();
      for (const card of cards) {
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
          disabled = Boolean(
            (await readUserFlags(ctx, card.userId))?.aiDisabled
          );
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
      return userId ? { userId } : undefined;
    },
  });
};
