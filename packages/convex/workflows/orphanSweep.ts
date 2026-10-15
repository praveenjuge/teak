"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { type ActionCtx, internalAction } from "../_generated/server";
import {
  callFilesWorkerJson,
  type FilesWorkerListObjectsResult,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import { cardStorageObjectKeys } from "../storage/r2";
import { buildR2ListPrefix } from "../storage/r2Keys";

const ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const CARDS_PAGE_SIZE = 500;
const LIST_PAGE_LIMIT = 1000;
const MAX_CARDS_PAGES = 4000;
const MAX_LIST_PAGES = 2000;

export const sweepOrphanedObjectsHandler = async (
  ctx: ActionCtx
): Promise<{ orphanCount: number }> => {
  if (!isFilesWorkerConfigured()) {
    throw new Error("files_worker_not_configured");
  }

  const referenced = new Set<string>();
  let cursor: string | undefined;
  let isDone = false;
  let cardsPages = 0;
  do {
    const page = (await ctx.runQuery(
      internal.workflows.orphanSweepQueries.pageSweepCards,
      {
        cursor,
        numItems: CARDS_PAGE_SIZE,
      }
    )) as {
      cards: Array<{
        fileKey?: string;
        metadata?: any;
        previewKey?: string;
        scrubKey?: string;
        thumbnailKey?: string;
        workflowArtifactKeys?: string[];
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
    internal.workflows.orphanSweepQueries.collectNonCardReferencedKeys
  )) {
    if (key) {
      referenced.add(key);
    }
  }

  const cutoff = Date.now() - ORPHAN_GRACE_MS;
  let listCursor: string | null = null;
  let scannedObjects = 0;
  let orphanCount = 0;
  let orphanBytes = 0;
  let listPages = 0;

  do {
    const params: Record<string, unknown> = {
      prefix: buildR2ListPrefix(),
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

  await ctx.runMutation(internal.workflows.orphanSweepQueries.logOrphanReport, {
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
