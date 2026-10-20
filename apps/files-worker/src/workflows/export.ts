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

export interface ExportParams {
  jobId: string;
  userId: string;
}

export type ExportOutcome = "canceled" | "failed" | "ready";

const SNAPSHOT_PAGE_SIZE = 200;
const CARDS_PAGE_SIZE = 100;
const PER_CARD_JSON_BYTES = 2 * 1024;
const ITEM_CLEANUP_PAGE_SIZE = 200;

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

/**
 * One `snapshot page N` step result. The snapshot is the ids, kept here in
 * step state (200 ids are about 7 KB). A page without `cardIds` was written as
 * `exportJobItems` rows instead: by a run that started on an older Worker, or
 * while Convex did not have `getExportSnapshotPage` yet.
 */
interface SnapshotPage {
  addedBytes: number;
  addedCount: number;
  canceled: boolean;
  cardIds?: Id<"cards">[];
  cursor: string | null;
  isDone: boolean;
}

const SNAPSHOT_QUERY_REFUSED =
  "convex_rpc_refused:dataExport:getExportSnapshotPage:";

const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

const readArchiveCards = async (
  convex: ConvexRpc,
  jobId: Id<"exportJobs">,
  pages: readonly SnapshotPage[],
  hasJobItems: boolean
): Promise<ArchiveCard[]> => {
  const inputs: ArchiveCard[] = [];
  const seen = new Set<string>();
  const add = (cards: readonly ExportableCard[]) => {
    for (const card of cards) {
      if (!seen.has(card._id)) {
        seen.add(card._id);
        inputs.push({ card, fileKey: card.fileKey });
      }
    }
  };
  // Row pages can only come before id pages: Convex gains the snapshot query
  // during a run, never loses it.
  if (hasJobItems) {
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
      add(page.cards);
      if (page.isDone) {
        break;
      }
      cursor = page.cursor;
    }
  }
  const cardIds = pages.flatMap((page) => page.cardIds ?? []);
  for (let start = 0; start < cardIds.length; start += CARDS_PAGE_SIZE) {
    add(
      await convex.query(internal.dataExport.getExportCardsByIds, {
        cardIds: cardIds.slice(start, start + CARDS_PAGE_SIZE),
        jobId,
      })
    );
  }
  return inputs;
};

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
  const pages: SnapshotPage[] = [];
  // Set in this execution when a snapshot step fell back to writing rows, so a
  // failure in that same step still drains them.
  let wroteJobItems = false;
  const hasJobItems = () =>
    wroteJobItems || pages.some((page) => page.cardIds === undefined);

  const cleanupItems = async () => {
    if (!hasJobItems()) {
      return;
    }
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

  const takeSnapshotPage = async (
    cursor: string | null
  ): Promise<Omit<SnapshotPage, "canceled">> => {
    try {
      const page = await convex.query(
        internal.dataExport.getExportSnapshotPage,
        { cursor, jobId, numItems: SNAPSHOT_PAGE_SIZE }
      );
      return {
        addedBytes: page.addedBytes,
        addedCount: page.cardIds.length,
        cardIds: page.cardIds,
        cursor: page.cursor,
        isDone: page.isDone,
      };
    } catch (error) {
      // The Worker deploys before Convex: until Convex has the query, snapshot
      // the old way.
      if (!errorMessage(error).includes(SNAPSHOT_QUERY_REFUSED)) {
        throw error;
      }
      wroteJobItems = true;
      return await convex.mutation(internal.dataExport.recordSnapshotPage, {
        cursor,
        jobId,
        numItems: SNAPSHOT_PAGE_SIZE,
      });
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
    const inputs = await readArchiveCards(convex, jobId, pages, hasJobItems());
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
    const archiveWithout = async (
      omittedCardIds: ReadonlySet<string>
    ): Promise<FilesOpOutcome<BuildExportResult>> => {
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
      try {
        return await ops<BuildExportResult>({
          op: "build-export",
          params: { artifactKey, fileName, manifestKey },
        });
      } finally {
        await Promise.resolve(gatedEnv(env).BUCKET.delete(manifestKey)).catch(
          () => undefined
        );
      }
    };
    let outcome = await archiveWithout(new Set());
    if (outcome.kind === "ok" && outcome.data.omittedPaths.length > 0) {
      const missingFileCardIds = new Set(
        outcome.data.omittedPaths.flatMap((path) => {
          const cardId = cardIdByPath.get(path);
          return cardId ? [cardId] : [];
        })
      );
      outcome = await archiveWithout(missingFileCardIds);
    }
    if (outcome.kind === "fallback") {
      console.warn("[workflows/export] archive declined", {
        code: outcome.code,
        jobId,
      });
      return { failureClass: EXPORT_FAILURE_CLASS.ARCHIVE_FAILED, ok: false };
    }
    const built = outcome.data;
    if (await convex.query(internal.dataExport.isCancelRequested, { jobId })) {
      return { failureClass: EXPORT_FAILURE_CLASS.CANCELED, ok: false };
    }
    return {
      artifactBytes: built.artifactBytes,
      artifactKey,
      cardCount: inputs.length,
      filesIncluded: built.filesIncluded,
      filesOmitted: built.filesOmitted,
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
      const recorded: SnapshotPage = await step.do(
        `snapshot page ${page}`,
        CONVEX_STEP,
        () =>
          settleConvexErrors(async () => {
            const snapshot = await takeSnapshotPage(cursor);
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
      pages.push(recorded);
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
    if (hasJobItems()) {
      await step.do("delete job items", CONVEX_STEP, () =>
        settleConvexErrors(async () => {
          await cleanupItems();
          return null;
        })
      );
    }
    return { status: "ready" };
  };

  return runReported(
    run,
    async () => {
      try {
        return await body();
      } catch (error) {
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
