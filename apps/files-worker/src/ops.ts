import {
  buildFilesOpSigningPayload,
  FILES_PROCESSOR_VERSION,
  FILES_PROTOCOL_VERSION,
  type FilesErrorCode,
  type FilesOpRequest,
  isFilesOp,
} from "@teak/files-protocol";
import {
  buildExportIntoBucket,
  ExportManifestInvalid,
  ExportTooLarge,
} from "./export";
import { finalizeImageUpload } from "./finalizeImage";
import { analyzeImage } from "./imageAnalysis";
import { generateImageMetadataForOp } from "./imageMetadata";
import {
  extractZipEntries,
  type InspectMode,
  InspectSourceMissing,
  runInspect,
} from "./inspect";
import { sha256Hex, verifyBodySignature } from "./lib";
import { reportFilesOpFailure } from "./sentry";
import { isValidUploadKey } from "./upload";

export interface FilesOpsEnv {
  BUCKET: R2Bucket;
  FILES_SIGNING_SECRET: string;
  /** Images binding; used by finalize-image-upload for decode verification. */
  IMAGES?: ImagesBinding;
}

const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

const fail = (
  requestId: string,
  code: FilesErrorCode,
  message: string,
  status: number,
  retryable = false
): Response =>
  json(
    {
      error: { code, message, requestId, retryable },
      ok: false,
      version: FILES_PROTOCOL_VERSION,
    },
    status
  );

const success = <T>(requestId: string, data: T): Response =>
  json({ data, ok: true, requestId, version: FILES_PROTOCOL_VERSION });

const requiredString = (
  params: Record<string, unknown>,
  key: string
): string => {
  const value = params[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`invalid_${key}`);
  }
  return value;
};

const optionalString = (
  params: Record<string, unknown>,
  key: string
): string | null => {
  const value = params[key];
  return typeof value === "string" && value ? value : null;
};

const sameUserNamespace = (left: string, right: string): boolean => {
  const leftParts = left.split("/");
  const rightParts = right.split("/");
  return (
    leftParts[0] === "users" &&
    rightParts[0] === "users" &&
    leftParts[1] === rightParts[1]
  );
};

const finalizeUpload = async (
  bucket: R2Bucket,
  params: Record<string, unknown>
) => {
  const sourceKey = requiredString(params, "sourceKey");
  const destinationKey = requiredString(params, "destinationKey");
  if (!sameUserNamespace(sourceKey, destinationKey)) {
    throw new Error("invalid_storage_key");
  }
  const source = await bucket.get(sourceKey);
  if (!source) {
    throw new InspectSourceMissing();
  }
  const expectedEtag = optionalString(params, "expectedEtag");
  const expectedSize = params.expectedSize;
  if (
    (expectedEtag && source.httpEtag !== expectedEtag) ||
    (typeof expectedSize === "number" && source.size !== expectedSize)
  ) {
    await source.body.cancel();
    throw new Error("source_changed");
  }
  let content: string | undefined;
  let body: ReadableStream | Uint8Array = source.body;
  if (params.readText === true) {
    const bytes = new Uint8Array(await source.arrayBuffer());
    body = bytes;
    try {
      content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
    } catch {
      throw new Error("invalid_utf8");
    }
  }
  const stored = await bucket.put(destinationKey, body, {
    httpMetadata: source.httpMetadata,
    customMetadata: {
      ...source.customMetadata,
      processorVersion: FILES_PROCESSOR_VERSION,
      sourceEtag: source.httpEtag,
    },
  });
  return {
    content,
    destinationKey,
    sourceEtag: source.httpEtag,
    storedEtag: stored.httpEtag,
    storedFileSize: source.size,
    storedMimeType: source.httpMetadata?.contentType,
  };
};

const validKeyList = (value: unknown): string[] => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 100 ||
    value.some((key) => typeof key !== "string" || !isValidUploadKey(key))
  ) {
    throw new Error("invalid_keys");
  }
  // Object keys are immutable per-card paths; reject duplicates so a single
  // batch never double-deletes across namespaces.
  return Array.from(new Set(value as string[]));
};

const dispatch = async (
  env: FilesOpsEnv,
  requestId: string,
  body: FilesOpRequest,
  origin: string
): Promise<Response> => {
  const params = (body.params ?? {}) as Record<string, unknown>;
  switch (body.op) {
    case "analyze-image":
    case "analyze-image-content":
      return success(
        requestId,
        await analyzeImage(env, requiredString(params, "sourceKey"), origin)
      );
    case "inspect": {
      const maxBytes = params.maxBytes;
      const mode = requiredString(params, "mode");
      if (
        !["css", "text", "zip"].includes(mode) ||
        typeof maxBytes !== "number" ||
        !Number.isSafeInteger(maxBytes) ||
        maxBytes <= 0 ||
        maxBytes > 64 * 1024 * 1024
      ) {
        throw new Error("invalid_inspect_params");
      }
      return success(
        requestId,
        await runInspect(
          env.BUCKET,
          requiredString(params, "sourceKey"),
          mode as InspectMode,
          optionalString(params, "formatId") ?? "",
          maxBytes,
          params.rtf === true
        )
      );
    }
    case "build-export":
      return success(
        requestId,
        await buildExportIntoBucket(
          env.BUCKET,
          requiredString(params, "manifestKey"),
          requiredString(params, "artifactKey"),
          requiredString(params, "fileName")
        )
      );
    case "create-multipart": {
      const upload = await env.BUCKET.createMultipartUpload(
        requiredString(params, "key"),
        {
          httpMetadata: {
            contentType:
              optionalString(params, "contentType") ??
              "application/octet-stream",
          },
        }
      );
      return success(requestId, { key: upload.key, uploadId: upload.uploadId });
    }
    case "complete-multipart": {
      const parts = params.parts;
      const expectedSize = params.expectedSize;
      if (
        !Array.isArray(parts) ||
        parts.length === 0 ||
        parts.length > 100 ||
        typeof expectedSize !== "number" ||
        !Number.isSafeInteger(expectedSize) ||
        expectedSize < 0
      ) {
        throw new Error("invalid_parts");
      }
      const existing = await env.BUCKET.head(requiredString(params, "key"));
      if (existing) {
        if (existing.size !== expectedSize) {
          throw new Error("source_changed");
        }
        return success(requestId, {
          etag: existing.httpEtag,
          key: existing.key,
          size: existing.size,
        });
      }
      const upload = env.BUCKET.resumeMultipartUpload(
        requiredString(params, "key"),
        requiredString(params, "uploadId")
      );
      const object = await upload.complete(
        parts.map((part) => {
          const value = part as Record<string, unknown>;
          if (
            typeof value.partNumber !== "number" ||
            typeof value.etag !== "string"
          ) {
            throw new Error("invalid_part");
          }
          return { partNumber: value.partNumber, etag: value.etag };
        })
      );
      return success(requestId, {
        etag: object.httpEtag,
        key: object.key,
        size: object.size,
      });
    }
    case "abort-multipart":
      await env.BUCKET.resumeMultipartUpload(
        requiredString(params, "key"),
        requiredString(params, "uploadId")
      ).abort();
      return success(requestId, { aborted: true });
    case "finalize-upload":
      return success(requestId, await finalizeUpload(env.BUCKET, params));
    case "finalize-image-upload": {
      const sourceKey = requiredString(params, "sourceKey");
      const destinationKey = requiredString(params, "destinationKey");
      if (!sameUserNamespace(sourceKey, destinationKey)) {
        throw new Error("invalid_storage_key");
      }
      return success(requestId, await finalizeImageUpload(env, params, origin));
    }
    case "delete-object":
      await env.BUCKET.delete(requiredString(params, "key"));
      return success(requestId, { deleted: true });
    case "delete-objects": {
      const keys = validKeyList(params.keys);
      // R2 treats missing objects as success for batch deletes.
      await env.BUCKET.delete(keys);
      return success(requestId, { deleted: keys.length });
    }
    case "head-object": {
      const key = requiredString(params, "key");
      if (!isValidUploadKey(key)) {
        throw new Error("invalid_storage_key");
      }
      const object = await env.BUCKET.head(key);
      if (!object) {
        return success(requestId, { exists: false });
      }
      return success(requestId, {
        contentType: object.httpMetadata?.contentType,
        etag: object.httpEtag,
        exists: true,
        size: object.size,
      });
    }
    case "list-objects": {
      const prefix = requiredString(params, "prefix");
      if (!prefix.startsWith("users/") || prefix.includes("\\0")) {
        throw new Error("invalid_prefix");
      }
      const limit = params.limit;
      if (
        limit !== undefined &&
        (typeof limit !== "number" ||
          !Number.isSafeInteger(limit) ||
          limit <= 0 ||
          limit > 1000)
      ) {
        throw new Error("invalid_limit");
      }
      const cursor = optionalString(params, "cursor");
      const listed = await env.BUCKET.list({
        prefix,
        ...(cursor ? { cursor } : {}),
        ...(limit ? { limit } : {}),
      });
      return success(requestId, {
        cursor: listed.truncated ? (listed.cursor ?? null) : null,
        objects: listed.objects.map((object) => ({
          key: object.key,
          lastModified: object.uploaded.getTime(),
          size: object.size,
        })),
        truncated: listed.truncated,
      });
    }
    case "generate-image-metadata": {
      const title = optionalString(params, "title");
      if (title !== null && title.length > 2000) {
        throw new Error("invalid_title");
      }
      return success(
        requestId,
        await generateImageMetadataForOp(env, {
          origin,
          sourceKey: requiredString(params, "sourceKey"),
          title,
        })
      );
    }
    case "extract-import-files": {
      if (!Array.isArray(params.entries)) {
        throw new Error("invalid_entries");
      }
      return success(
        requestId,
        await extractZipEntries(
          env.BUCKET,
          requiredString(params, "archiveKey"),
          params.entries as never
        )
      );
    }
    default:
      throw new Error("invalid_operation");
  }
};

export const handleInternalOp = async (
  request: Request,
  env: FilesOpsEnv
): Promise<Response> => {
  const requestId = request.headers.get("x-teak-request-id") ?? "unknown";
  const rawBody = await request.text();
  const bodySha256 = await sha256Hex(rawBody);
  const verification = await verifyBodySignature(
    env.FILES_SIGNING_SECRET,
    {
      bodySha256,
      expiresAt: request.headers.get("x-teak-expires-at"),
      requestId,
      signature: request.headers.get("x-teak-signature"),
    },
    buildFilesOpSigningPayload
  );
  if (!verification.ok) {
    return fail(
      requestId,
      verification.status === 410 ? "AUTH_EXPIRED" : "AUTH_INVALID",
      "Request authentication failed",
      verification.status
    );
  }
  let body: FilesOpRequest;
  try {
    body = JSON.parse(rawBody) as FilesOpRequest;
  } catch {
    return fail(requestId, "INVALID_INPUT", "Invalid JSON body", 400);
  }
  if (body.version !== FILES_PROTOCOL_VERSION || !isFilesOp(body.op)) {
    return fail(requestId, "UNSUPPORTED", "Unsupported operation", 400);
  }
  try {
    return await dispatch(env, requestId, body, new URL(request.url).origin);
  } catch (error) {
    if (
      (error instanceof Error && error.message === "source_not_found") ||
      error instanceof InspectSourceMissing
    ) {
      return fail(requestId, "NOT_FOUND", error.message, 404);
    }
    if (
      (error instanceof Error && error.message === "source_too_large") ||
      error instanceof ExportTooLarge
    ) {
      return fail(requestId, "PAYLOAD_TOO_LARGE", error.message, 413);
    }
    if (
      error instanceof Error &&
      [
        "image_transform_failed",
        "image_dimensions_missing",
        "not_an_image",
        "image_dimensions_too_large",
      ].includes(error.message)
    ) {
      return fail(requestId, "UNSUPPORTED", error.message, 415);
    }
    if (error instanceof ExportManifestInvalid) {
      return fail(requestId, "INVALID_INPUT", error.message, 400);
    }
    const message = error instanceof Error ? error.message : "internal_error";
    if (message.startsWith("invalid_") || message === "archive_parse_failed") {
      return fail(requestId, "INVALID_INPUT", message, 400);
    }
    if (message === "source_changed") {
      return fail(requestId, "CONFLICT", message, 409);
    }
    console.error("[files-worker] operation failed", { error, requestId });
    reportFilesOpFailure(body.op, error, {
      httpMethod: request.method,
      httpPath: "/__ops/v1",
      objectKey: "",
    });
    return fail(requestId, "INTERNAL", "Internal operation failed", 500, true);
  }
};
