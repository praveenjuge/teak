import { FILES_UPLOAD_MAX_BYTES, isScannedPdf } from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { accountDeletionOwnsRows } from "../accountDeletion";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import { inferFileFormat } from "../shared/fileFormats";
import {
  callFilesWorkerJson,
  type FilesWorkerInspectResult,
} from "../storage/filesWorkerClient";
import { queueCardProcessing } from "../workflowDispatch";
import {
  ocrBackfillArgs,
  ocrBackfillReturns,
  runOcrBackfillPage,
} from "./ocrBackfill";

/**
 * One PDF this far apart. A scan then reads up to 3 pages, each a renderer
 * job and a Gemma call, and renderer slots are shared with thumbnails.
 */
const CARD_SPACING_MS = 3000;

const isPdfCard = (
  card: Pick<Doc<"cards">, "fileMetadata" | "type">
): boolean => {
  const fileName = card.fileMetadata?.fileName;
  return (
    card.type === "document" &&
    Boolean(fileName) &&
    inferFileFormat({
      fileName: fileName as string,
      mimeType: card.fileMetadata?.mimeType,
    })?.kind === "pdf"
  );
};

/**
 * Reads the first pages of scanned PDFs saved before Teak read them. Each
 * PDF's text layer is checked with the same `inspect` op card processing
 * uses; a PDF with a text layer is marked checked, and a scan gets a
 * metadata-only processing run, which reads its pages and writes its
 * summary and tags again from them (they were written from its file name).
 * One PDF every 3 s; cards in Trash and accounts being deleted or with AI
 * turned off are skipped, and each card checks the AI gate again. A card is
 * done once `ocrCheckedAt` is set, so a stopped run picks up where it left
 * off.
 *
 * A dry run (the default) writes nothing and counts the PDFs a real run
 * would check. `userId` limits it to one account, as a canary; `once` runs
 * one batch.
 *
 *   npx convex run migration/backfillPdfOcr:backfillPdfOcr
 *   npx convex run migration/backfillPdfOcr:backfillPdfOcr '{"dryRun":false,"userId":"teak_…"}'
 *   npx convex run migration/backfillPdfOcr:backfillPdfOcr '{"dryRun":false}'
 */
export const backfillPdfOcr = internalMutation({
  args: ocrBackfillArgs,
  returns: ocrBackfillReturns,
  handler: (ctx, args) =>
    runOcrBackfillPage(ctx, args, {
      cardAction: internal.migration.backfillPdfOcr.backfillPdfOcrCard,
      hasSource: (card) => Boolean(card.fileKey),
      isKind: isPdfCard,
      name: "backfillPdfOcr",
      nextPage: internal.migration.backfillPdfOcr.backfillPdfOcr,
      spacingMs: CARD_SPACING_MS,
    }),
});

export const getPdfOcrCandidate = internalQuery({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.null(),
    v.object({
      processingRev: v.optional(v.number()),
      sourceKey: v.string(),
      userId: v.string(),
    })
  ),
  handler: async (ctx, { cardId }) => {
    const card = await ctx.db.get("cards", cardId);
    if (
      !(card?.fileKey && isPdfCard(card)) ||
      card.isDeleted ||
      card.ocrCheckedAt !== undefined
    ) {
      return null;
    }
    return {
      processingRev: card.processingRev,
      sourceKey: card.fileKey,
      userId: card.userId,
    };
  },
});

/**
 * Marks a PDF with a text layer checked, or starts a metadata-only run for
 * a scan, unless card processing ran since it was checked (that run reads
 * the scan itself) or the card was read or trashed since.
 */
export const finishPdfOcrCheck = internalMutation({
  args: {
    cardId: v.id("cards"),
    processingRev: v.optional(v.number()),
    scanned: v.boolean(),
  },
  returns: v.boolean(),
  handler: async (ctx, { cardId, processingRev, scanned }) => {
    const card = await ctx.db.get("cards", cardId);
    if (
      !card ||
      card.isDeleted ||
      card.ocrCheckedAt !== undefined ||
      card.processingRev !== processingRev
    ) {
      return false;
    }
    if (scanned) {
      // An account whose deletion started since the page was scheduled
      // gets no new run.
      if (await accountDeletionOwnsRows(ctx, card.userId)) {
        return false;
      }
      return Boolean(
        await queueCardProcessing(ctx, cardId, { metadataOnly: true })
      );
    }
    return await patchCardWithSearchSync(ctx, cardId, {
      ocrCheckedAt: Date.now(),
    });
  },
});

/**
 * Checks one PDF's text layer and finishes it as a scan or not. A PDF the
 * Worker declines (gone, too large, password protected) has no page count,
 * so it isn't a scan. Any other failure, a busy renderer included, is
 * logged and leaves the card unread for a rerun.
 */
export const backfillPdfOcrCard = internalAction({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.literal("queued"),
    v.literal("checked"),
    v.literal("skipped"),
    v.literal("failed")
  ),
  handler: async (ctx, { cardId }) => {
    const candidate = await ctx.runQuery(
      internal.migration.backfillPdfOcr.getPdfOcrCandidate,
      { cardId }
    );
    if (!candidate) {
      return "skipped";
    }
    // AI paused from the console, or turned off by the user: no model call,
    // and the card stays unread for a later run.
    const aiGate = await ctx.runQuery(internal.adminAccess.getAiGate, {
      userId: candidate.userId,
    });
    if (aiGate !== "allowed") {
      return "skipped";
    }
    let scanned: boolean;
    try {
      const outcome = await callFilesWorkerJson<FilesWorkerInspectResult>({
        op: "inspect",
        params: {
          formatId: "pdf",
          maxBytes: FILES_UPLOAD_MAX_BYTES,
          mode: "pdf",
          rtf: false,
          sourceKey: candidate.sourceKey,
        },
      });
      scanned =
        outcome.kind === "ok" &&
        isScannedPdf({
          pageCount: outcome.data.facts?.pageCount,
          text: outcome.data.text ?? "",
        });
    } catch (error) {
      console.warn("[backfillPdfOcr] checking failed", {
        cardId,
        message: error instanceof Error ? error.message : String(error),
      });
      return "failed";
    }
    const finished = await ctx.runMutation(
      internal.migration.backfillPdfOcr.finishPdfOcrCheck,
      { cardId, processingRev: candidate.processingRev, scanned }
    );
    if (!finished) {
      return "skipped";
    }
    return scanned ? "queued" : "checked";
  },
});
