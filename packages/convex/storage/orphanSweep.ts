import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { buildR2ListPrefix } from "./r2Keys";

// Reads for the weekly orphaned-object report. The Files Worker's maintenance
// workflow pages the cards, lists the bucket under `listPrefix` and logs what
// no row references. It never deletes.

/** This deployment's user-object prefix in the shared bucket. */
export const listPrefix = internalQuery({
  args: {},
  returns: v.string(),
  handler: () => buildR2ListPrefix(),
});

export const pageSweepCards = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    numItems: v.number(),
  },
  returns: v.object({
    continueCursor: v.string(),
    isDone: v.boolean(),
    cards: v.array(
      v.object({
        fileKey: v.optional(v.string()),
        metadata: v.any(),
        previewKey: v.optional(v.string()),
        previousThumbnailOverride: v.optional(
          v.object({
            override: v.union(v.object({ storageKey: v.string() }), v.null()),
          })
        ),
        scrubKey: v.optional(v.string()),
        thumbnailKey: v.optional(v.string()),
        thumbnailOverride: v.optional(v.object({ storageKey: v.string() })),
        workflowArtifactKeys: v.optional(v.array(v.string())),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("cards").paginate({
      cursor: args.cursor ?? null,
      numItems: args.numItems,
    });
    return {
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      cards: page.page.map((card) => ({
        fileKey: card.fileKey,
        workflowArtifactKeys: card.workflowArtifactKeys,
        metadata:
          card.metadata && typeof card.metadata === "object"
            ? {
                linkPreview: card.metadata.linkPreview,
                linkCategory: card.metadata.linkCategory,
              }
            : {},
        previewKey: card.previewKey,
        scrubKey: card.scrubKey,
        thumbnailKey: card.thumbnailKey,
        // A chosen link image, and the one kept for its undo window.
        ...(card.thumbnailOverride
          ? {
              thumbnailOverride: {
                storageKey: card.thumbnailOverride.storageKey,
              },
            }
          : {}),
        ...(card.previousThumbnailOverride
          ? {
              previousThumbnailOverride: {
                override: card.previousThumbnailOverride.override
                  ? {
                      storageKey:
                        card.previousThumbnailOverride.override.storageKey,
                    }
                  : null,
              },
            }
          : {}),
      })),
    };
  },
});

export const collectNonCardReferencedKeys = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const keys: string[] = [];
    for await (const session of ctx.db.query("fileUploadSessions")) {
      keys.push(session.sourceKey);
    }
    for await (const job of ctx.db.query("importJobs")) {
      keys.push(job.sourceKey);
      if (job.reportKey) {
        keys.push(job.reportKey);
      }
    }
    for await (const job of ctx.db.query("exportJobs")) {
      if (!job.artifactKey) {
        continue;
      }
      keys.push(
        job.artifactKey,
        `${job.artifactKey}.checkpoint.json`,
        `${job.artifactKey}.result.json`
      );
    }
    return keys;
  },
});

export const logOrphanReport = internalMutation({
  args: {
    orphanCount: v.number(),
    orphanBytes: v.number(),
    scannedObjects: v.number(),
  },
  returns: v.null(),
  handler: (_ctx, args) => {
    const message =
      args.orphanCount > 0
        ? "storage.orphaned_objects_detected"
        : "storage.orphan_scan_clean";
    console.log("[storage/orphanSweep]", message, args);
    return null;
  },
});
