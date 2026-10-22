import {
  type FilesImageTextResult,
  linkOcrSourceKeys,
  normalizeImageOcrText,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { patchCardWithSearchSync } from "../card/searchSync";
import { callFilesWorkerJson } from "../storage/filesWorkerClient";
import {
  ocrBackfillArgs,
  ocrBackfillReturns,
  runOcrBackfillPage,
} from "./ocrBackfill";

const CARD_SPACING_MS = 3000;

export const backfillLinkOcr = internalMutation({
  args: ocrBackfillArgs,
  returns: ocrBackfillReturns,
  handler: (ctx, args) =>
    runOcrBackfillPage(ctx, args, {
      cardAction: internal.migration.backfillLinkOcr.backfillLinkOcrCard,
      hasSource: (card) =>
        linkOcrSourceKeys(card.metadata?.linkPreview).length > 0,
      isKind: (card) => card.type === "link",
      name: "backfillLinkOcr",
      nextPage: internal.migration.backfillLinkOcr.backfillLinkOcr,
      spacingMs: CARD_SPACING_MS,
    }),
});

export const getLinkOcrCandidate = internalQuery({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.null(),
    v.object({
      processingRev: v.optional(v.number()),
      sourceKeys: v.array(v.string()),
      userId: v.string(),
    })
  ),
  handler: async (ctx, { cardId }) => {
    const card = await ctx.db.get("cards", cardId);
    if (
      card?.type !== "link" ||
      card.isDeleted ||
      card.ocrCheckedAt !== undefined
    ) {
      return null;
    }
    const sourceKeys = linkOcrSourceKeys(card.metadata?.linkPreview);
    return sourceKeys.length > 0
      ? { processingRev: card.processingRev, sourceKeys, userId: card.userId }
      : null;
  },
});

export const storeLinkOcr = internalMutation({
  args: {
    cardId: v.id("cards"),
    processingRev: v.optional(v.number()),
    aiOcrText: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, { cardId, processingRev, aiOcrText }) => {
    const card = await ctx.db.get("cards", cardId);
    if (
      !card ||
      card.isDeleted ||
      card.ocrCheckedAt !== undefined ||
      card.processingRev !== processingRev
    ) {
      return false;
    }
    return await patchCardWithSearchSync(ctx, cardId, {
      aiOcrText: aiOcrText || undefined,
      ocrCheckedAt: Date.now(),
    });
  },
});

export const backfillLinkOcrCard = internalAction({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.literal("stored"),
    v.literal("empty"),
    v.literal("skipped"),
    v.literal("failed")
  ),
  handler: async (ctx, { cardId }) => {
    const candidate = await ctx.runQuery(
      internal.migration.backfillLinkOcr.getLinkOcrCandidate,
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
    const texts: string[] = [];
    try {
      for (const sourceKey of candidate.sourceKeys) {
        const outcome = await callFilesWorkerJson<FilesImageTextResult>({
          op: "extract-image-text",
          params: { sourceKey },
        });
        if (outcome.kind === "ok" && outcome.data.text) {
          texts.push(outcome.data.text);
        }
      }
    } catch (error) {
      console.warn("[backfillLinkOcr] reading failed", {
        cardId,
        message: error instanceof Error ? error.message : String(error),
      });
      return "failed";
    }
    const aiOcrText = normalizeImageOcrText(texts.join("\n\n"));
    const stored = await ctx.runMutation(
      internal.migration.backfillLinkOcr.storeLinkOcr,
      {
        cardId,
        processingRev: candidate.processingRev,
        ...(aiOcrText ? { aiOcrText } : {}),
      }
    );
    if (!stored) {
      return "skipped";
    }
    return aiOcrText ? "stored" : "empty";
  },
});
