import {
  decodeMarkdownUtf8,
  MARKDOWN_CONTENT_MAX_BYTES,
  MarkdownContentError,
} from "@teak/files-core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { callFilesWorkerJson } from "./storage/filesWorkerClient";
import { buildR2UserPrefix, getR2Url } from "./storage/r2";
import { assertR2KeyInNamespace } from "./storage/r2Keys";

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
    message?: string;
  };
  const message = typeof value?.message === "string" ? value.message : "";
  if (
    message.includes("missing_object") ||
    message.includes("files_worker_error:NOT_FOUND")
  ) {
    return failure("missing_object", false);
  }
  if (message.includes("concurrently_changed")) {
    return failure("concurrently_changed", false);
  }
  return failure("storage_unavailable", true);
}

export interface MigrationStorage {
  headObject: (key: string) => Promise<{
    etag?: string;
    size?: number;
  } | null>;
  readObject: (key: string) => Promise<{
    bytes: Uint8Array;
    etag?: string;
  } | null>;
}

const workerStorage: MigrationStorage = {
  headObject: async (key) => {
    const outcome = await callFilesWorkerJson({
      op: "head-object",
      params: { key },
    });
    if (outcome.kind !== "ok" || !outcome.data.exists) {
      return null;
    }
    return { etag: outcome.data.etag, size: outcome.data.size };
  },
  readObject: async (key) => {
    const url = await getR2Url(key);
    const response = await fetch(url);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`migration_read_failed:${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    return {
      bytes: new Uint8Array(buffer),
      etag: response.headers.get("etag") ?? undefined,
    };
  },
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

export async function processAuditHandler(
  ctx: any,
  { auditId, claimedAt }: { auditId: string; claimedAt: number },
  storage: MigrationStorage = workerStorage
) {
  const audit = await ctx.runQuery(
    (internal as any).markdownDocumentMigration.getAuditSnapshot,
    { auditId }
  );
  if (audit?.status !== "in_progress" || audit.updatedAt !== claimedAt) {
    return null;
  }

  let conversionFailure: MigrationFailure | undefined;
  if (audit.sourceFileKey?.startsWith(`${buildR2UserPrefix(audit.userId)}/`)) {
    try {
      assertR2KeyInNamespace(audit.sourceFileKey);
    } catch {
      conversionFailure = failure("ownership_invalid", false);
    }
  } else {
    conversionFailure = failure("ownership_invalid", false);
  }

  let sourceEtag: string | undefined;
  let sourceByteSize: number | undefined;
  let content: string | undefined;
  let sourceChecksum: string | undefined;

  if (!conversionFailure) {
    try {
      const head = await storage.headObject(audit.sourceFileKey);
      sourceEtag = head?.etag;
      sourceByteSize = head?.size;
      if (!(head && sourceEtag && typeof sourceByteSize === "number")) {
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
        const object = await storage.readObject(audit.sourceFileKey);
        if (!object) {
          throw new Error("missing_object");
        }
        if (
          object.etag !== sourceEtag ||
          object.bytes.byteLength !== sourceByteSize
        ) {
          conversionFailure = failure("concurrently_changed", false, {
            sourceByteSize,
            sourceEtag,
          });
        } else {
          content = decodeMarkdownUtf8(object.bytes);
          sourceChecksum = await sha256Hex(object.bytes);
          const verified = await storage.headObject(audit.sourceFileKey);
          if (
            verified?.etag !== sourceEtag ||
            verified?.size !== sourceByteSize
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
