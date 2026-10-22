import {
  FILES_UPLOAD_MAX_BYTES,
  type FilesInspectResult,
  isScannedPdf,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { accountDeletionOwnsRows } from "../accountDeletion";
import { patchCardWithSearchSync } from "../card/searchSync";
import { inferFileFormat } from "../shared/fileFormats";
import { callFilesWorkerJson } from "../storage/filesWorkerClient";
import { queueCardProcessing } from "../workflowDispatch";
import {
  ocrBackfillArgs,
  ocrBackfillReturns,
  runOcrBackfillPage,
} from "./ocrBackfill";

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
    const aiGate = await ctx.runQuery(internal.adminAccess.getAiGate, {
      userId: candidate.userId,
    });
    if (aiGate !== "allowed") {
      return "skipped";
    }
    let scanned: boolean;
    try {
      const outcome = await callFilesWorkerJson<FilesInspectResult>({
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
