import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { requireTeakUserId } from "../securitySessions";
import { RATE_LIMIT_CONFIG, rateLimiter } from "../shared/rateLimits";
import { STORE_LINKED_PDF_TIMEOUT_MS } from "../storage/filesWorkerClient";
import { buildR2ObjectKey, deleteObject } from "../storage/r2";
import {
  isArxivPdfUrl,
  parseArxivId,
} from "../workflows/steps/categorization/remote/arxiv";
import { clientCardSourceValidator } from "./createCard";
import { ensureCardQuotaAvailable } from "./quota";
import { createUploadedCardForUser } from "./uploadCard";

const LINKED_PDF_CLAIM_MARGIN_MS = 30_000;
export const LINKED_PDF_CLAIM_TTL_MS =
  STORE_LINKED_PDF_TIMEOUT_MS + LINKED_PDF_CLAIM_MARGIN_MS;

export const SAVE_PDF_ERROR_MESSAGES = {
  IN_PROGRESS: "This PDF is already being saved. Try again in a moment.",
  NO_PDF: "This card has no PDF to save.",
  NOT_FOUND: "Card not found",
  RATE_LIMITED: "You're saving quickly. Try again in a minute.",
  TRASHED: "Restore this card from Trash before saving its PDF.",
} as const;

const linkedPdfFileName = (pdfUrl: string) =>
  `${(parseArxivId(pdfUrl) ?? "paper").replace(/\//g, "-")}.pdf`;

const fail = (
  code: string,
  message: string,
  extra: Record<string, unknown> = {}
): never => {
  throw new ConvexError({ code, message, ...extra });
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
  const card = await ctx.db.get("cards", row.cardId);
  return card && !card.isDeleted ? card._id : null;
};

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
    await ensureCardQuotaAvailable(ctx, userId);
    const allowed = await rateLimiter.limit(ctx, "savePdf", {
      key: userId,
      throws: false,
    });
    if (!allowed.ok) {
      fail("RATE_LIMITED", SAVE_PDF_ERROR_MESSAGES.RATE_LIMITED, {
        limit: RATE_LIMIT_CONFIG.savePdf.capacity,
        retryAt: Date.now() + allowed.retryAfter,
      });
    }

    const claimToken = crypto.randomUUID();
    const fileName = linkedPdfFileName(pdfUrl);
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
    if (row && row.status !== "done" && row.fileKey !== fileKey) {
      await deleteObject(ctx, row.fileKey);
    }
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

export const failLinkedPdf = internalMutation({
  args: {
    claimToken: v.string(),
    fileKey: v.string(),
    linkedPdfId: v.id("linkedPdfs"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("linkedPdfs", args.linkedPdfId);
    if (!row || row.fileKey !== args.fileKey) {
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
