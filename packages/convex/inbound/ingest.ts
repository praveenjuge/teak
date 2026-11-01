import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server";
import { createCardForUserHandler } from "../card/createCard";
import { mintPendingUpload, signPendingUpload } from "../publicApiUploads";
import { CARD_ERROR_CODES } from "../shared/constants";
import { rateLimiter } from "../shared/rateLimits";
import { normalizeIdentityEmail } from "../shared/workosIds";
import { queueObjectDeletion } from "../storage/r2";
import { queueInboundEmailEvent } from "../telemetry/schedule";
import { ATTACHMENT_CLAIM_TTL_MS } from "./attachmentClaims";
import { readInboundSettings } from "./settings";

// Save by email: what the Core Worker's verified mail becomes. The worker
// has already checked the sender passed DMARC; this matches the sender to the
// account whose sign-in email it is, if that account turned Save by email on.

export const EMAIL_TAG = "email";
const MAX_ATTACHMENTS = 50;
// Rows read for one sender address: deleted accounts that had it, and the
// live one.
const MAX_SENDER_ROWS = 20;

/** The account mail from `email` saves to, or null (rejected at SMTP). */
export const findSender = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.null(), v.object({ userId: v.string() })),
  handler: async (ctx, { email }) => {
    // A deleted account keeps its row and its email, so someone who deletes
    // their account and signs up again with the same address has two rows:
    // only the live one counts. Two live ones are ambiguous.
    const live = (
      await ctx.db
        .query("users")
        .withIndex("by_email", (q) =>
          q.eq("email", normalizeIdentityEmail(email))
        )
        // Newest first: a re-signup's live row comes after the deleted ones.
        .order("desc")
        .take(MAX_SENDER_ROWS)
    ).filter(
      (row) => row.deletedAt === undefined && row.workosDeletedAt === undefined
    );
    const user = live.length === 1 ? live[0] : undefined;
    if (!user?.emailVerified) {
      return null;
    }
    const settings = await readInboundSettings(ctx, user.teakUserId);
    return settings?.enabled ? { userId: user.teakUserId } : null;
  },
});

const planValidator = v.union(
  v.object({
    kind: v.literal("link"),
    notes: v.optional(v.string()),
    url: v.string(),
  }),
  v.object({ kind: v.literal("text"), markdown: v.string() }),
  v.object({ kind: v.literal("empty") })
);

const attachmentValidator = v.object({
  fileName: v.string(),
  index: v.number(),
  mimeType: v.string(),
  size: v.number(),
});

const uploadValidator = v.object({
  fileKey: v.string(),
  index: v.number(),
  uploadUrl: v.string(),
});

const ingestResult = v.object({
  receiptKey: v.union(v.string(), v.null()),
  status: v.union(
    v.literal("saved"),
    v.literal("duplicate"),
    v.literal("dropped"),
    v.literal("empty"),
    v.literal("unknown_sender")
  ),
  uploads: v.array(uploadValidator),
});

type PendingAttachment = NonNullable<
  Doc<"inboundEmailReceipts">["pendingAttachments"]
>[number];

const errorCode = (error: unknown): string | undefined =>
  error instanceof ConvexError
    ? (error.data as { code?: string } | undefined)?.code
    : undefined;

const emit = (
  ctx: MutationCtx,
  args:
    | {
        event: "email_received";
        outcome:
          | "saved"
          | "dropped_limit"
          | "dropped_rate"
          | "empty"
          | "duplicate";
        userId: string;
      }
    | {
        event: "email_attachment_skipped";
        reason: "format" | "size" | "limit";
        userId: string;
      }
) => queueInboundEmailEvent(ctx, args);

// What upload validation says about a file Teak won't take. Any other error
// (an account being deleted, say) fails the email, so the sender retries.
const FILE_SKIP_REASONS: Record<string, "format" | "size"> = {
  CONTENT_TOO_LARGE: "size",
  FILE_TOO_LARGE: "size",
  INVALID_INPUT: "format",
  INVALID_UTF8: "format",
  TYPE_MISMATCH: "format",
};

const reissueUploads = async (pending: PendingAttachment[]) =>
  await Promise.all(
    pending
      .filter((attachment) => attachment.state !== "done")
      .filter((attachment) => attachment.state !== "dropped")
      .map(async (attachment) => {
        const signed = await signPendingUpload({
          fileSize: attachment.size,
          key: attachment.fileKey,
          mimeType: attachment.mimeType,
        });
        return {
          fileKey: signed.fileKey,
          index: attachment.index,
          uploadUrl: signed.uploadUrl,
        };
      })
  );

const createBodyCard = async (
  ctx: MutationCtx,
  userId: string,
  plan:
    | { kind: "link"; notes?: string; url: string }
    | { kind: "text"; markdown: string }
) =>
  (
    await createCardForUserHandler(
      ctx,
      userId as Parameters<typeof createCardForUserHandler>[1],
      plan.kind === "link"
        ? {
            content: plan.url,
            metadata: { source: "email" },
            ...(plan.notes ? { notes: plan.notes } : {}),
            tags: [EMAIL_TAG],
            type: "link",
            url: plan.url,
          }
        : {
            content: plan.markdown,
            metadata: { source: "email" },
            tags: [EMAIL_TAG],
            type: "text",
          },
      // An email with words around its link keeps them as a new card's
      // notes; only a bare link moves an existing card to the top.
      {
        source: "email",
        ...(plan.kind === "link" && plan.notes ? { skipResave: true } : {}),
      }
    )
  ).cardId;

/**
 * Saves one verified email: its body card, and a signed upload URL for each
 * attachment the Core Worker then uploads and finalizes. A redelivered
 * email returns its receipt again. The card creation limit throws
 * RATE_LIMITED before anything is written, so the sender retries.
 */
export const ingestEmail = internalMutation({
  args: {
    attachments: v.array(attachmentValidator),
    messageKey: v.string(),
    plan: planValidator,
    userId: v.string(),
  },
  returns: ingestResult,
  handler: async (ctx, { attachments, messageKey, plan, userId }) => {
    const settings = await readInboundSettings(ctx, userId);
    if (!settings?.enabled) {
      return {
        receiptKey: null,
        status: "unknown_sender" as const,
        uploads: [],
      };
    }
    const existing = await ctx.db
      .query("inboundEmailReceipts")
      .withIndex("by_userId_and_messageKey", (q) =>
        q.eq("userId", userId).eq("messageKey", messageKey)
      )
      .unique();
    if (existing) {
      await emit(ctx, {
        event: "email_received",
        outcome: "duplicate",
        userId,
      });
      const uploads = await reissueUploads(existing.pendingAttachments ?? []);
      return {
        receiptKey: uploads.length > 0 ? existing._id : null,
        status: "duplicate" as const,
        uploads,
      };
    }
    const now = Date.now();
    const receipt = (
      outcome: Doc<"inboundEmailReceipts">["outcome"],
      cardIds: Id<"cards">[],
      pendingAttachments?: PendingAttachment[]
    ) =>
      ctx.db.insert("inboundEmailReceipts", {
        cardIds,
        createdAt: now,
        messageKey,
        outcome,
        userId,
        ...(pendingAttachments?.length ? { pendingAttachments } : {}),
      });
    await ctx.db.patch("inboundEmailSettings", settings._id, {
      lastReceivedAt: now,
    });

    const hourly = await rateLimiter.limit(ctx, "inboundEmailPerAccount", {
      key: userId,
      throws: false,
    });
    if (!hourly.ok) {
      await receipt("dropped_rate", []);
      await emit(ctx, {
        event: "email_received",
        outcome: "dropped_rate",
        userId,
      });
      return { receiptKey: null, status: "dropped" as const, uploads: [] };
    }

    const cardIds: Id<"cards">[] = [];
    if (plan.kind !== "empty") {
      try {
        cardIds.push(await createBodyCard(ctx, userId, plan));
      } catch (error) {
        if (errorCode(error) !== CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
          // RATE_LIMITED included: nothing is kept, and the sender retries.
          throw error;
        }
        await receipt("dropped_limit", []);
        await emit(ctx, {
          event: "email_received",
          outcome: "dropped_limit",
          userId,
        });
        return { receiptKey: null, status: "dropped" as const, uploads: [] };
      }
    }

    const pending: PendingAttachment[] = [];
    const uploads: { fileKey: string; index: number; uploadUrl: string }[] = [];
    let atLimit = false;
    for (const attachment of attachments.slice(0, MAX_ATTACHMENTS)) {
      if (atLimit) {
        await emit(ctx, {
          event: "email_attachment_skipped",
          reason: "limit",
          userId,
        });
        continue;
      }
      try {
        const minted = await mintPendingUpload(ctx, userId, {
          fileName: attachment.fileName,
          fileSize: attachment.size,
          mimeType: attachment.mimeType,
        });
        pending.push({
          fileKey: minted.fileKey,
          fileName: minted.fileName,
          index: attachment.index,
          mimeType: attachment.mimeType,
          size: attachment.size,
          state: "unclaimed",
        });
        uploads.push({
          fileKey: minted.fileKey,
          index: attachment.index,
          uploadUrl: minted.uploadUrl,
        });
      } catch (error) {
        const code = errorCode(error);
        if (code === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
          atLimit = true;
          await emit(ctx, {
            event: "email_attachment_skipped",
            reason: "limit",
            userId,
          });
        } else if (code && code in FILE_SKIP_REASONS) {
          await emit(ctx, {
            event: "email_attachment_skipped",
            reason: FILE_SKIP_REASONS[code] as "format" | "size",
            userId,
          });
        } else {
          throw error;
        }
      }
    }

    const saved = cardIds.length > 0 || pending.length > 0;
    const receiptId = await receipt(
      saved ? "saved" : "empty",
      cardIds,
      pending
    );
    await emit(ctx, {
      event: "email_received",
      outcome: saved ? "saved" : "empty",
      userId,
    });
    return {
      receiptKey: pending.length > 0 ? receiptId : null,
      status: saved ? ("saved" as const) : ("empty" as const),
      uploads,
    };
  },
});

const claimResult = v.union(
  v.object({ status: v.literal("saved"), cardId: v.id("cards") }),
  v.object({ status: v.literal("dropped") }),
  v.object({ status: v.literal("in_progress") }),
  v.object({
    claimToken: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    receiptId: v.id("inboundEmailReceipts"),
    size: v.number(),
    status: v.literal("claimed"),
    userId: v.string(),
  })
);

const updateAttachment = async (
  ctx: MutationCtx,
  receipt: Doc<"inboundEmailReceipts">,
  index: number,
  change: Partial<PendingAttachment>
) => {
  const attachments = receipt.pendingAttachments ?? [];
  await ctx.db.patch("inboundEmailReceipts", receipt._id, {
    pendingAttachments: attachments.map((attachment) =>
      attachment.index === index ? { ...attachment, ...change } : attachment
    ),
  });
};

/**
 * Takes the one claim on an uploaded attachment. A claim older than two
 * minutes is taken over; a retry scheduled for the card limit's refill passes
 * its own token back.
 */
export const claimEmailAttachment = internalMutation({
  args: {
    claimToken: v.optional(v.string()),
    fileKey: v.string(),
    index: v.number(),
    receiptKey: v.string(),
  },
  returns: claimResult,
  handler: async (ctx, { claimToken, fileKey, index, receiptKey }) => {
    const receiptId = ctx.db.normalizeId("inboundEmailReceipts", receiptKey);
    const receipt = receiptId
      ? await ctx.db.get("inboundEmailReceipts", receiptId)
      : null;
    const attachment = receipt?.pendingAttachments?.find(
      (pending) => pending.index === index
    );
    if (!(receipt && attachment && attachment.fileKey === fileKey)) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "No such attachment on this email",
      });
    }
    if (attachment.state === "done" && attachment.cardId) {
      return { cardId: attachment.cardId, status: "saved" as const };
    }
    if (attachment.state === "dropped") {
      return { status: "dropped" as const };
    }
    const now = Date.now();
    if (
      attachment.state === "pending" &&
      attachment.claimToken !== claimToken &&
      (attachment.claimedAt ?? 0) > now - ATTACHMENT_CLAIM_TTL_MS
    ) {
      return { status: "in_progress" as const };
    }
    const token = crypto.randomUUID();
    await updateAttachment(ctx, receipt, index, {
      claimToken: token,
      claimedAt: now,
      state: "pending",
    });
    return {
      claimToken: token,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      receiptId: receipt._id,
      size: attachment.size,
      status: "claimed" as const,
      userId: receipt.userId,
    };
  },
});

/** Gives a claim back after a failure before the card exists. */
export const releaseEmailAttachment = internalMutation({
  args: {
    claimToken: v.string(),
    index: v.number(),
    receiptId: v.id("inboundEmailReceipts"),
  },
  returns: v.null(),
  handler: async (ctx, { claimToken, index, receiptId }) => {
    const receipt = await ctx.db.get("inboundEmailReceipts", receiptId);
    const attachment = receipt?.pendingAttachments?.find(
      (pending) => pending.index === index
    );
    if (receipt && attachment?.claimToken === claimToken) {
      await updateAttachment(ctx, receipt, index, {
        claimToken: undefined,
        claimedAt: undefined,
        state: "unclaimed",
      });
    }
    return null;
  },
});

/**
 * An attachment that won't be saved (the card limit, or a file that isn't
 * what it said): its uploaded object is deleted and it's never retried.
 */
export const dropEmailAttachment = internalMutation({
  args: {
    claimToken: v.string(),
    index: v.number(),
    reason: v.union(v.literal("format"), v.literal("size"), v.literal("limit")),
    receiptId: v.id("inboundEmailReceipts"),
  },
  returns: v.null(),
  handler: async (ctx, { claimToken, index, reason, receiptId }) => {
    const receipt = await ctx.db.get("inboundEmailReceipts", receiptId);
    const attachment = receipt?.pendingAttachments?.find(
      (pending) => pending.index === index
    );
    if (!(receipt && attachment?.claimToken === claimToken)) {
      return null;
    }
    await updateAttachment(ctx, receipt, index, {
      claimToken: undefined,
      claimedAt: undefined,
      state: "dropped",
    });
    await queueObjectDeletion(ctx, attachment.fileKey);
    await emit(ctx, {
      event: "email_attachment_skipped",
      reason,
      userId: receipt.userId,
    });
    return null;
  },
});

/** Receipts are kept this long: well past any sender's redelivery. */
export const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_BATCH = 200;

/** The Core Worker's daily maintenance calls this until `hasMore` is false. */
export const pruneReceipts = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("inboundEmailReceipts")
      .withIndex("by_createdAt", (q) =>
        q.lt("createdAt", Date.now() - RECEIPT_RETENTION_MS)
      )
      .take(PRUNE_BATCH);
    for (const receipt of expired) {
      await ctx.db.delete("inboundEmailReceipts", receipt._id);
    }
    return {
      deleted: expired.length,
      hasMore: expired.length === PRUNE_BATCH,
    };
  },
});
