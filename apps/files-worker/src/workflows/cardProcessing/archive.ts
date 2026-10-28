import { internal } from "@teak/convex/_generated/api";
import { normalizeUrl } from "@teak/convex/linkMetadata/url";
import {
  PAGE_ARCHIVE_ROLE,
  type PageArchiveFailureReason,
  type PageArchiveSkip,
  pageArchiveSkipReason,
} from "@teak/convex/shared/pageArchive";
import type { FilesArchivePageResult } from "@teak/files-protocol";
import type { StepConfig } from "../runtime";
import {
  type CardJob,
  ensureObjectOwnership,
  guardOf,
  loadCard,
  objectKey,
} from "./context";

/**
 * Three retries, 30 seconds apart: what fails here is a busy or missing
 * fetcher, not the page. A page that can't be had is a result, not an error.
 */
export const ARCHIVE_STEP: StepConfig = {
  retries: { backoff: "constant", delay: "30 seconds", limit: 3 },
  timeout: "5 minutes",
};

export type ArchiveOutcome =
  | { reason: PageArchiveSkip | "card_missing"; status: "skipped" }
  | { reason: PageArchiveFailureReason; status: "failed" }
  | { kind: "full" | "text_only"; status: "archived" };

const markStage = (
  job: CardJob,
  args: {
    reason?: PageArchiveFailureReason;
    source?: "extension" | "server";
    status: "failed" | "in_progress";
  }
) =>
  job.deps.convex.mutation(
    internal.workflows.steps.archive.mutations.markPageArchiveStage,
    { cardId: job.cardId, ...args },
    guardOf(job)
  );

/**
 * The stage failed for good: the step ran out of retries. A step that never
 * got as far as marking the stage in progress (Convex unreachable while it
 * read the card) leaves it pending, and the run still reports complete, so
 * nothing else would ever close it.
 */
export const markArchiveFailed = async (job: CardJob): Promise<null> => {
  const loaded = await loadCard(job);
  const status = loaded?.card.processingStatus?.archive?.status;
  if (!loaded || (status !== "pending" && status !== "in_progress")) {
    return null;
  }
  await markStage(job, {
    reason: "unreachable",
    source: loaded.card.pendingPageSnapshotKey ? "extension" : "server",
    status: "failed",
  });
  return null;
};

const isSupersededMessage = (error: unknown) =>
  /stale_processing_revision|card_missing/u.test(
    error instanceof Error ? error.message : String(error)
  );

/**
 * The "archive page" step: a link's saved copy, from the page the extension
 * sent or the one Teak fetches. The output key carries the run's revision,
 * so a retry rewrites the same object and an older run's object is never the
 * newer one's. It is registered to the account before it is written, and
 * deleted again when the card moved on before the copy was recorded.
 */
export const archivePage = async (job: CardJob): Promise<ArchiveOutcome> => {
  const loaded = await loadCard(job);
  if (!loaded) {
    return { reason: "card_missing", status: "skipped" };
  }
  const { card } = loaded;
  const skip = pageArchiveSkipReason(card, { refresh: job.refresh });
  if (skip) {
    return { reason: skip, status: "skipped" };
  }
  const url = card.url as string;
  const snapshotKey = card.pendingPageSnapshotKey;
  const startedAt = Date.now();
  await markStage(job, { status: "in_progress" });

  const destinationKey = objectKey(loaded, {
    cardId: job.cardId,
    fileName: "archive.html",
    objectId: `r${job.rev}`,
    role: PAGE_ARCHIVE_ROLE,
  });
  await ensureObjectOwnership(job, card.userId, destinationKey);
  const outcome = await job.deps.filesOp<FilesArchivePageResult>({
    op: "archive-page",
    params: {
      capturedAt: startedAt,
      destinationKey,
      url: normalizeUrl(url),
      ...(job.refresh ? { fresh: true } : {}),
      ...(snapshotKey ? { snapshotKey } : {}),
    },
  });
  const source = snapshotKey ? "extension" : "server";
  if (outcome.kind === "fallback") {
    const reason: PageArchiveFailureReason =
      outcome.code === "PAYLOAD_TOO_LARGE" ? "too_large" : "archive_error";
    await markStage(job, { reason, source, status: "failed" });
    return { reason, status: "failed" };
  }
  const result = outcome.data;
  if (!result.stored) {
    await markStage(job, { reason: result.reason, source, status: "failed" });
    return { reason: result.reason, status: "failed" };
  }
  try {
    await job.deps.convex.mutation(
      internal.workflows.steps.archive.mutations.recordPageArchive,
      {
        archive: {
          bytes: result.bytes,
          capturedAt: startedAt,
          kind: result.kind,
          source: result.source,
          sourceUrl: result.pageUrl,
          storageKey: result.storageKey,
        },
        cardId: job.cardId,
        durationMs: Date.now() - startedAt,
        ...(snapshotKey ? { snapshotKey } : {}),
      },
      guardOf(job)
    );
  } catch (error) {
    if (isSupersededMessage(error)) {
      // A newer run or a deleted card: nothing will ever point at this copy.
      await job.deps
        .filesOp({ op: "delete-object", params: { key: destinationKey } })
        .catch(() => undefined);
    }
    throw error;
  }
  return { kind: result.kind, status: "archived" };
};
