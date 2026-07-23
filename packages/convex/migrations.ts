import { Migrations, runToCompletion } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";
import { internalAction } from "./_generated/server";
import { isMarkdownFileName } from "./shared/markdown";
import { buildR2UserPrefix } from "./storage/r2";

export const migrations = new Migrations<DataModel>(components.migrations);

export const seedMarkdownDocumentConversions = migrations.define({
  table: "cards",
  batchSize: 20,
  customRange: (query) =>
    query.withIndex("by_type", (q) => q.eq("type", "document")),
  migrateOne: async (ctx, card) => {
    const fileName = card.fileMetadata?.fileName ?? "";
    if (!isMarkdownFileName(fileName)) {
      return;
    }
    const existing = await ctx.db
      .query("markdownConversionAudits")
      .withIndex("by_card_id", (q) => q.eq("cardId", card._id))
      .unique();
    if (existing) {
      return;
    }
    const now = Date.now();
    const ownsObject =
      card.fileKey?.startsWith(`${buildR2UserPrefix(card.userId)}/`) === true;
    await ctx.db.insert("markdownConversionAudits", {
      cardId: card._id,
      userId: card.userId,
      sourceFileKey: card.fileKey,
      sourceUpdatedAt: card.updatedAt,
      status: ownsObject ? "pending" : "failed",
      attempts: 0,
      retryable: ownsObject,
      failureReason: ownsObject ? undefined : "ownership_invalid",
      nextRetryAt: ownsObject ? 0 : undefined,
      createdAt: now,
      updatedAt: now,
      completedAt: ownsObject ? undefined : now,
    });
  },
});

export const run = migrations.runner();

export const seedMarkdownDocumentConversionsToCompletion = internalAction({
  args: {},
  returns: v.any(),
  handler: (ctx) =>
    runToCompletion(
      ctx,
      components.migrations,
      internal.migrations.seedMarkdownDocumentConversions
    ),
});
