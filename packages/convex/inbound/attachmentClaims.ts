import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Save by email attachments (phase 24): each one on a receipt is claimed by
// one finalize at a time, and its card is recorded on the receipt in the same
// transaction that creates it, so a retry never makes a second card.

export const ATTACHMENT_CLAIM_TTL_MS = 2 * 60 * 1000;

export const emailAttachmentClaimValidator = v.object({
  claimToken: v.string(),
  index: v.number(),
  receiptId: v.id("inboundEmailReceipts"),
});

export interface EmailAttachmentClaim {
  claimToken: string;
  index: number;
  receiptId: Id<"inboundEmailReceipts">;
}

const loadAttachment = async (
  ctx: MutationCtx,
  claim: EmailAttachmentClaim
) => {
  const receipt = await ctx.db.get("inboundEmailReceipts", claim.receiptId);
  const attachments = receipt?.pendingAttachments ?? [];
  const position = attachments.findIndex(
    (attachment) => attachment.index === claim.index
  );
  const attachment = attachments[position];
  if (!(receipt && attachment)) {
    throw new ConvexError({ code: "NOT_FOUND", message: "No such attachment" });
  }
  return { attachment, attachments, position, receipt };
};

export const checkEmailAttachmentClaim = async (
  ctx: MutationCtx,
  claim: EmailAttachmentClaim
): Promise<Id<"cards"> | null> => {
  const { attachment } = await loadAttachment(ctx, claim);
  if (attachment.state === "done" && attachment.cardId) {
    return attachment.cardId;
  }
  if (
    attachment.state !== "pending" ||
    attachment.claimToken !== claim.claimToken
  ) {
    throw new ConvexError({
      code: "IN_PROGRESS",
      message: "Another finalize owns this attachment",
    });
  }
  return null;
};

/** Marks the attachment done with its card, in the card's transaction. */
export const completeEmailAttachment = async (
  ctx: MutationCtx,
  claim: EmailAttachmentClaim,
  cardId: Id<"cards">
) => {
  const { attachments, position, receipt } = await loadAttachment(ctx, claim);
  const next = [...attachments];
  next[position] = {
    ...(attachments[position] as (typeof attachments)[number]),
    cardId,
    claimToken: undefined,
    claimedAt: undefined,
    state: "done",
  };
  await ctx.db.patch("inboundEmailReceipts", receipt._id, {
    cardIds: [...receipt.cardIds, cardId],
    pendingAttachments: next,
  });
};
