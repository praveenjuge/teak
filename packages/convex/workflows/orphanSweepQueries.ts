/**
 * V8-runtime helpers for the weekly orphaned-object reconciliation sweep.
 * Queries and mutations cannot live in "use node" modules, so they are split
 * out from the sweep action in workflows/orphanSweep.ts.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

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
        thumbnailKey: v.optional(v.string()),
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
        // Only linkPreview metadata carries storage keys.
        metadata:
          card.metadata && typeof card.metadata === "object"
            ? { linkPreview: card.metadata.linkPreview }
            : {},
        previewKey: card.previewKey,
        thumbnailKey: card.thumbnailKey,
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
    // Durable dashboard-visible log; backend telemetry is recorded by the
    // sweep action (Sentry lives behind a "use node" module).
    console.log("[workflow/orphanSweep]", message, args);
    return null;
  },
});
