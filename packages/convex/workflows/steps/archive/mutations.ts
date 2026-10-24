import { ConvexError, v } from "convex/values";
import { internalMutation } from "../../../_generated/server";
import {
  mergeProcessingStages,
  stageCompleted,
  stageFailed,
  stageInProgress,
} from "../../../card/processingStatus";
import { patchCardWithSearchSync } from "../../../card/searchSync";
import { pageArchiveValidator, r2KeyValidator } from "../../../schema";
import { resolveSizeBucket } from "../../../shared/analytics";
import {
  PAGE_ARCHIVE_FAILURE_REASONS,
  pageArchiveSkipReason,
  toPageArchiveFailureReason,
} from "../../../shared/pageArchive";
import { buildR2UserPrefix, queueObjectDeletion } from "../../../storage/r2";
import { queueBackendEvent } from "../../../telemetry/schedule";
import { queueCardProcessing } from "../../../workflowDispatch";

const durationBucket = (ms: number): string => {
  if (ms < 5000) {
    return "<5s";
  }
  if (ms < 30_000) {
    return "5-30s";
  }
  if (ms < 120_000) {
    return "30s-2m";
  }
  return ">2m";
};

/**
 * Records a link's saved copy: the single write path for `pageArchive`. The
 * copy it replaces is deleted unless it is the same object, and so is the
 * extension's snapshot the copy was made from. A card highlighted since the
 * run began keeps its copy, and the new one is deleted. A snapshot sent after this run
 * read the card stays, and gets a run of its own.
 */
export const recordPageArchive = internalMutation({
  args: {
    archive: pageArchiveValidator,
    cardId: v.id("cards"),
    durationMs: v.optional(v.number()),
    /** The pending snapshot this copy was made from, if any. */
    snapshotKey: v.optional(r2KeyValidator),
  },
  returns: v.boolean(),
  handler: async (ctx, { archive, cardId, durationMs, snapshotKey }) => {
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      return false;
    }
    if (!archive.storageKey.startsWith(`${buildR2UserPrefix(card.userId)}/`)) {
      throw new ConvexError({
        code: "INVALID_STORAGE_KEY",
        message: "The archive is outside the card owner's storage",
      });
    }
    if (
      pageArchiveSkipReason(card) === "frozen" &&
      card.pageArchive?.storageKey !== archive.storageKey
    ) {
      // Highlighted while this run archived the page: the copy they were
      // made against stays, and this one goes.
      await queueObjectDeletion(ctx, archive.storageKey);
      await patchCardWithSearchSync(ctx, cardId, {
        processingStatus: mergeProcessingStages(card.processingStatus, {
          archive: stageCompleted(Date.now()),
        }),
      });
      return false;
    }
    const previous = card.pageArchive?.storageKey;
    if (previous && previous !== archive.storageKey) {
      await queueObjectDeletion(ctx, previous);
    }
    const pending = card.pendingPageSnapshotKey;
    const usedPending = pending !== undefined && pending === snapshotKey;
    if (usedPending) {
      await queueObjectDeletion(ctx, pending);
    }
    const now = Date.now();
    await patchCardWithSearchSync(ctx, cardId, {
      pageArchive: archive,
      processingStatus: mergeProcessingStages(card.processingStatus, {
        archive: stageCompleted(now),
      }),
      ...(usedPending
        ? {
            pendingPageSnapshotKey: undefined,
            pendingPageSnapshotAt: undefined,
          }
        : {}),
      updatedAt: now,
    });
    await queueBackendEvent(ctx, "page_archived", card.userId, {
      bytes_bucket: resolveSizeBucket(archive.bytes),
      duration_ms_bucket: durationBucket(durationMs ?? 0),
      kind: archive.kind,
      source: archive.source,
    });
    if (pending !== undefined && !usedPending && !card.isDeleted) {
      await queueCardProcessing(ctx, cardId, { archiveOnly: true });
    }
    return true;
  },
});

/** Marks the archive stage in progress or failed; a failure never fails the card. */
export const markPageArchiveStage = internalMutation({
  args: {
    cardId: v.id("cards"),
    reason: v.optional(
      v.union(
        ...PAGE_ARCHIVE_FAILURE_REASONS.map((reason) => v.literal(reason))
      )
    ),
    source: v.optional(v.union(v.literal("server"), v.literal("extension"))),
    status: v.union(v.literal("in_progress"), v.literal("failed")),
  },
  returns: v.boolean(),
  handler: async (ctx, { cardId, reason, source, status }) => {
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      return false;
    }
    const now = Date.now();
    const current = card.processingStatus?.archive;
    const failure = toPageArchiveFailureReason(reason);
    await patchCardWithSearchSync(ctx, cardId, {
      processingStatus: mergeProcessingStages(card.processingStatus, {
        archive:
          status === "in_progress"
            ? stageInProgress(now, current)
            : stageFailed(now, failure, current),
      }),
    });
    if (status === "failed") {
      await queueBackendEvent(ctx, "page_archive_failed", card.userId, {
        reason: failure,
        source: source ?? "server",
      });
    }
    return true;
  },
});
