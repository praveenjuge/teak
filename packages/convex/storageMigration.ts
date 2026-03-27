import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { deleteStorageObject } from "./fileStorage";
import {
  applyStorageMigrationPatch,
  collectLegacyStorageRefs,
  getStorageRefAtFieldPath,
  storageMigrationKindLiterals,
} from "./storageMigrationHelpers";
import { storageRefValidator } from "./storageRefs";

const storageMigrationKindValidator = v.union(
  ...storageMigrationKindLiterals.map((kind) => v.literal(kind))
);

const legacyStorageAssetCandidateValidator = v.object({
  contentType: v.optional(v.string()),
  fieldPath: v.string(),
  fileName: v.optional(v.string()),
  kind: storageMigrationKindValidator,
  legacyRef: storageRefValidator,
});

const appliedStorageMigrationValidator = v.object({
  contentType: v.optional(v.string()),
  fieldPath: v.string(),
  fileName: v.optional(v.string()),
  kind: storageMigrationKindValidator,
  legacyRef: storageRefValidator,
  r2Ref: storageRefValidator,
});

const cleanupCandidateValidator = v.object({
  cardId: v.id("cards"),
  fieldPath: v.string(),
  legacyRef: storageRefValidator,
  migrationId: v.id("storageMigrations"),
  r2Ref: storageRefValidator,
  status: v.union(v.literal("copied"), v.literal("cleanup_failed")),
});

export const listLegacyStorageBackfillCandidates = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    continueCursor: v.string(),
    isDone: v.boolean(),
    page: v.array(
      v.object({
        assets: v.array(legacyStorageAssetCandidateValidator),
        cardId: v.id("cards"),
        userId: v.string(),
      })
    ),
    scannedCount: v.number(),
  }),
  handler: async (ctx, { paginationOpts }) => {
    const safePagination = {
      ...paginationOpts,
      numItems: Math.min(paginationOpts.numItems, 100),
    };

    const result = await ctx.db
      .query("cards")
      .order("asc")
      .paginate(safePagination);

    const page = result.page
      .map((card) => ({
        assets: collectLegacyStorageRefs(card),
        cardId: card._id,
        userId: card.userId,
      }))
      .filter((candidate) => candidate.assets.length > 0);

    return {
      continueCursor: result.continueCursor,
      isDone: result.isDone,
      page,
      scannedCount: result.page.length,
    };
  },
});

export const applyBackfilledStorageRefs = internalMutation({
  args: {
    cardId: v.id("cards"),
    migrations: v.array(appliedStorageMigrationValidator),
    userId: v.string(),
  },
  returns: v.object({
    appliedCount: v.number(),
    skippedCount: v.number(),
  }),
  handler: async (ctx, { cardId, migrations, userId }) => {
    const card = await ctx.db.get(cardId);
    if (!card) {
      return {
        appliedCount: 0,
        skippedCount: migrations.length,
      };
    }

    const now = Date.now();
    const { applied, changed, patch } = applyStorageMigrationPatch(
      card,
      migrations
    );

    if (changed) {
      await ctx.db.patch(cardId, {
        ...patch,
        updatedAt: now,
      });
    }

    for (const migration of applied) {
      const existing = await ctx.db
        .query("storageMigrations")
        .withIndex("by_card_and_field", (q) =>
          q.eq("cardId", cardId).eq("fieldPath", migration.fieldPath)
        )
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          kind: migration.kind,
          lastError: undefined,
          legacyDeletedAt: undefined,
          legacyRef: migration.legacyRef,
          r2Ref: migration.r2Ref,
          status: "copied",
          updatedAt: now,
          userId,
        });
        continue;
      }

      await ctx.db.insert("storageMigrations", {
        cardId,
        createdAt: now,
        fieldPath: migration.fieldPath,
        kind: migration.kind,
        legacyRef: migration.legacyRef,
        r2Ref: migration.r2Ref,
        status: "copied",
        updatedAt: now,
        userId,
      });
    }

    return {
      appliedCount: applied.length,
      skippedCount: migrations.length - applied.length,
    };
  },
});

export const listLegacyStorageCleanupCandidates = internalQuery({
  args: {
    batchSize: v.optional(v.number()),
    includeFailed: v.optional(v.boolean()),
  },
  returns: v.object({
    page: v.array(cleanupCandidateValidator),
  }),
  handler: async (ctx, { batchSize, includeFailed }) => {
    const safeBatchSize = Math.min(Math.max(batchSize ?? 100, 1), 200);
    const copied = await ctx.db
      .query("storageMigrations")
      .withIndex("by_status_updated", (q) => q.eq("status", "copied"))
      .order("asc")
      .take(safeBatchSize);

    const page = [...copied];

    if (includeFailed && page.length < safeBatchSize) {
      const failed = await ctx.db
        .query("storageMigrations")
        .withIndex("by_status_updated", (q) => q.eq("status", "cleanup_failed"))
        .order("asc")
        .take(safeBatchSize - page.length);

      page.push(...failed);
    }

    return {
      page: page.map((migration) => {
        const status: "copied" | "cleanup_failed" =
          migration.status === "cleanup_failed" ? "cleanup_failed" : "copied";

        return {
          cardId: migration.cardId,
          fieldPath: migration.fieldPath,
          legacyRef: migration.legacyRef,
          migrationId: migration._id,
          r2Ref: migration.r2Ref,
          status,
        };
      }),
    };
  },
});

export const cleanupLegacyStorageRef = internalMutation({
  args: {
    migrationId: v.id("storageMigrations"),
  },
  returns: v.object({
    cleanedUp: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, { migrationId }) => {
    const migration = await ctx.db.get(migrationId);
    if (!migration) {
      return {
        cleanedUp: false,
        reason: "not_found",
      };
    }

    const card = await ctx.db.get(migration.cardId);
    const currentRef = card
      ? getStorageRefAtFieldPath(card, migration.fieldPath)
      : null;

    if (currentRef === migration.legacyRef) {
      return {
        cleanedUp: false,
        reason: "legacy_ref_still_active",
      };
    }

    try {
      await deleteStorageObject(ctx, migration.legacyRef);
      await ctx.db.patch(migrationId, {
        lastError: undefined,
        legacyDeletedAt: Date.now(),
        status: "cleaned_up",
        updatedAt: Date.now(),
      });

      return {
        cleanedUp: true,
      };
    } catch (error) {
      await ctx.db.patch(migrationId, {
        lastError: error instanceof Error ? error.message : String(error),
        status: "cleanup_failed",
        updatedAt: Date.now(),
      });

      return {
        cleanedUp: false,
        reason: "delete_failed",
      };
    }
  },
});
