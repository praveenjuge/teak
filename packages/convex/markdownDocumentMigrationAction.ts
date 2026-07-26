"use node";

import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  decodeMarkdownUtf8,
  MARKDOWN_CONTENT_MAX_BYTES,
  MarkdownContentError,
} from "./shared/markdown";
import { buildR2UserPrefix, r2ComponentConfig } from "./storage/r2";

interface MigrationFailure {
  reason: string;
  retryable: boolean;
  sourceByteSize?: number;
  sourceEtag?: string;
}

const failure = (
  reason: string,
  retryable: boolean,
  details: Pick<MigrationFailure, "sourceByteSize" | "sourceEtag"> = {}
): MigrationFailure => ({ reason, retryable, ...details });

export function classifyStorageError(error: unknown): MigrationFailure {
  const value = error as {
    $metadata?: { httpStatusCode?: number };
    name?: string;
  };
  if (value?.$metadata?.httpStatusCode === 404) {
    return failure("missing_object", false);
  }
  if (
    value?.name === "PreconditionFailed" ||
    value?.$metadata?.httpStatusCode === 412
  ) {
    return failure("concurrently_changed", false);
  }
  return failure("storage_unavailable", true);
}

const createClient = () => {
  const config = r2ComponentConfig();
  return {
    bucket: config.bucket,
    client: new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint: config.endpoint,
      forcePathStyle: true,
      region: "auto",
      requestChecksumCalculation: "WHEN_REQUIRED",
    }),
  };
};

export async function processAuditHandler(
  ctx: any,
  { auditId, claimedAt }: { auditId: string; claimedAt: number },
  storage = createClient()
) {
  const audit = await ctx.runQuery(
    (internal as any).markdownDocumentMigration.getAuditSnapshot,
    { auditId }
  );
  if (audit?.status !== "in_progress" || audit.updatedAt !== claimedAt) {
    return null;
  }

  let conversionFailure: MigrationFailure | undefined;
  if (!audit.sourceFileKey?.startsWith(`${buildR2UserPrefix(audit.userId)}/`)) {
    conversionFailure = failure("ownership_invalid", false);
  }

  const { bucket, client } = storage;
  let sourceEtag: string | undefined;
  let sourceByteSize: number | undefined;
  let content: string | undefined;
  let sourceChecksum: string | undefined;

  if (!conversionFailure) {
    try {
      const head = await client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: audit.sourceFileKey,
        })
      );
      sourceEtag = head.ETag;
      sourceByteSize = head.ContentLength;
      if (!(sourceEtag && typeof sourceByteSize === "number")) {
        conversionFailure = failure("metadata_unavailable", true);
      } else if (sourceByteSize > MARKDOWN_CONTENT_MAX_BYTES) {
        conversionFailure = failure("content_too_large", false, {
          sourceByteSize,
          sourceEtag,
        });
      } else if (
        audit.sourceEtag !== undefined &&
        audit.sourceEtag !== sourceEtag
      ) {
        conversionFailure = failure("concurrently_changed", false, {
          sourceByteSize,
          sourceEtag,
        });
      } else {
        const object = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: audit.sourceFileKey,
            IfMatch: sourceEtag,
          })
        );
        const bytes = await object.Body?.transformToByteArray();
        if (
          !bytes ||
          object.ETag !== sourceEtag ||
          bytes.byteLength !== sourceByteSize
        ) {
          conversionFailure = failure("concurrently_changed", false, {
            sourceByteSize,
            sourceEtag,
          });
        } else {
          content = decodeMarkdownUtf8(bytes);
          sourceChecksum = createHash("sha256").update(bytes).digest("hex");
          const verified = await client.send(
            new HeadObjectCommand({
              Bucket: bucket,
              Key: audit.sourceFileKey,
            })
          );
          if (
            verified.ETag !== sourceEtag ||
            verified.ContentLength !== sourceByteSize
          ) {
            conversionFailure = failure("concurrently_changed", false, {
              sourceByteSize,
              sourceEtag,
            });
          }
        }
      }
    } catch (error) {
      conversionFailure =
        error instanceof MarkdownContentError
          ? failure(
              error.code === "INVALID_UTF8"
                ? "invalid_utf8"
                : "content_too_large",
              false,
              { sourceByteSize, sourceEtag }
            )
          : {
              ...classifyStorageError(error),
              sourceByteSize,
              sourceEtag,
            };
    }
  }

  if (conversionFailure || content === undefined || !sourceChecksum) {
    const result = conversionFailure ?? failure("source_unreadable", true);
    await ctx.runMutation(
      (internal as any).markdownDocumentMigration.recordFailure,
      {
        auditId,
        failureReason: result.reason,
        retryable: result.retryable,
        sourceByteSize: result.sourceByteSize,
        sourceEtag: result.sourceEtag,
        claimedAt,
        expectedAttempt: audit.attempts,
      }
    );
    return null;
  }

  const completed = await ctx.runMutation(
    (internal as any).markdownDocumentMigration.completeConversion,
    {
      auditId,
      content,
      sourceByteSize,
      sourceChecksum,
      sourceEtag,
      verifiedEtag: sourceEtag,
      claimedAt,
      expectedAttempt: audit.attempts,
    }
  );
  if (!completed.converted) {
    await ctx.runMutation(
      (internal as any).markdownDocumentMigration.recordFailure,
      {
        auditId,
        failureReason: completed.failureReason ?? "concurrently_changed",
        retryable: false,
        sourceByteSize,
        sourceEtag,
        claimedAt,
        expectedAttempt: audit.attempts,
      }
    );
  }
  return null;
}

export const processAudit = internalAction({
  args: {
    auditId: v.id("markdownConversionAudits"),
    claimedAt: v.number(),
  },
  returns: v.null(),
  handler: (ctx, { auditId, claimedAt }) =>
    processAuditHandler(ctx, { auditId, claimedAt }),
});
