/**
 * Weekly Orphaned-Object Reconciliation Sweep (report-only)
 *
 * Enumerates every object stored under the card storage namespace and compares
 * it against the set of keys referenced by durable records (cards, active
 * upload sessions, import jobs, export artifacts). Objects that no record
 * references and that have not been modified within the grace window are
 * counted as orphans. The sweep never deletes anything: it logs a summary so
 * operators can investigate accumulation bugs (e.g. a step that uploads a
 * renderable but crashes before recording the key on the card).
 */

"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import {
  callFilesWorkerJson,
  type FilesWorkerListObjectsResult,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import { cardStorageObjectKeys } from "../storage/r2";
import { recordBackendLog } from "../telemetry/sentry";

// Orphans younger than this are ignored: pending-upload sessions, in-flight
// imports/exports, and not-yet-recorded renderables legitimately create
// objects shortly before their referencing record lands. The hourly stale
// pending-upload sweep handles the short-lived cases.
const ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const CARDS_PAGE_SIZE = 500;
const LIST_PAGE_LIMIT = 1000;
// Hard caps so a pathological dataset cannot spin the cron forever; the next
// weekly run continues from where listing left off.
const MAX_CARDS_PAGES = 4000;
const MAX_LIST_PAGES = 2000;

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
    recordBackendLog(
      args.orphanCount > 0 ? "warn" : "info",
      message,
      args as unknown as Record<string, string | number | boolean>
    );
    console.log("[workflow/orphanSweep]", message, args);
    return null;
  },
});

export const sweepOrphanedObjectsHandler = async (
  ctx: ActionCtx
): Promise<{ orphanCount: number }> => {
  if (!isFilesWorkerConfigured()) {
    throw new Error("files_worker_not_configured");
  }

  // 1. Build the referenced-key set from cards (paged) + non-card records.
  const referenced = new Set<string>();
  let cursor: string | undefined;
  let isDone = false;
  let cardsPages = 0;
  do {
    const page = (await ctx.runQuery(
      internal.workflows.orphanSweep.pageSweepCards,
      {
        cursor,
        numItems: CARDS_PAGE_SIZE,
      }
    )) as {
      cards: Array<{
        fileKey?: string;
        metadata?: any;
        previewKey?: string;
        thumbnailKey?: string;
      }>;
      continueCursor: string;
      isDone: boolean;
    };
    for (const card of page.cards) {
      for (const key of cardStorageObjectKeys(card)) {
        referenced.add(key);
      }
    }
    cursor = page.continueCursor;
    isDone = page.isDone;
    cardsPages += 1;
  } while (!isDone && cardsPages < MAX_CARDS_PAGES);

  for (const key of await ctx.runQuery(
    internal.workflows.orphanSweep.collectNonCardReferencedKeys
  )) {
    if (key) {
      referenced.add(key);
    }
  }

  // 2. List bucket objects under the card namespace and diff.
  const cutoff = Date.now() - ORPHAN_GRACE_MS;
  let listCursor: string | null = null;
  let scannedObjects = 0;
  let orphanCount = 0;
  let orphanBytes = 0;
  let listPages = 0;

  do {
    const params: Record<string, unknown> = {
      prefix: "users/",
      limit: LIST_PAGE_LIMIT,
    };
    if (listCursor) {
      params.cursor = listCursor;
    }
    const outcome = await callFilesWorkerJson<FilesWorkerListObjectsResult>({
      op: "list-objects",
      params,
    });
    if (outcome.kind !== "ok") {
      throw new Error("files_worker_list_objects_unavailable");
    }
    listPages += 1;
    listCursor = outcome.data.cursor;
    for (const object of outcome.data.objects) {
      scannedObjects += 1;
      if (!referenced.has(object.key) && object.lastModified <= cutoff) {
        orphanCount += 1;
        orphanBytes += object.size;
      }
    }
  } while (listCursor && listPages < MAX_LIST_PAGES);

  await ctx.runMutation(internal.workflows.orphanSweep.logOrphanReport, {
    orphanBytes,
    orphanCount,
    scannedObjects,
  });

  return { orphanCount };
};

export const sweepOrphanedObjects = internalAction({
  args: {},
  returns: v.object({ orphanCount: v.number() }),
  handler: sweepOrphanedObjectsHandler,
});
