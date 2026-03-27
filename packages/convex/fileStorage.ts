import { R2 } from "@convex-dev/r2";
import { components } from "./_generated/api";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import {
  isR2StorageRef,
  type StorageRef,
  toR2ObjectKey,
  toR2StorageRef,
} from "./storageRefs";

const FILE_URL_EXPIRES_IN_SECONDS = 60 * 60;

const r2 = new R2(components.r2);

const hasR2Config = () =>
  Boolean(
    process.env.R2_BUCKET &&
      process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY
  );

const toBlob = (file: Uint8Array | Buffer | Blob, type?: string) => {
  if (file instanceof Blob) {
    return file;
  }

  const bytes = file as Uint8Array;
  const arrayBuffer =
    bytes.buffer instanceof ArrayBuffer
      ? bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          )
      : bytes.slice().buffer;

  return new Blob([arrayBuffer], { type: type ?? undefined });
};

const sanitizePathSegment = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "file";

const getFileExtension = (fileName?: string) => {
  if (!fileName) {
    return "";
  }

  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex === -1 || lastDotIndex === fileName.length - 1) {
    return "";
  }

  return fileName
    .slice(lastDotIndex)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "");
};

export const getStorageDeploymentPrefix = () =>
  process.env.NODE_ENV === "production" ? "prod" : "dev";

export const isR2Configured = () => hasR2Config();

export const buildR2ObjectKey = ({
  kind,
  userId,
  fileName,
}: {
  kind:
    | "uploads"
    | "thumbnails"
    | "screenshots"
    | "link-previews"
    | "media"
    | "posters"
    | "migrations";
  userId?: string;
  fileName?: string;
}) => {
  const prefix = getStorageDeploymentPrefix();
  const safeUserId = userId ? sanitizePathSegment(userId) : "system";
  const extension = getFileExtension(fileName);
  return `${prefix}/${kind}/${safeUserId}/${crypto.randomUUID()}${extension}`;
};

export const prepareR2Upload = async ({
  fileName,
  userId,
}: {
  fileName?: string;
  userId?: string;
}) => {
  if (!hasR2Config()) {
    throw new Error("R2 is not configured for uploads");
  }

  const key = buildR2ObjectKey({
    kind: "uploads",
    userId,
    fileName,
  });
  const upload = await r2.generateUploadUrl(key);
  return {
    fileRef: toR2StorageRef(upload.key),
    uploadUrl: upload.url,
  };
};

export const getStorageUrl = async (
  ctx: Pick<QueryCtx | ActionCtx | MutationCtx, "storage">,
  ref: StorageRef | null | undefined,
  options: { expiresIn?: number } = {}
) => {
  if (!ref) {
    return null;
  }

  if (isR2StorageRef(ref)) {
    return r2.getUrl(toR2ObjectKey(ref), {
      expiresIn: options.expiresIn ?? FILE_URL_EXPIRES_IN_SECONDS,
    });
  }

  return ctx.storage.getUrl(ref as any);
};

export const syncStorageMetadata = async (
  ctx: ActionCtx,
  ref: StorageRef | null | undefined
) => {
  if (!(ref && isR2StorageRef(ref) && hasR2Config())) {
    return;
  }

  await r2.syncMetadata(ctx, toR2ObjectKey(ref));
};

export const deleteStorageObject = async (
  ctx: MutationCtx,
  ref: StorageRef | null | undefined
) => {
  if (!ref) {
    return;
  }

  if (isR2StorageRef(ref)) {
    await r2.deleteObject(ctx, toR2ObjectKey(ref));
    return;
  }

  await ctx.storage.delete(ref as any);
};

export const storeBlobInR2 = async (
  ctx: ActionCtx,
  file: Uint8Array | Buffer | Blob,
  {
    key,
    fileName,
    kind,
    type,
    userId,
    cacheControl,
    disposition,
  }: {
    key?: string;
    fileName?: string;
    kind:
      | "uploads"
      | "thumbnails"
      | "screenshots"
      | "link-previews"
      | "media"
      | "posters"
      | "migrations";
    type?: string;
    userId?: string;
    cacheControl?: string;
    disposition?: string;
  }
) => {
  if (!hasR2Config()) {
    const storedId = await (ctx.storage as any).store(toBlob(file, type));
    return storedId as string;
  }

  const objectKey =
    key ??
    buildR2ObjectKey({
      kind,
      userId,
      fileName,
    });

  await r2.store(ctx, file, {
    key: objectKey,
    ...(type ? { type } : {}),
    ...(cacheControl ? { cacheControl } : {}),
    ...(disposition ? { disposition } : {}),
  });

  return toR2StorageRef(objectKey);
};

export const getUploadMetadataFromArgs = ({
  fileName,
  fileSize,
  fileType,
  additionalMetadata,
}: {
  fileName: string;
  fileSize: number;
  fileType: string;
  additionalMetadata?: Record<string, unknown>;
}) => {
  const extra = additionalMetadata as
    | {
        recordingTimestamp?: number;
        duration?: number;
        width?: number;
        height?: number;
      }
    | undefined;

  const metadata = {
    fileName,
    fileSize,
    mimeType: fileType,
  } as {
    fileName: string;
    fileSize: number;
    mimeType: string;
    recordingTimestamp?: number;
    duration?: number;
    width?: number;
    height?: number;
  };

  if (extra?.recordingTimestamp !== undefined) {
    metadata.recordingTimestamp = extra.recordingTimestamp;
  }
  if (extra?.duration !== undefined) {
    metadata.duration = extra.duration;
  }
  if (extra?.width !== undefined) {
    metadata.width = extra.width;
  }
  if (extra?.height !== undefined) {
    metadata.height = extra.height;
  }

  return metadata;
};
