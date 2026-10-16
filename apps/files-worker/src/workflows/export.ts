import { Buffer } from "node:buffer";
import { internal } from "@teak/convex/_generated/api";
import type { Id } from "@teak/convex/_generated/dataModel";
import { buildBookmarksHtml } from "@teak/convex/export/bookmarks";
import {
  BOOKMARKS_ENTRY_NAME,
  CARDS_ENTRY_NAME,
  CSV_ENTRY_NAME,
  EXPORT_FAILURE_CLASS,
  type ExportFailureClass,
  MANIFEST_ENTRY_NAME,
  MAX_EXPORT_BYTES,
  MAX_EXPORT_CARDS,
} from "@teak/convex/export/constants";
import { buildCardsCsv } from "@teak/convex/export/csv";
import {
  buildFilePath,
  buildManifest,
  computeExpiry,
  type ExportableCard,
  serializeCard,
} from "@teak/convex/export/serialize";
import {
  FILES_EXPORT_MANIFEST_VERSION,
  type FilesExportManifest,
} from "@teak/files-protocol";
import type { ConvexRpc } from "../convexRpc";
import type { BuildExportResult } from "../export";
import { resolveDeps, settleConvexErrors, type WorkflowDeps } from "./deps";
import { type FilesOpOutcome, gatedEnv } from "./filesOps";
import {
  CONVEX_STEP,
  errorMessage,
  retryConfig,
  runReported,
  type WorkflowRun,
} from "./runtime";

// Exports a user's library: snapshots the card set into exportJobItems, then
// builds the ZIP in R2 with the in-process build-export op. Mirrors the
// former Convex export workflow; the archive no longer costs Convex action
// time while the Worker streams it.

export interface ExportParams {
  jobId: string;
  userId: string;
}

export type ExportOutcome = "canceled" | "failed" | "ready";

const SNAPSHOT_PAGE_SIZE = 200;
const CARDS_PAGE_SIZE = 100;
const PER_CARD_JSON_BYTES = 2 * 1024;
const ITEM_CLEANUP_PAGE_SIZE = 200;

/** Builds the archive in one step: reading cards, both attempts, cleanup. */
const ARCHIVE_STEP = retryConfig(3, 30_000, "30 minutes");

interface ArchiveCard {
  card: ExportableCard;
  fileKey?: string;
}

type ArchiveResult =
  | {
      artifactBytes: number;
      artifactKey: string;
      cardCount: number;
      filesIncluded: number;
      filesOmitted: number;
      ok: true;
    }
  | { failureClass: ExportFailureClass; ok: false };

const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

/** The job's snapshot, once per card even if a snapshot page was retried. */
const readArchiveCards = async (
  convex: ConvexRpc,
  jobId: Id<"exportJobs">
): Promise<ArchiveCard[]> => {
  const inputs: ArchiveCard[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const page: {
      cards: ExportableCard[];
      cursor: string | null;
      isDone: boolean;
    } = await convex.query(internal.dataExport.getExportCardsPage, {
      cursor,
      jobId,
      numItems: CARDS_PAGE_SIZE,
    });
    for (const card of page.cards) {
      if (!seen.has(card._id)) {
        seen.add(card._id);
        inputs.push({ card, fileKey: card.fileKey });
      }
    }
    if (page.isDone) {
      return inputs;
    }
    cursor = page.cursor;
  }
};

/**
 * The build-export manifest: the JSON, bookmarks and CSV entries inline and
 * each original file by storage key. Cards whose file is in `omittedCardIds`
 * lose their `file` entry, as the archive will not hold it.
 */
export const buildExportManifest = (args: {
  createdAtMs: number;
  expiresAtMs: number;
  folderNames: ReadonlyMap<string, string>;
  inputs: ArchiveCard[];
  omittedCardIds: ReadonlySet<string>;
}): FilesExportManifest => {
  const { createdAtMs, expiresAtMs, folderNames, inputs, omittedCardIds } =
    args;
  const withFiles = inputs.filter((input) => input.fileKey);
  const serializedCards = inputs.map((input) =>
    serializeCard(input.card, {
      folderNames,
      includeFile:
        Boolean(input.fileKey) && !omittedCardIds.has(input.card._id),
    })
  );
  const filesIncluded = serializedCards.filter(
    (card) => card.file !== undefined
  ).length;
  return {
    entries: [
      {
        contentBase64: base64(
          JSON.stringify(
            buildManifest({
              cardCount: serializedCards.length,
              createdAtMs,
              expiresAtMs,
              filesIncluded,
              filesOmitted: withFiles.length - filesIncluded,
            }),
            null,
            2
          )
        ),
        path: MANIFEST_ENTRY_NAME,
      },
      {
        contentBase64: base64(
          JSON.stringify({ cards: serializedCards }, null, 2)
        ),
        path: CARDS_ENTRY_NAME,
      },
      {
        contentBase64: base64(buildBookmarksHtml(serializedCards)),
        path: BOOKMARKS_ENTRY_NAME,
      },
      {
        contentBase64: base64(buildCardsCsv(serializedCards)),
        path: CSV_ENTRY_NAME,
      },
      ...withFiles.map((input) => ({
        path: buildFilePath(input.card._id, input.card.fileMetadata?.fileName),
        storageKey: input.fileKey as string,
      })),
    ],
    maxBytes: MAX_EXPORT_BYTES,
    v: FILES_EXPORT_MANIFEST_VERSION,
  };
};

export const runExport = (
  run: WorkflowRun<ExportParams>,
  deps: WorkflowDeps = {}
): Promise<{ status: ExportOutcome }> => {
  const { convex, ops } = resolveDeps(run, deps);
  const { env, instanceId, step } = run;
  const jobId = run.params.jobId as Id<"exportJobs">;
  const { userId } = run.params;

  const cleanupItems = async () => {
    for (;;) {
      const result = await convex.mutation(
        internal.dataExport.deleteJobItemsPage,
        { jobId, numItems: ITEM_CLEANUP_PAGE_SIZE }
      );
      if (!result.hasMore) {
        return;
      }
    }
  };

  const fail = (failureClass: ExportFailureClass) =>
    step.do(`fail export (${failureClass})`, CONVEX_STEP, () =>
      settleConvexErrors(async () => {
        await cleanupItems();
        await convex.mutation(internal.dataExport.failExport, {
          failureClass,
          jobId,
        });
        return null;
      })
    );

  const ensureOwned = async (key: string) => {
    if (
      !(await convex.mutation(internal.storage.ownership.registerObject, {
        exportJobId: jobId,
        key,
        userId,
      }))
    ) {
      throw new Error("account_storage_write_denied");
    }
  };

  const buildArchive = async (artifactKey: string): Promise<ArchiveResult> => {
    await convex.mutation(internal.dataExport.recordExportProgress, {
      jobId,
      stage: "archiving",
    });
    if (await convex.query(internal.dataExport.isCancelRequested, { jobId })) {
      return { failureClass: EXPORT_FAILURE_CLASS.CANCELED, ok: false };
    }
    const inputs = await readArchiveCards(convex, jobId);
    const folders: Array<{ id: string; name: string }> = await convex.query(
      internal.dataExport.getExportFolderNames,
      { jobId }
    );
    const folderNames = new Map(
      folders.map((folder) => [folder.id, folder.name] as const)
    );
    const manifestKey = `${artifactKey}.manifest.json`;
    for (const key of [
      artifactKey,
      `${artifactKey}.checkpoint.json`,
      `${artifactKey}.result.json`,
      manifestKey,
    ]) {
      await ensureOwned(key);
    }
    const createdAtMs = Date.now();
    const expiresAtMs = computeExpiry(createdAtMs);
    const fileName = `teak-export-${new Date(createdAtMs).toISOString().slice(0, 10)}.zip`;
    const cardIdByPath = new Map(
      inputs
        .filter((input) => input.fileKey)
        .map((input) => [
          buildFilePath(input.card._id, input.card.fileMetadata?.fileName),
          input.card._id,
        ])
    );
    const omittedCardIds = new Set<string>();
    let built: BuildExportResult | null = null;
    // A file missing from storage is left out: the second pass rebuilds
    // cards.json without its `file` entry, as the archive won't hold it.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await gatedEnv(env).BUCKET.put(
        manifestKey,
        JSON.stringify(
          buildExportManifest({
            createdAtMs,
            expiresAtMs,
            folderNames,
            inputs,
            omittedCardIds,
          })
        ),
        { httpMetadata: { contentType: "application/json" } }
      );
      let outcome: FilesOpOutcome<BuildExportResult>;
      try {
        outcome = await ops<BuildExportResult>({
          op: "build-export",
          params: { artifactKey, fileName, manifestKey },
        });
      } finally {
        await Promise.resolve(gatedEnv(env).BUCKET.delete(manifestKey)).catch(
          () => undefined
        );
      }
      if (outcome.kind === "fallback") {
        console.warn("[workflows/export] archive declined", {
          code: outcome.code,
          jobId,
        });
        return { failureClass: EXPORT_FAILURE_CLASS.ARCHIVE_FAILED, ok: false };
      }
      built = outcome.data;
      if (built.omittedPaths.length === 0 || attempt === 1) {
        break;
      }
      for (const path of built.omittedPaths) {
        const cardId = cardIdByPath.get(path);
        if (cardId) {
          omittedCardIds.add(cardId);
        }
      }
    }
    if (await convex.query(internal.dataExport.isCancelRequested, { jobId })) {
      return { failureClass: EXPORT_FAILURE_CLASS.CANCELED, ok: false };
    }
    return {
      artifactBytes: built?.artifactBytes ?? 0,
      artifactKey,
      cardCount: inputs.length,
      filesIncluded: built?.filesIncluded ?? 0,
      filesOmitted: built?.filesOmitted ?? 0,
      ok: true,
    };
  };

  let settled = false;
  const finish = async (
    failureClass: ExportFailureClass
  ): Promise<{ status: ExportOutcome }> => {
    await fail(failureClass);
    settled = true;
    return {
      status:
        failureClass === EXPORT_FAILURE_CLASS.CANCELED ? "canceled" : "failed",
    };
  };

  const body = async (): Promise<{ status: ExportOutcome }> => {
    const running = await step.do("mark running", CONVEX_STEP, () =>
      settleConvexErrors(() =>
        convex.mutation(internal.dataExport.markRunning, {
          jobId,
          workflowId: instanceId,
        })
      )
    );
    if (running.canceled || !running.artifactKey) {
      return finish(EXPORT_FAILURE_CLASS.CANCELED);
    }
    const { artifactKey } = running;

    let cursor: string | null = null;
    let totalCount = 0;
    let totalBytes = 0;
    for (let page = 1; ; page += 1) {
      const recorded = await step.do(`snapshot page ${page}`, CONVEX_STEP, () =>
        settleConvexErrors(async () => {
          const snapshot = await convex.mutation(
            internal.dataExport.recordSnapshotPage,
            { cursor, jobId, numItems: SNAPSHOT_PAGE_SIZE }
          );
          await convex.mutation(internal.dataExport.recordExportProgress, {
            jobId,
            processedCount: totalCount + snapshot.addedCount,
            stage: "snapshotting",
          });
          const canceled =
            !snapshot.isDone &&
            (await convex.query(internal.dataExport.isCancelRequested, {
              jobId,
            }));
          return { ...snapshot, canceled };
        })
      );
      totalCount += recorded.addedCount;
      totalBytes += recorded.addedBytes;
      if (
        totalCount > MAX_EXPORT_CARDS ||
        totalBytes + totalCount * PER_CARD_JSON_BYTES > MAX_EXPORT_BYTES
      ) {
        console.warn("[workflows/export] cap exceeded", { jobId });
        return finish(EXPORT_FAILURE_CLASS.CAP_EXCEEDED);
      }
      if (recorded.isDone) {
        break;
      }
      if (recorded.canceled) {
        return finish(EXPORT_FAILURE_CLASS.CANCELED);
      }
      cursor = recorded.cursor;
    }

    let archive: ArchiveResult;
    try {
      archive = await step.do("build archive", ARCHIVE_STEP, () =>
        buildArchive(artifactKey)
      );
    } catch (error) {
      console.error("[workflows/export] archive failed", {
        error: errorMessage(error),
        jobId,
      });
      archive = {
        failureClass: EXPORT_FAILURE_CLASS.ARCHIVE_FAILED,
        ok: false,
      };
    }
    if (!archive.ok) {
      return finish(archive.failureClass);
    }
    const { ok: _ok, ...completed } = archive;
    await step.do("complete export", CONVEX_STEP, () =>
      settleConvexErrors(async () => {
        await convex.mutation(internal.dataExport.completeExport, {
          ...completed,
          jobId,
        });
        return null;
      })
    );
    settled = true;
    await step.do("delete job items", CONVEX_STEP, () =>
      settleConvexErrors(async () => {
        await cleanupItems();
        return null;
      })
    );
    return { status: "ready" };
  };

  return runReported(
    run,
    async () => {
      try {
        return await body();
      } catch (error) {
        // A job never stays running: fail it here, and the completion report
        // fails it again if this cannot.
        if (!settled) {
          await fail(EXPORT_FAILURE_CLASS.UNKNOWN).catch((failError) => {
            console.error("[workflows/export] could not fail the job", {
              error: errorMessage(failError),
              jobId,
            });
          });
        }
        throw error;
      }
    },
    convex
  );
};
