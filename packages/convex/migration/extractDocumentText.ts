"use node";

import {
  extractDocumentFileText,
  type FilesInspectResult,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { storeDocumentText } from "../card/documentText";
import { inferFileFormat } from "../shared/fileFormats";
import { callFilesWorkerJson } from "../storage/filesWorkerClient";

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
      const extracted = await extractDocumentFileText(
        async (params) => {
          const outcome = await callFilesWorkerJson<FilesInspectResult>({
            op: "inspect",
            params: { ...params },
          });
          return outcome.kind === "ok" ? outcome : { kind: "fallback" };
        },
        card.fileKey,
        format,
        card
      );
      const { stored } = await storeDocumentText(ctx, card, extracted);
      return stored ? "stored" : "empty";
    } catch (error) {
      console.warn("[extractDocumentText] extraction failed", {
        cardId,
        message: error instanceof Error ? error.message : String(error),
      });
      return "failed";
    }
  },
});
