"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { storeDocumentText } from "../card/documentText";
import { inferFileFormat } from "../shared/fileFormats";
import { extractFileTextForKey } from "../workflows/fileProcessing";

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
