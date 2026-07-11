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
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { type ActionCtx, internalAction } from "../_generated/server";
import { TELEMETRY_OPERATIONS } from "../shared/telemetry";
import { withBackendSpan } from "../telemetry/sentry";
import {
  type ArchiveCardInput,
  buildExportArchive,
  type FileReader,
} from "./archiveBuilder";
import { computeExpiry } from "./serialize";

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
const ARTIFACT_CONTENT_TYPE = "application/zip";

function r2Config() {
  const { R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } =
    process.env;
  if (!(R2_BUCKET && R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)) {
    throw new Error("R2 environment variables are not configured");
  }
  return {
    bucket: R2_BUCKET,
    endpoint: R2_ENDPOINT,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  };
}

function createS3Client(config: ReturnType<typeof r2Config>): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

/** Build a FileReader that streams original objects directly from R2. */
function createR2FileReader(client: S3Client, bucket: string): FileReader {
  return async (fileKey: string): Promise<Uint8Array | null> => {
    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: fileKey })
      );
      const body = response.Body as
        | { transformToByteArray?: () => Promise<Uint8Array> }
        | undefined;
      if (!body?.transformToByteArray) {
        return null;
      }
      const bytes = await body.transformToByteArray();
      return bytes.byteLength > 0 ? bytes : null;
    } catch {
      // Missing/unreadable object -> let the archive builder omit it.
      return null;
    }
  };
}

function buildArtifactKey(userId: string, jobId: string): string {
  const hashUserId = createHash("sha256")
    .update(userId)
    .digest("hex")
    .slice(0, 16);
  const stamp = new Date().toISOString().slice(0, 10);
  return ["users", hashUserId, "exports", `${jobId}-${stamp}.zip`].join("/");
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

      let config: ReturnType<typeof r2Config>;
      try {
        config = r2Config();
      } catch {
        return { ok: false, failureClass: "storage_failed" };
      }
      const client = createS3Client(config);
      const readFile = createR2FileReader(client, config.bucket);

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

      let result: Awaited<ReturnType<typeof buildExportArchive>>;
      try {
        result = await buildExportArchive({
          inputs,
          readFile,
          createdAtMs,
          expiresAtMs,
        });
      } catch {
        return { ok: false, failureClass: "archive_failed" };
      }

      // Re-check cancellation right before persisting the artifact.
      const canceledAfter = await ctx.runQuery(
        internalAny.dataExport.isCancelRequested,
        {
          jobId,
        }
      );
      if (canceledAfter) {
        return { ok: false, failureClass: "canceled" };
      }

      const artifactKey = buildArtifactKey(userId, jobId);
      const downloadName = `teak-export-${new Date().toISOString().slice(0, 10)}.zip`;
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: artifactKey,
            Body: result.buffer,
            ContentType: ARTIFACT_CONTENT_TYPE,
            ContentDisposition: `attachment; filename="${downloadName}"`,
          })
        );
      } catch {
        return { ok: false, failureClass: "storage_failed" };
      }

      return {
        ok: true,
        artifactKey,
        artifactBytes: result.buffer.byteLength,
        cardCount: result.cardCount,
        filesIncluded: result.filesIncluded,
        filesOmitted: result.filesOmitted,
      };
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
      let config: ReturnType<typeof r2Config>;
      try {
        config = r2Config();
      } catch {
        return { deleted: false };
      }
      const client = createS3Client(config);
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: config.bucket, Key: artifactKey })
        );
        return { deleted: true };
      } catch {
        return { deleted: false };
      }
    }
  ),
});
