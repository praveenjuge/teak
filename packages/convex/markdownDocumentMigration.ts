import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import {
  isMarkdownFileName,
  markdownContentByteLength,
  validateMarkdownContent,
} from "./shared/markdown";
import { buildR2UserPrefix } from "./storage/r2";

const MAX_ATTEMPTS = 5;
const STALE_PROCESSING_MS = 5 * 60 * 1000;

const auditSnapshotValidator = v.union(
  v.null(),
  v.object({
    _id: v.id("markdownConversionAudits"),
    cardId: v.id("cards"),
    userId: v.string(),
    sourceFileKey: v.optional(v.string()),
    sourceUpdatedAt: v.number(),
    sourceEtag: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("converted"),
      v.literal("failed")
    ),
    attempts: v.number(),
    updatedAt: v.number(),
  })
);

export const getAuditSnapshot = internalQuery({
  args: { auditId: v.id("markdownConversionAudits") },
  returns: auditSnapshotValidator,
  handler: async (ctx, { auditId }) => {
    const audit = await ctx.db.get(auditId);
    if (!audit) {
      return null;
    }
    return {
      _id: audit._id,
      cardId: audit.cardId,
      userId: audit.userId,
      sourceFileKey: audit.sourceFileKey,
      sourceUpdatedAt: audit.sourceUpdatedAt,
      sourceEtag: audit.sourceEtag,
      status: audit.status,
      attempts: audit.attempts,
      updatedAt: audit.updatedAt,
    };
  },
});

function scheduleAudit(
  ctx: MutationCtx,
  auditId: Id<"markdownConversionAudits">,
  now: number
) {
  return ctx.scheduler.runAfter(
    0,
    (internal as any).markdownDocumentMigrationAction.processAudit,
    { auditId, claimedAt: now }
  );
}

async function claimAudit(
  ctx: MutationCtx,
  auditId: Id<"markdownConversionAudits">,
  now: number
): Promise<boolean> {
  const audit = await ctx.db.get(auditId);
  if (
    audit?.status !== "pending" ||
    (audit.nextRetryAt !== undefined && audit.nextRetryAt > now)
  ) {
    return false;
  }
  await ctx.db.patch(auditId, {
    status: "in_progress",
    attempts: audit.attempts + 1,
    retryable: true,
    failureReason: undefined,
    nextRetryAt: undefined,
    startedAt: audit.startedAt ?? now,
    updatedAt: now,
  });
  await scheduleAudit(ctx, auditId, now);
  return true;
}

export const resumeOne = internalMutation({
  args: { auditId: v.id("markdownConversionAudits") },
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx, { auditId }) => ({
    scheduled: await claimAudit(ctx, auditId, Date.now()),
  }),
});

export const resumeCampaign = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ scheduled: v.number(), reclaimed: v.number() }),
  handler: async (ctx, { limit }) => {
    const now = Date.now();
    const batchSize = Math.max(1, Math.min(Math.floor(limit ?? 20), 100));
    const ready = await ctx.db
      .query("markdownConversionAudits")
      .withIndex("by_status_and_next_retry_at", (q) =>
        q.eq("status", "pending").lte("nextRetryAt", now)
      )
      .take(batchSize);
    const stale =
      ready.length < batchSize
        ? await ctx.db
            .query("markdownConversionAudits")
            .withIndex("by_status_and_updated_at", (q) =>
              q
                .eq("status", "in_progress")
                .lt("updatedAt", now - STALE_PROCESSING_MS)
            )
            .take(batchSize - ready.length)
        : [];

    let scheduled = 0;
    for (const audit of [...ready, ...stale]) {
      if (audit.status === "in_progress") {
        await ctx.db.patch(audit._id, {
          status: "pending",
          nextRetryAt: 0,
          updatedAt: now,
        });
      }
      if (await claimAudit(ctx, audit._id, now)) {
        scheduled += 1;
      }
    }
    return { scheduled, reclaimed: stale.length };
  },
});

export const recordFailure = internalMutation({
  args: {
    auditId: v.id("markdownConversionAudits"),
    failureReason: v.string(),
    retryable: v.boolean(),
    sourceByteSize: v.optional(v.number()),
    sourceEtag: v.optional(v.string()),
    claimedAt: v.number(),
    expectedAttempt: v.number(),
  },
  returns: v.object({ retryScheduled: v.boolean() }),
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (
      !audit ||
      audit.status === "converted" ||
      audit.status !== "in_progress" ||
      audit.updatedAt !== args.claimedAt ||
      audit.attempts !== args.expectedAttempt
    ) {
      return { retryScheduled: false };
    }
    const now = Date.now();
    const shouldRetry = args.retryable && audit.attempts < MAX_ATTEMPTS;
    const delayMs = Math.min(60_000, 1000 * 2 ** Math.max(0, audit.attempts));
    await ctx.db.patch(args.auditId, {
      status: shouldRetry ? "pending" : "failed",
      retryable: shouldRetry,
      failureReason: args.failureReason,
      sourceByteSize: args.sourceByteSize ?? audit.sourceByteSize,
      sourceEtag: args.sourceEtag ?? audit.sourceEtag,
      nextRetryAt: shouldRetry ? now + delayMs : undefined,
      completedAt: shouldRetry ? undefined : now,
      updatedAt: now,
    });
    if (shouldRetry) {
      await ctx.scheduler.runAfter(
        delayMs,
        (internal as any).markdownDocumentMigration.resumeOne,
        { auditId: args.auditId }
      );
    }
    return { retryScheduled: shouldRetry };
  },
});

export const completeConversion = internalMutation({
  args: {
    auditId: v.id("markdownConversionAudits"),
    content: v.string(),
    sourceByteSize: v.number(),
    sourceChecksum: v.string(),
    sourceEtag: v.string(),
    verifiedEtag: v.string(),
    claimedAt: v.number(),
    expectedAttempt: v.number(),
  },
  returns: v.object({
    converted: v.boolean(),
    failureReason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit) {
      return { converted: false, failureReason: "missing_audit" };
    }
    if (audit.status === "converted") {
      return { converted: true };
    }
    if (
      audit.status !== "in_progress" ||
      audit.updatedAt !== args.claimedAt ||
      audit.attempts !== args.expectedAttempt
    ) {
      return { converted: false, failureReason: "stale_attempt" };
    }
    const card = await ctx.db.get(audit.cardId);
    const fileName = card?.fileMetadata?.fileName ?? "";
    const ownsObject =
      audit.sourceFileKey?.startsWith(`${buildR2UserPrefix(audit.userId)}/`) ===
      true;
    if (
      !card ||
      card.userId !== audit.userId ||
      card.type !== "document" ||
      !isMarkdownFileName(fileName) ||
      !ownsObject ||
      card.fileKey !== audit.sourceFileKey ||
      card.updatedAt !== audit.sourceUpdatedAt ||
      args.sourceEtag !== args.verifiedEtag ||
      (audit.sourceEtag !== undefined && audit.sourceEtag !== args.sourceEtag)
    ) {
      return { converted: false, failureReason: "concurrently_changed" };
    }

    const content = validateMarkdownContent(args.content);
    if (markdownContentByteLength(content) !== args.sourceByteSize) {
      return { converted: false, failureReason: "source_size_changed" };
    }

    await ctx.db.patch(card._id, {
      type: "text",
      content,
    });
    const now = Date.now();
    await ctx.db.patch(audit._id, {
      status: "converted",
      retryable: false,
      failureReason: undefined,
      sourceByteSize: args.sourceByteSize,
      sourceChecksum: args.sourceChecksum,
      sourceEtag: args.sourceEtag,
      nextRetryAt: undefined,
      completedAt: now,
      updatedAt: now,
    });
    return { converted: true };
  },
});

export const retryConversion = internalMutation({
  args: { auditId: v.id("markdownConversionAudits") },
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx, { auditId }) => {
    const audit = await ctx.db.get(auditId);
    if (!audit || audit.status === "converted") {
      return { scheduled: false };
    }
    const now = Date.now();
    await ctx.db.patch(auditId, {
      status: "pending",
      retryable: true,
      failureReason: undefined,
      nextRetryAt: 0,
      completedAt: undefined,
      updatedAt: now,
    });
    return { scheduled: await claimAudit(ctx, auditId, now) };
  },
});

export const statusPage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: (ctx, { cursor, limit }) =>
    ctx.db.query("markdownConversionAudits").paginate({
      cursor,
      numItems: Math.max(1, Math.min(Math.floor(limit ?? 100), 500)),
    }),
});

export const untrackedCandidatePage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { cursor, limit }) => {
    const page = await ctx.db
      .query("cards")
      .withIndex("by_type", (q) => q.eq("type", "document"))
      .paginate({
        cursor,
        numItems: Math.max(1, Math.min(Math.floor(limit ?? 100), 500)),
      });
    const results: Record<string, unknown>[] = [];
    for (const card of page.page) {
      if (!isMarkdownFileName(card.fileMetadata?.fileName ?? "")) {
        continue;
      }
      const audit = await ctx.db
        .query("markdownConversionAudits")
        .withIndex("by_card_id", (q) => q.eq("cardId", card._id))
        .unique();
      if (!audit) {
        results.push({ cardId: card._id, userId: card.userId });
      }
    }
    return { ...page, page: results };
  },
});

export const verifyPage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { cursor, limit }) => {
    const page = await ctx.db.query("markdownConversionAudits").paginate({
      cursor,
      numItems: Math.max(1, Math.min(Math.floor(limit ?? 100), 500)),
    });
    const results: Record<string, unknown>[] = [];
    for (const audit of page.page) {
      const card = await ctx.db.get(audit.cardId);
      let valid = true;
      if (audit.status === "converted") {
        valid =
          card?.type === "text" &&
          card.fileKey === audit.sourceFileKey &&
          card.updatedAt === audit.sourceUpdatedAt;
      } else if (audit.status === "failed") {
        valid = card?.type !== "text";
      }
      results.push({
        auditId: audit._id,
        cardId: audit.cardId,
        status: audit.status,
        valid,
        failureReason: audit.failureReason,
      });
    }
    return { ...page, page: results };
  },
});
