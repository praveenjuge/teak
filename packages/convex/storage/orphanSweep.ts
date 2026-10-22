import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";
import { importStagedPartKeys } from "../import/indexItems";
import { buildR2UserPrefix } from "./r2";
import { buildR2ListPrefix } from "./r2Keys";

const LINKED_PDF_CLAIM_LIVE_MS = 7 * 24 * 60 * 60 * 1000;

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

const MAX_REFERENCE_PAGE = 100;

const referenceSourceValidator = v.union(
  v.literal("uploads"),
  v.literal("imports"),
  v.literal("pendingLinkedPdfs"),
  v.literal("failedLinkedPdfs"),
  v.literal("exports")
);

const importJobKeys = (job: Doc<"importJobs">): string[] => [
  job.sourceKey,
  ...(job.reportKey ? [job.reportKey] : []),
  ...importStagedPartKeys(
    buildR2UserPrefix(job.userId),
    job._id,
    job.stagedItems
  ),
];

const exportJobKeys = (job: Doc<"exportJobs">): string[] =>
  job.artifactKey
    ? [
        job.artifactKey,
        `${job.artifactKey}.checkpoint.json`,
        `${job.artifactKey}.result.json`,
      ]
    : [];

/**
 * One page of the R2 keys rows other than cards still hold, from one source.
 * The orphan sweep reads every source to the end; a page of imports stays
 * small because each job holds its staged parts too.
 */
export const pageNonCardReferencedKeys = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    source: referenceSourceValidator,
  },
  returns: v.object({
    continueCursor: v.string(),
    isDone: v.boolean(),
    keys: v.array(v.string()),
  }),
  handler: async (ctx, { cursor, numItems, source }) => {
    const pageOpts = {
      cursor,
      numItems: Math.max(1, Math.min(numItems, MAX_REFERENCE_PAGE)),
    };
    const done = <T>(
      page: { continueCursor: string; isDone: boolean; page: T[] },
      keysOf: (row: T) => string[]
    ) => ({
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      keys: page.page.flatMap(keysOf),
    });
    switch (source) {
      case "uploads":
        return done(
          await ctx.db.query("fileUploadSessions").paginate(pageOpts),
          (session) => [session.sourceKey]
        );
      case "imports":
        return done(
          await ctx.db.query("importJobs").paginate({
            ...pageOpts,
            numItems: Math.min(pageOpts.numItems, 10),
          }),
          importJobKeys
        );
      case "exports":
        return done(
          await ctx.db.query("exportJobs").paginate(pageOpts),
          exportJobKeys
        );
      default: {
        const liveSince = Date.now() - LINKED_PDF_CLAIM_LIVE_MS;
        const status = source === "pendingLinkedPdfs" ? "pending" : "failed";
        return done(
          await ctx.db
            .query("linkedPdfs")
            .withIndex("by_status", (q) => q.eq("status", status))
            .paginate(pageOpts),
          (row) => (row.updatedAt >= liveSince ? [row.fileKey] : [])
        );
      }
    }
  },
});

// The Files Worker before `pageNonCardReferencedKeys` reads this in one call
// (`.agents/sunset.md`).
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
      keys.push(
        ...importStagedPartKeys(
          buildR2UserPrefix(job.userId),
          job._id,
          job.stagedItems
        )
      );
    }
    const liveSince = Date.now() - LINKED_PDF_CLAIM_LIVE_MS;
    for (const status of ["pending", "failed"] as const) {
      for await (const row of ctx.db
        .query("linkedPdfs")
        .withIndex("by_status", (q) => q.eq("status", status))) {
        if (row.updatedAt >= liveSince) {
          keys.push(row.fileKey);
        }
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
