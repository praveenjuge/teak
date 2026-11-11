import {
  FILES_MULTIPART_MAX_PARTS,
  FILES_PENDING_UPLOAD_STALE_AFTER_MS,
  FILES_PROCESSOR_VERSION,
  FILES_USER_KEY_ROOTS,
  isPendingUploadKey,
  isSameUserNamespace,
  isValidObjectKey,
  MAX_DISPATCH_DELETE_KEYS,
} from "@teak/files-protocol";
import { freezeObject } from "../deletionGate";
import { InvalidOpInput, OpFailure } from "../opFailure";
import {
  objectKeyParam,
  optionalString,
  type RawOpParams,
  requiredString,
} from "../opParams";
import type { FilesOpResult } from "../opSpecs";
import type { FilesOpsEnv } from "../ops";
import { isMissingMultipartUpload } from "./missingMultipartUpload";

const CLEANUP_LIST_PAGE_SIZE = 1000;
const CLEANUP_MAX_PAGES = 10;
const CLEANUP_DELETE_BATCH_SIZE = 100;

/** Two keys in the same user's folder. */
const sameUserKeys = (params: RawOpParams) => {
  const sourceKey = objectKeyParam(params, "sourceKey");
  const destinationKey = objectKeyParam(params, "destinationKey");
  if (!isSameUserNamespace(sourceKey, destinationKey)) {
    throw new InvalidOpInput("invalid_storage_key");
  }
  return { destinationKey, sourceKey };
};

const keyList = (value: unknown): string[] => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_DISPATCH_DELETE_KEYS ||
    value.some((key) => typeof key !== "string" || !isValidObjectKey(key))
  ) {
    throw new InvalidOpInput("invalid_keys");
  }
  return Array.from(new Set(value as string[]));
};

export const createMultipart = async (
  env: FilesOpsEnv,
  params: RawOpParams
): Promise<FilesOpResult<"create-multipart">> => {
  const upload = await env.BUCKET.createMultipartUpload(
    objectKeyParam(params),
    {
      httpMetadata: {
        contentType:
          optionalString(params, "contentType") ?? "application/octet-stream",
      },
    }
  );
  return { key: upload.key, uploadId: upload.uploadId };
};

export const completeMultipart = async (
  env: FilesOpsEnv,
  params: RawOpParams
): Promise<FilesOpResult<"complete-multipart">> => {
  const { parts, expectedSize } = params;
  if (
    !Array.isArray(parts) ||
    parts.length === 0 ||
    parts.length > FILES_MULTIPART_MAX_PARTS ||
    typeof expectedSize !== "number" ||
    !Number.isSafeInteger(expectedSize) ||
    expectedSize < 0
  ) {
    throw new InvalidOpInput("invalid_parts");
  }
  const key = objectKeyParam(params);
  const existing = await env.BUCKET.head(key);
  if (existing) {
    if (existing.size !== expectedSize) {
      throw new OpFailure("source_changed");
    }
    return { etag: existing.httpEtag, key: existing.key, size: existing.size };
  }
  const upload = env.BUCKET.resumeMultipartUpload(
    key,
    requiredString(params, "uploadId")
  );
  const object = await upload.complete(
    parts.map((part) => {
      const value = part as Record<string, unknown>;
      if (
        typeof value.partNumber !== "number" ||
        typeof value.etag !== "string"
      ) {
        throw new InvalidOpInput("invalid_part");
      }
      return { partNumber: value.partNumber, etag: value.etag };
    })
  );
  return { etag: object.httpEtag, key: object.key, size: object.size };
};

export const abortMultipart = async (
  env: FilesOpsEnv,
  params: RawOpParams
): Promise<FilesOpResult<"abort-multipart">> => {
  const key = objectKeyParam(params);
  try {
    await env.BUCKET.resumeMultipartUpload(
      key,
      requiredString(params, "uploadId")
    ).abort();
  } catch (error) {
    if (!isMissingMultipartUpload(error)) {
      throw error;
    }
  }
  return { aborted: true };
};

export const freezeObjectOp = async (
  env: FilesOpsEnv,
  params: RawOpParams
): Promise<FilesOpResult<"freeze-object">> => ({
  frozen: await freezeObject(env, objectKeyParam(params)),
});

export const finalizeUpload = async (
  env: FilesOpsEnv,
  params: RawOpParams
): Promise<FilesOpResult<"finalize-upload">> => {
  const { destinationKey, sourceKey } = sameUserKeys(params);
  const source = await env.BUCKET.get(sourceKey);
  if (!source) {
    throw new OpFailure("source_not_found");
  }
  const expectedEtag = optionalString(params, "expectedEtag");
  const expectedSize = params.expectedSize;
  if (
    (expectedEtag && source.httpEtag !== expectedEtag) ||
    (typeof expectedSize === "number" && source.size !== expectedSize)
  ) {
    await source.body.cancel();
    throw new OpFailure("source_changed");
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
      throw new InvalidOpInput("invalid_utf8");
    }
  }
  const stored = await env.BUCKET.put(destinationKey, body, {
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

export const finalizeImageKeys = sameUserKeys;

export const cleanupStalePendingUploads = async (
  env: FilesOpsEnv,
  params: RawOpParams
): Promise<FilesOpResult<"cleanup-stale-pending-uploads">> => {
  const prefix = requiredString(params, "prefix");
  if (!(FILES_USER_KEY_ROOTS as readonly string[]).includes(prefix)) {
    throw new InvalidOpInput("invalid_cleanup_params");
  }
  let cursor = optionalString(params, "cursor");
  let deleted = 0;
  let pages = 0;
  const staleBefore = Date.now() - FILES_PENDING_UPLOAD_STALE_AFTER_MS;
  do {
    const listed = await env.BUCKET.list({
      prefix,
      ...(cursor ? { cursor } : {}),
      limit: CLEANUP_LIST_PAGE_SIZE,
    });
    const staleKeys = listed.objects.flatMap((object) =>
      isPendingUploadKey(object.key) && object.uploaded.getTime() <= staleBefore
        ? [object.key]
        : []
    );
    for (
      let index = 0;
      index < staleKeys.length;
      index += CLEANUP_DELETE_BATCH_SIZE
    ) {
      await env.BUCKET.delete(
        staleKeys.slice(index, index + CLEANUP_DELETE_BATCH_SIZE)
      );
    }
    deleted += staleKeys.length;
    pages += 1;
    cursor = listed.truncated ? (listed.cursor ?? null) : null;
  } while (cursor && pages < CLEANUP_MAX_PAGES);
  return { cursor, deleted, pages };
};

export const deleteObject = async (
  env: FilesOpsEnv,
  params: RawOpParams
): Promise<FilesOpResult<"delete-object">> => {
  await env.BUCKET.delete(objectKeyParam(params));
  return { deleted: true };
};

export const deleteObjects = async (
  env: FilesOpsEnv,
  params: RawOpParams
): Promise<FilesOpResult<"delete-objects">> => {
  const keys = keyList(params.keys);
  // R2 treats missing objects as success for batch deletes.
  await env.BUCKET.delete(keys);
  return { deleted: keys.length };
};

export const headObject = async (
  env: FilesOpsEnv,
  params: RawOpParams
): Promise<FilesOpResult<"head-object">> => {
  const object = await env.BUCKET.head(objectKeyParam(params));
  if (!object) {
    return { exists: false };
  }
  return {
    contentType: object.httpMetadata?.contentType,
    etag: object.httpEtag,
    exists: true,
    size: object.size,
  };
};

export const listObjects = async (
  env: FilesOpsEnv,
  params: RawOpParams
): Promise<FilesOpResult<"list-objects">> => {
  const prefix = requiredString(params, "prefix");
  if (
    !FILES_USER_KEY_ROOTS.some((root) => prefix.startsWith(root)) ||
    prefix.includes("\0")
  ) {
    throw new InvalidOpInput("invalid_prefix");
  }
  const limit = params.limit;
  if (
    limit !== undefined &&
    (typeof limit !== "number" ||
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      limit > 1000)
  ) {
    throw new InvalidOpInput("invalid_limit");
  }
  const cursor = optionalString(params, "cursor");
  const listed = await env.BUCKET.list({
    prefix,
    ...(cursor ? { cursor } : {}),
    ...(limit ? { limit } : {}),
  });
  return {
    cursor: listed.truncated ? (listed.cursor ?? null) : null,
    objects: listed.objects.map((object) => ({
      key: object.key,
      lastModified: object.uploaded.getTime(),
      size: object.size,
    })),
    truncated: listed.truncated,
  };
};
