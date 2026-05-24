import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { r2 } from "./r2";

type CleanupRef = {
  cardId: Id<"cards">;
  legacyStorageId: Id<"_storage">;
  r2Key?: string;
  fieldPath: string;
};

type StorageObject = {
  id: Id<"_storage">;
  size: number;
  contentType?: string;
};

const cleanupRefValidator = v.object({
  cardId: v.id("cards"),
  legacyStorageId: v.id("_storage"),
  r2Key: v.optional(v.string()),
  fieldPath: v.string(),
});

const storageObjectValidator = v.object({
  id: v.id("_storage"),
  size: v.number(),
  contentType: v.optional(v.string()),
});

const collectCleanupRefs = (card: Doc<"cards">): CleanupRef[] => {
  const refs: CleanupRef[] = [];
  if (card.fileId) {
    refs.push({
      cardId: card._id,
      legacyStorageId: card.fileId,
      r2Key: card.fileKey,
      fieldPath: "fileId",
    });
  }
  if (card.thumbnailId) {
    refs.push({
      cardId: card._id,
      legacyStorageId: card.thumbnailId,
      r2Key: card.thumbnailKey,
      fieldPath: "thumbnailId",
    });
  }

  const preview = card.metadata?.linkPreview;
  if (preview?.imageStorageId) {
    refs.push({
      cardId: card._id,
      legacyStorageId: preview.imageStorageId,
      r2Key: preview.imageStorageKey,
      fieldPath: "metadata.linkPreview.imageStorageId",
    });
  }
  if (preview?.screenshotStorageId) {
    refs.push({
      cardId: card._id,
      legacyStorageId: preview.screenshotStorageId,
      r2Key: preview.screenshotStorageKey,
      fieldPath: "metadata.linkPreview.screenshotStorageId",
    });
  }

  preview?.media?.forEach((item, index) => {
    if (item.storageId) {
      refs.push({
        cardId: card._id,
        legacyStorageId: item.storageId,
        r2Key: item.storageKey,
        fieldPath: `metadata.linkPreview.media.${index}.storageId`,
      });
    }
    if (item.posterStorageId) {
      refs.push({
        cardId: card._id,
        legacyStorageId: item.posterStorageId,
        r2Key: item.posterStorageKey,
        fieldPath: `metadata.linkPreview.media.${index}.posterStorageId`,
      });
    }
  });

  return refs;
};

const addReferencedLegacyIds = (card: Doc<"cards">, ids: Set<string>) => {
  for (const ref of collectCleanupRefs(card)) {
    ids.add(ref.legacyStorageId);
  }
};

const readLegacyField = (
  card: Doc<"cards">,
  fieldPath: string
): Id<"_storage"> | undefined => {
  if (fieldPath === "fileId") {
    return card.fileId;
  }
  if (fieldPath === "thumbnailId") {
    return card.thumbnailId;
  }
  const preview = card.metadata?.linkPreview;
  if (fieldPath === "metadata.linkPreview.imageStorageId") {
    return preview?.imageStorageId;
  }
  if (fieldPath === "metadata.linkPreview.screenshotStorageId") {
    return preview?.screenshotStorageId;
  }
  const match =
    /^metadata\.linkPreview\.media\.(\d+)\.(storageId|posterStorageId)$/u.exec(
      fieldPath
    );
  if (!match) {
    return undefined;
  }
  const item = preview?.media?.[Number(match[1])];
  return match[2] === "storageId" ? item?.storageId : item?.posterStorageId;
};

const withoutKeys = <T extends Record<string, unknown>>(
  value: T,
  keys: string[]
) => {
  const next = { ...value };
  for (const key of keys) {
    delete next[key];
  }
  return next;
};

const buildLegacyReferencePatch = (card: Doc<"cards">, refs: CleanupRef[]) => {
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  const nestedRefs = refs.filter((ref) =>
    ref.fieldPath.startsWith("metadata.")
  );

  if (refs.some((ref) => ref.fieldPath === "fileId")) {
    patch.fileId = undefined;
  }
  if (refs.some((ref) => ref.fieldPath === "thumbnailId")) {
    patch.thumbnailId = undefined;
  }
  if (nestedRefs.length === 0 || !card.metadata?.linkPreview) {
    return patch;
  }

  let linkPreview: Record<string, unknown> = { ...card.metadata.linkPreview };
  const media = card.metadata.linkPreview.media?.map((item) => ({ ...item }));

  if (
    nestedRefs.some(
      (ref) => ref.fieldPath === "metadata.linkPreview.imageStorageId"
    )
  ) {
    linkPreview = withoutKeys(linkPreview, ["imageStorageId"]);
  }
  if (
    nestedRefs.some(
      (ref) => ref.fieldPath === "metadata.linkPreview.screenshotStorageId"
    )
  ) {
    linkPreview = withoutKeys(linkPreview, ["screenshotStorageId"]);
  }

  for (const ref of nestedRefs) {
    const match =
      /^metadata\.linkPreview\.media\.(\d+)\.(storageId|posterStorageId)$/u.exec(
        ref.fieldPath
      );
    if (!match || !media?.[Number(match[1])]) {
      continue;
    }
    media[Number(match[1])] = withoutKeys(media[Number(match[1])]!, [match[2]]);
  }

  patch.metadata = {
    ...card.metadata,
    linkPreview: {
      ...linkPreview,
      ...(media ? { media } : {}),
    },
  };
  return patch;
};

export const listLegacyStorageReferences = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  returns: v.object({
    refs: v.array(cleanupRefValidator),
    cardsScanned: v.number(),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { cursor, numItems }) => {
    const result = await ctx.db.query("cards").paginate({ cursor, numItems });
    return {
      refs: result.page.flatMap(collectCleanupRefs),
      cardsScanned: result.page.length,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const listOrphanConvexStorageObjects = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  returns: v.object({
    objects: v.array(storageObjectValidator),
    storageScanned: v.number(),
    referencedStorageIds: v.number(),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { cursor, numItems }) => {
    const referencedStorageIds = new Set<string>();
    for await (const card of ctx.db.query("cards")) {
      addReferencedLegacyIds(card, referencedStorageIds);
    }

    const result = await ctx.db.system
      .query("_storage")
      .paginate({ cursor, numItems });

    return {
      objects: result.page
        .filter((file) => !referencedStorageIds.has(file._id))
        .map((file) => ({
          id: file._id,
          size: file.size,
          contentType: file.contentType,
        })),
      storageScanned: result.page.length,
      referencedStorageIds: referencedStorageIds.size,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const deleteLegacyStorageAndReferences = internalMutation({
  args: {
    refs: v.array(cleanupRefValidator),
  },
  returns: v.object({
    deletedStorage: v.number(),
    alreadyMissingStorage: v.number(),
    removedRefs: v.number(),
    skippedStaleRefs: v.number(),
    failedDelete: v.number(),
  }),
  handler: async (ctx, { refs }) => {
    const refsByCard = new Map<string, CleanupRef[]>();
    for (const ref of refs) {
      const cardRefs = refsByCard.get(ref.cardId) ?? [];
      cardRefs.push(ref);
      refsByCard.set(ref.cardId, cardRefs);
    }

    let deletedStorage = 0;
    let alreadyMissingStorage = 0;
    let removedRefs = 0;
    let skippedStaleRefs = 0;
    let failedDelete = 0;
    const deletedByLegacyId = new Map<string, boolean>();

    for (const [cardId, cardRefs] of refsByCard) {
      const card = await ctx.db.get(cardId as Id<"cards">);
      if (!card) {
        skippedStaleRefs += cardRefs.length;
        continue;
      }

      const refsToRemove: CleanupRef[] = [];
      for (const ref of cardRefs) {
        if (readLegacyField(card, ref.fieldPath) !== ref.legacyStorageId) {
          skippedStaleRefs += 1;
          continue;
        }

        let deleted = deletedByLegacyId.get(ref.legacyStorageId);
        if (deleted === undefined) {
          try {
            const existingUrl = await ctx.storage.getUrl(ref.legacyStorageId);
            if (existingUrl) {
              await ctx.storage.delete(ref.legacyStorageId);
              deletedStorage += 1;
            } else {
              alreadyMissingStorage += 1;
            }
            deleted = true;
          } catch (error) {
            console.error("[storage/cleanupLegacyStorage] Delete failed", {
              cardId,
              fieldPath: ref.fieldPath,
              legacyStorageId: ref.legacyStorageId,
              error,
            });
            failedDelete += 1;
            deleted = false;
          }
          deletedByLegacyId.set(ref.legacyStorageId, deleted);
        }

        if (deleted) {
          refsToRemove.push(ref);
        }
      }

      if (refsToRemove.length > 0) {
        await ctx.db.patch(card._id, buildLegacyReferencePatch(card, refsToRemove));
        removedRefs += refsToRemove.length;
      }
    }

    return {
      deletedStorage,
      alreadyMissingStorage,
      removedRefs,
      skippedStaleRefs,
      failedDelete,
    };
  },
});

export const deleteOrphanConvexStorageObjects = internalMutation({
  args: {
    storageIds: v.array(v.id("_storage")),
  },
  returns: v.object({
    deletedStorage: v.number(),
    alreadyMissingStorage: v.number(),
    failedDelete: v.number(),
  }),
  handler: async (ctx, { storageIds }) => {
    let deletedStorage = 0;
    let alreadyMissingStorage = 0;
    let failedDelete = 0;

    for (const storageId of new Set(storageIds)) {
      try {
        const existing = await ctx.db.system.get("_storage", storageId);
        if (!existing) {
          alreadyMissingStorage += 1;
          continue;
        }
        await ctx.storage.delete(storageId);
        deletedStorage += 1;
      } catch (error) {
        console.error("[storage/cleanupLegacyStorage] Orphan delete failed", {
          storageId,
          error,
        });
        failedDelete += 1;
      }
    }

    return { deletedStorage, alreadyMissingStorage, failedDelete };
  },
});

export const cleanupLegacyStorageBatch = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    cardsScanned: v.number(),
    refsFound: v.number(),
    r2Verified: v.number(),
    missingR2: v.number(),
    missingR2Key: v.number(),
    deletedStorage: v.number(),
    alreadyMissingStorage: v.number(),
    removedRefs: v.number(),
    skippedStaleRefs: v.number(),
    failedDelete: v.number(),
    dryRun: v.boolean(),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { cursor = null, limit = 50, dryRun = true }) => {
    const page = await ctx.runQuery(
      internal.storage.cleanupLegacyStorage.listLegacyStorageReferences,
      { cursor, numItems: limit }
    );
    const verifiedRefs: CleanupRef[] = [];
    const verifiedByKey = new Map<string, boolean>();
    let missingR2 = 0;
    let missingR2Key = 0;

    for (const ref of page.refs) {
      if (!ref.r2Key) {
        missingR2Key += 1;
        continue;
      }

      let verified = verifiedByKey.get(ref.r2Key);
      if (verified === undefined) {
        try {
          await r2.syncMetadata(ctx, ref.r2Key);
          verified = Boolean(await r2.getMetadata(ctx, ref.r2Key));
        } catch (error) {
          console.error("[storage/cleanupLegacyStorage] R2 verification failed", {
            cardId: ref.cardId,
            fieldPath: ref.fieldPath,
            r2Key: ref.r2Key,
            error,
          });
          verified = false;
        }
        verifiedByKey.set(ref.r2Key, verified);
      }

      if (verified) {
        verifiedRefs.push(ref);
      } else {
        missingR2 += 1;
      }
    }

    const cleanup = dryRun
      ? {
          deletedStorage: 0,
          alreadyMissingStorage: 0,
          removedRefs: 0,
          skippedStaleRefs: 0,
          failedDelete: 0,
        }
      : await ctx.runMutation(
          internal.storage.cleanupLegacyStorage.deleteLegacyStorageAndReferences,
          { refs: verifiedRefs }
        );

    return {
      cardsScanned: page.cardsScanned,
      refsFound: page.refs.length,
      r2Verified: verifiedRefs.length,
      missingR2,
      missingR2Key,
      dryRun,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      ...cleanup,
    };
  },
});

export const cleanupOrphanConvexStorageBatch = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    storageScanned: v.number(),
    orphanedStorage: v.number(),
    orphanedBytes: v.number(),
    referencedStorageIds: v.number(),
    deletedStorage: v.number(),
    alreadyMissingStorage: v.number(),
    failedDelete: v.number(),
    dryRun: v.boolean(),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { cursor = null, limit = 50, dryRun = true }) => {
    const page = await ctx.runQuery(
      internal.storage.cleanupLegacyStorage.listOrphanConvexStorageObjects,
      { cursor, numItems: limit }
    );
    const objects = page.objects as StorageObject[];
    const orphanedBytes = objects.reduce((sum, file) => sum + file.size, 0);

    const cleanup = dryRun
      ? {
          deletedStorage: 0,
          alreadyMissingStorage: 0,
          failedDelete: 0,
        }
      : await ctx.runMutation(
          internal.storage.cleanupLegacyStorage.deleteOrphanConvexStorageObjects,
          { storageIds: objects.map((file) => file.id) }
        );

    return {
      storageScanned: page.storageScanned,
      orphanedStorage: objects.length,
      orphanedBytes,
      referencedStorageIds: page.referencedStorageIds,
      dryRun,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      ...cleanup,
    };
  },
});
