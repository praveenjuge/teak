"use node";

import type { FilesLinkedPdfResult } from "@teak/files-protocol";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { type ActionCtx, action, internalAction } from "../_generated/server";
import {
  requireSessionUser,
  requireTeakUserId,
  type TeakUserId,
} from "../securitySessions";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import { ensureObjectOwnership } from "../storage/ownership";
import type { LinkedPdfClaim } from "./linkedPdfs";

const savedPdfValidator = v.object({
  cardId: v.id("cards"),
  created: v.boolean(),
});

export interface SavedLinkedPdf {
  cardId: Id<"cards">;
  created: boolean;
}

export const SAVE_PDF_DOWNLOAD_MESSAGES = {
  SERVICE_UNAVAILABLE: "Couldn't get the PDF from arXiv. Try again.",
  FILE_TOO_LARGE: "This PDF is too large. Teak keeps files up to 100 MB.",
  UNSUPPORTED_TYPE: "arXiv didn't send a PDF for this paper.",
} as const;

const fail = (code: keyof typeof SAVE_PDF_DOWNLOAD_MESSAGES): never => {
  throw new ConvexError({ code, message: SAVE_PDF_DOWNLOAD_MESSAGES[code] });
};

const downloadFailure = (
  result: Extract<FilesLinkedPdfResult, { stored: false }>
): never => {
  if (result.reason === "too_large") {
    return fail("FILE_TOO_LARGE");
  }
  if (result.reason === "unsupported_type") {
    return fail("UNSUPPORTED_TYPE");
  }
  return fail("SERVICE_UNAVAILABLE");
};

export const saveLinkedPdfFor = async (
  ctx: ActionCtx,
  userId: TeakUserId,
  cardId: string,
  source: "api" | "web"
): Promise<SavedLinkedPdf> => {
  if (!isFilesWorkerConfigured()) {
    return fail("SERVICE_UNAVAILABLE");
  }
  const claim: LinkedPdfClaim = await ctx.runMutation(
    internal.card.linkedPdfs.claimLinkedPdf,
    { cardId, userId }
  );
  if (claim.kind === "existing") {
    return { cardId: claim.cardId, created: false };
  }
  try {
    await ensureObjectOwnership(ctx, userId, claim.fileKey);
    // A Worker that can't be reached, times out or errors is unavailable.
    const outcome = await callFilesWorkerJson<FilesLinkedPdfResult>({
      op: "store-linked-pdf",
      params: { destinationKey: claim.fileKey, url: claim.pdfUrl },
    }).catch(() => fail("SERVICE_UNAVAILABLE"));
    if (outcome.kind !== "ok") {
      return fail("SERVICE_UNAVAILABLE");
    }
    if (!outcome.data.stored) {
      return downloadFailure(outcome.data);
    }
    return await ctx.runMutation(internal.card.linkedPdfs.completeLinkedPdf, {
      claimToken: claim.claimToken,
      fileSize: outcome.data.size,
      linkedPdfId: claim.linkedPdfId,
      source,
      storedMimeType: outcome.data.contentType,
      userId,
    });
  } catch (error) {
    await ctx
      .runMutation(internal.card.linkedPdfs.failLinkedPdf, {
        claimToken: claim.claimToken,
        fileKey: claim.fileKey,
        linkedPdfId: claim.linkedPdfId,
      })
      .catch(() => undefined);
    throw error;
  }
};

export const saveLinkedPdfForUser = internalAction({
  args: { cardId: v.string(), userId: v.string() },
  returns: savedPdfValidator,
  handler: async (ctx, { cardId, userId }) =>
    await saveLinkedPdfFor(
      ctx,
      await requireTeakUserId(ctx, userId),
      cardId,
      "api"
    ),
});

export const saveLinkedPdf = action({
  args: { cardId: v.id("cards") },
  returns: savedPdfValidator,
  handler: async (ctx, { cardId }) => {
    const user = await requireSessionUser(ctx);
    return await saveLinkedPdfFor(ctx, user.teakUserId, cardId, "web");
  },
});
