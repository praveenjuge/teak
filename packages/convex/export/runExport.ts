/**
 * Node action that performs the heavy export work:
 *   1. pages the start-time snapshot (joined to active card docs)
 *   2. reads each original file directly from Cloudflare R2 via the AWS S3 SDK
 *   3. builds the streaming ZIP archive (manifest.json + cards.json + files/)
 *   4. writes the completed artifact back to private R2 via the AWS S3 SDK
 *
 * Runs in the Convex Node runtime so it can use `archiver` and `@aws-sdk/client-s3`.
 */

"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { type ActionCtx, internalAction } from "../_generated/server";
import { TELEMETRY_OPERATIONS } from "../shared/telemetry";
import {
  callFilesWorkerJson,
  type FilesWorkerBuildExportResult,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import { buildR2ObjectKey, storeObject } from "../storage/r2";
import { withBackendSpan } from "../telemetry/sentry";
import {
  CARDS_ENTRY_NAME,
  EXPORT_FAILURE_CLASS,
  MANIFEST_ENTRY_NAME,
  MAX_EXPORT_BYTES,
} from "./constants";
import {
  buildFilePath,
  buildManifest,
  computeExpiry,
  serializeCard,
} from "./serialize";

const internalAny = internal as Record<string, any>;

const observeExport =
  <TArgs, TResult>(
    name: string,
    handler: (ctx: ActionCtx, args: TArgs) => Promise<TResult>
  ) =>
  (ctx: ActionCtx, args: TArgs): Promise<TResult> =>
    withBackendSpan(
      {
        name,
        operation: TELEMETRY_OPERATIONS.export,
        stage: "export",
        surface: "backend",
        workflowId:
          args &&
          typeof args === "object" &&
          "jobId" in args &&
          typeof args.jobId === "string"
            ? args.jobId
            : undefined,
      },
      () => handler(ctx, args)
    );

const SNAPSHOT_PAGE_SIZE = 100;
type ExportCard = Parameters<typeof serializeCard>[0];
interface ArchiveCardInput {
  card: ExportCard;
  fileKey?: string;
}

function buildArtifactKey(userId: string, jobId: string): string {
  const hashUserId = createHash("sha256")
    .update(userId)
    .digest("hex")
    .slice(0, 16);
  const stamp = new Date().toISOString().slice(0, 10);
  return ["users", hashUserId, "exports", `${jobId}-${stamp}.zip`].join("/");
}

const EXPORT_MANIFEST_VERSION = 1;

/**
 * Worker-backed export fast path.
 *
 * Serializes cards and entry paths, then hands the worker a small manifest
 * (inline JSON entries + storage keys); the
 * worker streams object bytes straight through client-zip into a multipart
 * R2 upload without the bytes ever transiting this action.
 *
 * When files turn out to be missing, the worker reports their archive paths
 * and cards.json is rebuilt with those cards' `file` entries dropped, then
 * the op runs once more — matching legacy omission semantics.
 *
 * Returns null when the worker is unavailable, declines the manifest, or an
 * unexpected error occurs.
 */
async function runExportArchiveViaFilesWorker(
  ctx: ActionCtx,
  args: {
    userId: string;
    jobId: string;
    inputs: ArchiveCardInput[];
    createdAtMs: number;
    expiresAtMs: number;
  }
): Promise<{
  ok: boolean;
  artifactKey: string;
  artifactBytes: number;
  cardCount: number;
  filesIncluded: number;
  filesOmitted: number;
} | null> {
  try {
    if (!isFilesWorkerConfigured()) {
      return null;
    }

    const { userId, jobId, inputs, createdAtMs, expiresAtMs } = args;
    const artifactKey = buildArtifactKey(userId, jobId);
    const downloadName = `teak-export-${new Date().toISOString().slice(0, 10)}.zip`;

    // Path of each file entry → card id, so omissions can be attributed.
    const cardIdByPath = new Map<string, string>();
    const omittedCardIds = new Set<string>();
    for (const input of inputs) {
      if (!input.fileKey) {
        continue;
      }
      cardIdByPath.set(
        buildFilePath(input.card._id, input.card.fileMetadata?.fileName),
        input.card._id
      );
    }

    const buildManifestObject = async (): Promise<string> => {
      const fileEntries = inputs
        .filter((input) => input.fileKey)
        .map((input) => ({
          path: buildFilePath(
            input.card._id,
            input.card.fileMetadata?.fileName
          ),
          storageKey: input.fileKey as string,
        }));
      const serializedCards = inputs.map((input) => {
        const included =
          Boolean(input.fileKey) && !omittedCardIds.has(input.card._id);
        return serializeCard(input.card, { includeFile: included });
      });
      const filesIncluded = serializedCards.filter(
        (card) => card.file !== undefined
      ).length;
      const manifestJson = JSON.stringify({
        v: EXPORT_MANIFEST_VERSION,
        maxBytes: MAX_EXPORT_BYTES,
        entries: [
          {
            path: MANIFEST_ENTRY_NAME,
            contentBase64: Buffer.from(
              JSON.stringify(
                buildManifest({
                  createdAtMs,
                  expiresAtMs,
                  cardCount: serializedCards.length,
                  filesIncluded,
                  filesOmitted:
                    inputs.filter((input) => input.fileKey).length -
                    filesIncluded,
                }),
                null,
                2
              ),
              "utf8"
            ).toString("base64"),
          },
          {
            path: CARDS_ENTRY_NAME,
            contentBase64: Buffer.from(
              JSON.stringify({ cards: serializedCards }, null, 2),
              "utf8"
            ).toString("base64"),
          },
          ...fileEntries,
        ],
      });

      const manifestKey = buildR2ObjectKey({
        userId,
        role: "export-manifest",
      });
      await storeObject(ctx, new Blob([manifestJson]), {
        key: manifestKey,
        type: "application/json",
      });
      return manifestKey;
    };

    const deleteManifest = async (key: string): Promise<void> => {
      await callFilesWorkerJson({
        op: "delete-object",
        params: { key },
      }).catch(() => undefined);
    };

    let artifactBytes = 0;
    let filesIncluded = 0;
    let filesOmitted = 0;

    // Two attempts maximum: the second only when files were omitted and
    // cards.json must be corrected.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const manifestKey = await buildManifestObject();
      try {
        const outcome = await callFilesWorkerJson<FilesWorkerBuildExportResult>(
          {
            op: "build-export",
            params: {
              artifactKey,
              fileName: downloadName,
              manifestKey,
            },
          }
        );
        await deleteManifest(manifestKey);

        if (outcome.kind === "fallback") {
          return null;
        }

        artifactBytes = outcome.data.artifactBytes;
        filesIncluded = outcome.data.filesIncluded;
        filesOmitted = outcome.data.filesOmitted;

        if (outcome.data.omittedPaths.length === 0 || attempt === 1) {
          break;
        }
        for (const path of outcome.data.omittedPaths) {
          const cardId = cardIdByPath.get(path);
          if (cardId) {
            omittedCardIds.add(cardId);
          }
        }
      } catch {
        await deleteManifest(manifestKey);
        return null;
      }
    }

    return {
      ok: true,
      artifactKey,
      artifactBytes,
      cardCount: inputs.length,
      filesIncluded,
      filesOmitted,
    };
  } catch {
    // Any unexpected failure falls back to the proven Node path.
    return null;
  }
}

export const runExportArchive = internalAction({
  args: { jobId: v.id("exportJobs"), userId: v.string() },
  returns: v.object({
    ok: v.boolean(),
    failureClass: v.optional(v.string()),
    artifactKey: v.optional(v.string()),
    artifactBytes: v.optional(v.number()),
    cardCount: v.optional(v.number()),
    filesIncluded: v.optional(v.number()),
    filesOmitted: v.optional(v.number()),
  }),
  handler: observeExport(
    "export.archive",
    async (ctx, { jobId, userId }: { jobId: string; userId: string }) => {
      // Bail early if a cancellation was requested before we started.
      const canceledBefore = await ctx.runQuery(
        internalAny.dataExport.isCancelRequested,
        {
          jobId,
        }
      );
      if (canceledBefore) {
        return { ok: false, failureClass: "canceled" };
      }

      if (!isFilesWorkerConfigured()) {
        return { ok: false, failureClass: "storage_failed" };
      }

      // Assemble the start-time card set from the snapshot.
      const inputs: ArchiveCardInput[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page: { cursor: string | null; isDone: boolean; cards: any[] } =
          await ctx.runQuery(internalAny.dataExport.getExportCardsPage, {
            jobId,
            cursor,
            numItems: SNAPSHOT_PAGE_SIZE,
          });
        for (const card of page.cards) {
          inputs.push({ card, fileKey: card.fileKey });
        }
        if (page.isDone) {
          break;
        }
        cursor = page.cursor;
      }

      const createdAtMs = Date.now();
      const expiresAtMs = computeExpiry(createdAtMs);

      const workerResult = await runExportArchiveViaFilesWorker(ctx, {
        jobId,
        inputs,
        userId,
        createdAtMs,
        expiresAtMs,
      });
      if (!workerResult) {
        return { ok: false, failureClass: "archive_failed" };
      }
      const canceledAfterWorker = await ctx.runQuery(
        internalAny.dataExport.isCancelRequested,
        { jobId }
      );
      if (canceledAfterWorker) {
        return { ok: false, failureClass: EXPORT_FAILURE_CLASS.CANCELED };
      }
      return workerResult;
    }
  ),
});

/** Delete a completed export artifact directly from R2. Never throws. */
export const deleteArtifact = internalAction({
  args: { artifactKey: v.string() },
  returns: v.object({ deleted: v.boolean() }),
  handler: observeExport(
    "export.delete_artifact",
    async (_ctx, { artifactKey }: { artifactKey: string }) => {
      try {
        const results = await Promise.all(
          [
            artifactKey,
            `${artifactKey}.checkpoint.json`,
            `${artifactKey}.result.json`,
          ].map((key) =>
            callFilesWorkerJson<{ deleted: boolean }>({
              op: "delete-object",
              params: { key },
            })
          )
        );
        return {
          deleted: results.every(
            (result) => result.kind === "ok" && result.data.deleted
          ),
        };
      } catch {
        return { deleted: false };
      }
    }
  ),
});
