import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { requireTeakUserId } from "../securitySessions";
import { buildR2ObjectKey, deleteObject } from "../storage/r2";
import {
  isArxivPdfUrl,
  parseArxivId,
} from "../workflows/steps/categorization/remote/arxiv";
import { clientCardSourceValidator } from "./createCard";
import { ensureCardQuotaAvailable } from "./quota";
import { createUploadedCardForUser } from "./uploadCard";

// Save PDF: an arXiv link card's paper as its own document card. The
// `linkedPdfs` row records which document came from which link, so saving
// twice returns the same document, two saves at once make one, and a
// document deleted for good can be saved again.

/**
 * A claim younger than this is a save still running. Longer than the
 * download's 150 s limit, so a slow save isn't claimed twice.
 */
export const LINKED_PDF_CLAIM_TTL_MS = 3 * 60 * 1000;

export const SAVE_PDF_ERROR_MESSAGES = {
  IN_PROGRESS: "This PDF is already being saved. Try again in a moment.",
  NO_PDF: "This card has no PDF to save.",
  NOT_FOUND: "Card not found",
  TRASHED: "Restore this card from Trash before saving its PDF.",
} as const;

/** `2401.12345.pdf`, or `hep-th-9901001.pdf` for an old-style id. */
const linkedPdfFileName = (pdfUrl: string) =>
  `${(parseArxivId(pdfUrl) ?? "paper").replace(/\//g, "-")}.pdf`;

const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};

export const linkedPdfSourceValidator = v.union(
  clientCardSourceValidator,
  v.literal("api")
);

export type LinkedPdfClaim =
  | { cardId: Id<"cards">; kind: "existing" }
  | {
      claimToken: string;
      fileKey: string;
      fileName: string;
      kind: "claimed";
      linkedPdfId: Id<"linkedPdfs">;
      pdfUrl: string;
    };

const existingDocument = async (
  ctx: Pick<MutationCtx, "db">,
  row: Doc<"linkedPdfs">
): Promise<Id<"cards"> | null> => {
  if (row.status !== "done" || !row.cardId) {
    return null;
  }
  // A document in Trash counts as gone, so the paper can be saved again.
  const card = await ctx.db.get("cards", row.cardId);
  return card && !card.isDeleted ? card._id : null;
};

/**
 * Claims the save for one link card, or returns the document an earlier
 * save made. Refuses another user's card, a card in Trash, a card with no
 * arXiv PDF, a save already running, and an account at its card limit.
 */
export const claimLinkedPdf = internalMutation({
  args: { cardId: v.string(), userId: v.string() },
  returns: v.any(),
  handler: async (ctx, args): Promise<LinkedPdfClaim> => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const cardId = ctx.db.normalizeId("cards", args.cardId);
    const card = cardId ? await ctx.db.get("cards", cardId) : null;
    if (!(card && card.userId === userId)) {
      return fail("NOT_FOUND", SAVE_PDF_ERROR_MESSAGES.NOT_FOUND);
    }
    if (card.isDeleted) {
      return fail("CONFLICT", SAVE_PDF_ERROR_MESSAGES.TRASHED);
    }
    const pdfUrl = card.metadata?.linkCategory?.pdfUrl;
    const arxivId = pdfUrl ? parseArxivId(pdfUrl) : null;
    if (card.type !== "link" || !(pdfUrl && arxivId && isArxivPdfUrl(pdfUrl))) {
      return fail("INVALID_INPUT", SAVE_PDF_ERROR_MESSAGES.NO_PDF);
    }

    const now = Date.now();
    const row = await ctx.db
      .query("linkedPdfs")
      .withIndex("by_sourceCardId", (q) => q.eq("sourceCardId", card._id))
      .unique();
    if (row && row.pdfUrl === pdfUrl) {
      const documentId = await existingDocument(ctx, row);
      if (documentId) {
        return { cardId: documentId, kind: "existing" };
      }
      if (
        row.status === "pending" &&
        now - row.updatedAt < LINKED_PDF_CLAIM_TTL_MS
      ) {
        return fail("IN_PROGRESS", SAVE_PDF_ERROR_MESSAGES.IN_PROGRESS);
      }
    }
    // Refused here rather than after the download; the document's own
    // creation checks again.
    await ensureCardQuotaAvailable(ctx, userId);

    const claimToken = crypto.randomUUID();
    const fileName = linkedPdfFileName(pdfUrl);
    // A retry for the same paper keeps the key, so a PDF stored before an
    // interruption is reused rather than downloaded again. A finished row's
    // key belongs to its document, so saving again gets a new one.
    const fileKey =
      row && row.pdfUrl === pdfUrl && row.status !== "done"
        ? row.fileKey
        : buildR2ObjectKey({
            userId,
            cardId: "stored",
            role: "file",
            fileName,
          });
    let linkedPdfId: Id<"linkedPdfs">;
    if (row) {
      await ctx.db.patch("linkedPdfs", row._id, {
        cardId: undefined,
        claimToken,
        fileKey,
        pdfUrl,
        status: "pending",
        updatedAt: now,
      });
      linkedPdfId = row._id;
    } else {
      linkedPdfId = await ctx.db.insert("linkedPdfs", {
        claimToken,
        createdAt: now,
        fileKey,
        pdfUrl,
        sourceCardId: card._id,
        status: "pending",
        updatedAt: now,
        userId,
      });
    }
    return {
      claimToken,
      fileKey,
      fileName,
      kind: "claimed",
      linkedPdfId,
      pdfUrl,
    };
  },
});

/**
 * Creates the document card for a stored PDF and marks the claim done, in
 * one transaction. A claim another save finished returns its document.
 */
export const completeLinkedPdf = internalMutation({
  args: {
    claimToken: v.string(),
    fileSize: v.number(),
    linkedPdfId: v.id("linkedPdfs"),
    source: linkedPdfSourceValidator,
    storedMimeType: v.string(),
    userId: v.string(),
  },
  returns: v.object({ cardId: v.id("cards"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const row = await ctx.db.get("linkedPdfs", args.linkedPdfId);
    if (!row || row.userId !== userId) {
      return fail("NOT_FOUND", SAVE_PDF_ERROR_MESSAGES.NOT_FOUND);
    }
    const documentId = await existingDocument(ctx, row);
    if (documentId) {
      return { cardId: documentId, created: false };
    }
    if (row.claimToken !== args.claimToken || row.status !== "pending") {
      return fail("IN_PROGRESS", SAVE_PDF_ERROR_MESSAGES.IN_PROGRESS);
    }
    const cardId = await createUploadedCardForUser(ctx, {
      cardType: "document",
      fileKey: row.fileKey,
      fileName: linkedPdfFileName(row.pdfUrl),
      fileSize: args.fileSize,
      fileType: "application/pdf",
      source: args.source,
      storedFileSize: args.fileSize,
      storedFileType: args.storedMimeType,
      userId,
    });
    await ctx.db.patch("linkedPdfs", row._id, {
      cardId,
      status: "done",
      updatedAt: Date.now(),
    });
    return { cardId, created: true };
  },
});

/**
 * Releases a claim that couldn't make its document, so the next try claims
 * it again at once instead of waiting out the claim. A claim whose row is
 * gone (the link was deleted for good mid-save) drops the PDF it stored.
 */
export const failLinkedPdf = internalMutation({
  args: {
    claimToken: v.string(),
    fileKey: v.string(),
    linkedPdfId: v.id("linkedPdfs"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("linkedPdfs", args.linkedPdfId);
    if (!row) {
      await deleteObject(ctx, args.fileKey);
      return null;
    }
    if (row.status === "pending" && row.claimToken === args.claimToken) {
      await ctx.db.patch("linkedPdfs", row._id, {
        status: "failed",
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
