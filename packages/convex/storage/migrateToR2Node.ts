"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import type { AssetRef } from "./migrateToR2";
import { buildR2ObjectKey, r2 } from "./r2";

export const migrateReferencedStorageBatch = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    cardsScanned: v.number(),
    copied: v.number(),
    copiedBytes: v.number(),
    missing: v.number(),
    failed: v.number(),
    dryRun: v.boolean(),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { cursor = null, limit = 25, dryRun = true }) => {
    const candidates: Array<{ card: Doc<"cards">; refs: AssetRef[] }> = [];
    const page = await ctx.runQuery(
      internal.storage.migrateToR2.getLegacyStorageCards,
      {
        cursor,
        numItems: limit,
      }
    );
    let copied = 0;
    let copiedBytes = 0;
    let missing = 0;
    let failed = 0;
    const copiedByLegacyId = new Map<string, string>();

    candidates.push(...page.page);

    for (const { card, refs } of candidates) {
      const migrated: Array<{ keyPath: string; r2Key: string }> = [];
      for (const ref of refs) {
        try {
          const cachedKey = copiedByLegacyId.get(ref.legacyStorageId);
          if (cachedKey) {
            migrated.push({ keyPath: ref.keyPath, r2Key: cachedKey });
            continue;
          }
          const sourceUrl = await ctx.storage.getUrl(ref.legacyStorageId);
          if (!sourceUrl) {
            missing += 1;
            continue;
          }
          const response = await fetch(sourceUrl);
          if (!response.ok) {
            missing += 1;
            continue;
          }
          const blob = await response.blob();
          const r2Key = buildR2ObjectKey({
            userId: card.userId,
            cardId: card._id,
            role: ref.role,
          });
          if (!dryRun) {
            await r2.store(ctx, blob, {
              key: r2Key,
              type: blob.type || undefined,
            });
          }
          copiedByLegacyId.set(ref.legacyStorageId, r2Key);
          migrated.push({ keyPath: ref.keyPath, r2Key });
          copied += 1;
          copiedBytes += blob.size;
        } catch (error) {
          failed += 1;
          console.error("[storage/migrateToR2] Copy failed", {
            cardId: card._id,
            keyPath: ref.keyPath,
            error,
          });
        }
      }
      if (!dryRun && migrated.length > 0) {
        await ctx.runMutation(
          internal.storage.migrateToR2.patchMigratedStorageRefs,
          { cardId: card._id, migrated }
        );
      }
    }

    return {
      cardsScanned: page.cardsScanned,
      copied,
      copiedBytes,
      missing,
      failed,
      dryRun,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
