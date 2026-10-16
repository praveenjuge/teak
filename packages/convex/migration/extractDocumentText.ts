"use node";

import {
  FILES_UPLOAD_MAX_BYTES,
  type FilesInspectMode,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { storeDocumentText } from "../card/documentText";
import { type FileFormat, inferFileFormat } from "../shared/fileFormats";
import {
  callFilesWorkerJson,
  type FilesWorkerInspectResult,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";

const MAX_ARCHIVE_INSPECTION_BYTES = 25 * 1024 * 1024;
const MAX_SOURCE_INSPECTION_BYTES = 2 * 1024 * 1024;

/**
 * A document's text from the Files Worker, as card processing extracts it
 * (apps/files-worker/src/workflows/cardProcessing/fileProcessing.ts). Empty
 * text for formats without text and documents the Worker declines.
 */
const extractFileTextForKey = async (
  sourceKey: string,
  format: FileFormat,
  card: { fileMetadata?: { kind?: string } | null }
): Promise<{ pageCount?: number; text: string }> => {
  const archive = ["word", "powerpoint"].includes(format.id);
  const pdf = format.kind === "pdf";
  const text = ["markdown", "source", "text", "tokens"].includes(format.kind);
  if (!(archive || pdf || text)) {
    return { text: "" };
  }
  if (!isFilesWorkerConfigured()) {
    throw new Error("files_worker_not_configured");
  }
  let mode: FilesInspectMode = "text";
  let maxBytes = MAX_SOURCE_INSPECTION_BYTES;
  if (archive) {
    mode = "zip";
    maxBytes = MAX_ARCHIVE_INSPECTION_BYTES;
  } else if (pdf) {
    mode = "pdf";
    maxBytes = FILES_UPLOAD_MAX_BYTES;
  }
  const outcome = await callFilesWorkerJson<FilesWorkerInspectResult>({
    op: "inspect",
    params: {
      formatId: format.id,
      maxBytes,
      mode,
      rtf: text && card.fileMetadata?.kind === "text" && format.id === "rtf",
      sourceKey,
    },
  });
  if (outcome.kind !== "ok") {
    return { text: "" };
  }
  const pageCount = outcome.data.facts?.pageCount;
  return {
    text: outcome.data.text ?? "",
    ...(typeof pageCount === "number" && { pageCount }),
  };
};

/**
 * Extracts and stores one document card's text, for the document backfill
 * (migration/backfillDocumentText.ts). Cards that already have stored text,
 * have no file, or are in an unsupported format are left alone; a failure
 * is logged and the card stays without text, so a rerun picks it up again.
 */
export const extractDocumentText = internalAction({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.literal("stored"),
    v.literal("empty"),
    v.literal("skipped"),
    v.literal("failed")
  ),
  handler: async (ctx, { cardId }) => {
    const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
      cardId,
    });
    if (
      card?.type !== "document" ||
      card.hasExtractedText ||
      !(card.fileKey && card.fileMetadata?.fileName)
    ) {
      return "skipped";
    }
    const format = inferFileFormat({
      fileName: card.fileMetadata.fileName,
      mimeType: card.fileMetadata.mimeType,
    });
    if (!format) {
      return "skipped";
    }
    try {
      const extracted = await extractFileTextForKey(card.fileKey, format, card);
      const { stored } = await storeDocumentText(ctx, card, extracted);
      return stored ? "stored" : "empty";
    } catch (error) {
      console.warn("[backfillDocumentText] extraction failed", {
        cardId,
        message: error instanceof Error ? error.message : String(error),
      });
      return "failed";
    }
  },
});
