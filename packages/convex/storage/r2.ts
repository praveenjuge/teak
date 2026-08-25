import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { R2 } from "@convex-dev/r2";
import {
  buildImageSigningPayload,
  FILES_IMAGE_PATH,
  type FilesImageRendition,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { components } from "../_generated/api";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { internalMutation, mutation, query } from "../_generated/server";
import { inferFileFormat } from "../shared/fileFormats";

// Object keys are content-immutable (every upload writes a fresh UUID key), so
// signed URLs can live far longer than a single session. Long-lived,
// time-bucketed URLs keep the URL string identical across reactive query
// re-runs and page loads, which is what lets the browser HTTP cache actually
// serve repeat views instead of refetching every card image.
const SIGNED_URL_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60; // SigV4 presign cap: 7 days.
// All signatures produced within one bucket window share the same exp (and
// therefore the exact same URL). Buckets also guarantee a minimum remaining
// validity of SIGNED_URL_EXPIRES_IN_SECONDS at generation time.
const SIGNED_URL_BUCKET_SECONDS = 6 * 60 * 60;

// Must stay below the signed-URL minimum remaining validity above; keep in
// lockstep between PRIVATE_FILE_CACHE_CONTROL here (browser-facing) and
// FILES_CACHE_CONTROL / FILES_EDGE_CACHE_CONTROL in apps/files-worker/src/lib.ts.
const PRIVATE_FILE_CACHE_CONTROL = "private, max-age=518400, immutable"; // 6 days.

/**
 * Deterministic expiry for the current bucket window: every call made within
 * the same window returns an identical exp string.
 */
export const bucketedSignatureExpiry = (
  nowSeconds = Math.floor(Date.now() / 1000)
): number =>
  (Math.floor(nowSeconds / SIGNED_URL_BUCKET_SECONDS) + 1) *
    SIGNED_URL_BUCKET_SECONDS +
  SIGNED_URL_EXPIRES_IN_SECONDS;

// Best-effort memo for the presigned-S3 fallback path (no worker proxy
// configured): re-signing on every query execution churns the URL string and
// defeats the browser cache even within a single isolate lifetime. Keyed by
// object key + response policy, evicted shortly before expiry.
const presignedUrlMemo = new Map<string, { url: string; refreshAt: number }>();
const PRESIGN_REFRESH_MARGIN_SECONDS = 15 * 60;

export const r2 = new R2(components.r2);

let downloadClient: S3Client | null = null;

// Build the download client lazily (on first signed-URL request) rather than at
// module load, reusing the same R2 config the component resolves from env vars.
const getDownloadClient = (): S3Client => {
  if (!downloadClient) {
    downloadClient = new S3Client({
      credentials: {
        accessKeyId: r2.config.accessKeyId,
        secretAccessKey: r2.config.secretAccessKey,
      },
      endpoint: r2.config.endpoint,
      region: "auto",
    });
  }
  return downloadClient;
};

export type R2ObjectKey = string;
export const PENDING_UPLOAD_CARD_ID = "upload-pending-v2";

interface DownloadResponsePolicy {
  contentDisposition?: "attachment" | "inline";
  contentType?: string;
}

export const fileDownloadResponsePolicy = (
  fileName: string | null
): Required<DownloadResponsePolicy> => {
  const format = fileName ? inferFileFormat({ fileName }) : null;
  if (!format) {
    return {
      contentDisposition: "attachment",
      contentType: "application/octet-stream",
    };
  }

  const canRenderInline =
    format.id !== "svg" &&
    (format.id === "pdf" ||
      ["audio", "image", "video"].includes(format.cardType));

  return {
    contentDisposition: canRenderInline ? "inline" : "attachment",
    contentType: format.mimeType,
  };
};

const hashUserId = (userId: string) =>
  Array.from(new TextEncoder().encode(userId))
    .reduce((hash, byte) => (hash * 31 + byte) >>> 0, 0)
    .toString(36);

export const buildR2UserPrefix = (userId: string) =>
  ["users", hashUserId(userId), "cards"].join("/");

export const buildR2ObjectKey = ({
  userId,
  cardId,
  role,
  fileName,
}: {
  userId: string;
  cardId?: string;
  role: string;
  fileName?: string;
}) => {
  const safeName = fileName?.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
  return [
    buildR2UserPrefix(userId),
    cardId ?? "pending",
    role,
    `${crypto.randomUUID()}${safeName ? `-${safeName}` : ""}`,
  ].join("/");
};

export const buildR2DownloadCommand = (
  key: string,
  bucket = r2.config.bucket,
  response: DownloadResponsePolicy = {}
) =>
  new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseCacheControl: PRIVATE_FILE_CACHE_CONTROL,
    ResponseContentDisposition: response.contentDisposition,
    ResponseContentType: response.contentType,
  });

export const getR2Url = async (
  key: string,
  response: DownloadResponsePolicy = {}
) => {
  const filesBase = process.env.FILES_BASE;
  const signingSecret = process.env.FILES_SIGNING_SECRET;
  if (filesBase && signingSecret) {
    return await buildSignedWorkerFileUrl(
      filesBase,
      signingSecret,
      key,
      response,
      bucketedSignatureExpiry()
    );
  }
  const memoKey = [
    key,
    response.contentType ?? "",
    response.contentDisposition ?? "",
  ].join("\n");
  const nowSeconds = Math.floor(Date.now() / 1000);
  const memoized = presignedUrlMemo.get(memoKey);
  if (memoized && memoized.refreshAt > nowSeconds) {
    return memoized.url;
  }
  const url = await getSignedUrl(
    getDownloadClient(),
    buildR2DownloadCommand(key, undefined, response),
    {
      expiresIn: SIGNED_URL_EXPIRES_IN_SECONDS,
    }
  );
  presignedUrlMemo.set(memoKey, {
    url,
    refreshAt:
      nowSeconds +
      SIGNED_URL_EXPIRES_IN_SECONDS -
      PRESIGN_REFRESH_MARGIN_SECONDS,
  });
  return url;
};

const hexEncode = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

// Must stay in lockstep with apps/files-worker/src/lib.ts — the shared test
// vectors prove both runtimes produce identical HMAC output.
export const hmacSha256Hex = async (
  secret: string,
  message: string
): Promise<string> => {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return hexEncode(
    await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message))
  );
};

// Must stay in lockstep with apps/files-worker/src/lib.ts — the shared test
// vector proves both runtimes produce identical HMAC output.
export const buildSignedFilePayload = ({
  key,
  exp,
  contentType = "",
  contentDisposition = "",
}: {
  key: string;
  exp: string;
  contentType?: string | null;
  contentDisposition?: string | null;
}): string => [key, exp, contentType, contentDisposition].join("\n");

export const buildSignedWorkerFileUrl = async (
  base: string,
  secret: string,
  key: string,
  response: DownloadResponsePolicy = {},
  expSeconds = Math.floor(Date.now() / 1000) + SIGNED_URL_EXPIRES_IN_SECONDS
): Promise<string> => {
  const exp = String(expSeconds);
  const signature = await hmacSha256Hex(
    secret,
    buildSignedFilePayload({ key, exp, ...response })
  );
  const params = new URLSearchParams({ exp, sig: signature });
  if (response.contentType) {
    params.set("ct", response.contentType);
  }
  if (response.contentDisposition) {
    params.set("cd", response.contentDisposition);
  }
  return `${base.replace(/\/+$/, "")}/${key}?${params.toString()}`;
};

export const buildSignedWorkerImageUrl = async (
  base: string,
  secret: string,
  key: string,
  rendition: FilesImageRendition,
  expSeconds = Math.floor(Date.now() / 1000) + SIGNED_URL_EXPIRES_IN_SECONDS
): Promise<string> => {
  const expiresAt = String(expSeconds);
  const signature = await hmacSha256Hex(
    secret,
    buildImageSigningPayload({ expiresAt, key, rendition })
  );
  const params = new URLSearchParams({ exp: expiresAt, sig: signature });
  return `${base.replace(/\/+$/, "")}${FILES_IMAGE_PATH}/${rendition}/${encodeURIComponent(key)}?${params.toString()}`;
};

export const r2ComponentConfig = () => {
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
};

export const resolveObjectUrl = async (
  key?: string,
  fileName?: string | null
) =>
  key
    ? getR2Url(
        key,
        fileName === undefined ? {} : fileDownloadResponsePolicy(fileName)
      )
    : null;

export const resolveImageUrl = async (
  key: string | undefined,
  rendition: FilesImageRendition
): Promise<string | null> => {
  if (!key) {
    return null;
  }
  const filesBase = process.env.FILES_BASE;
  const signingSecret = process.env.FILES_SIGNING_SECRET;
  return filesBase && signingSecret
    ? await buildSignedWorkerImageUrl(
        filesBase,
        signingSecret,
        key,
        rendition,
        bucketedSignatureExpiry()
      )
    : await resolveObjectUrl(key);
};

export const cardStorageObjectKeys = (card: {
  fileKey?: string;
  metadata?: {
    linkPreview?: {
      imageStorageKey?: string;
      media?: Array<{ posterStorageKey?: string; storageKey?: string }>;
      screenshotStorageKey?: string;
    };
  };
  previewKey?: string;
  thumbnailKey?: string;
}): string[] => {
  const linkPreview = card.metadata?.linkPreview;
  return [
    card.fileKey,
    card.fileKey ? `${card.fileKey}.processing.json` : undefined,
    card.thumbnailKey,
    card.previewKey,
    linkPreview?.imageStorageKey,
    linkPreview?.screenshotStorageKey,
    ...(linkPreview?.media ?? []).flatMap((item) => [
      item.storageKey,
      item.posterStorageKey,
    ]),
  ].filter((key, index, keys): key is string =>
    Boolean(key && keys.indexOf(key) === index)
  );
};

export const deleteObject = async (ctx: MutationCtx, key?: string) => {
  if (key) {
    await r2.deleteObject(ctx, key);
  }
};

export const storeObject = async (
  ctx: ActionCtx,
  blob: Blob,
  opts: {
    key: string;
    type?: string;
  }
) => r2.store(ctx, blob, opts);

export const generateUploadUrl = mutation({
  args: {
    cardId: v.optional(v.id("cards")),
    fileName: v.optional(v.string()),
    role: v.optional(v.string()),
  },
  returns: v.object({
    key: v.string(),
    url: v.string(),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User must be authenticated");
    }
    return r2.generateUploadUrl(
      buildR2ObjectKey({
        userId: user.subject,
        cardId: args.cardId,
        role: args.role ?? "file",
        fileName: args.fileName,
      })
    );
  },
});

export const syncUploadedObjectMetadata = internalMutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    await ctx.scheduler.runAfter(0, components.r2.lib.syncMetadata, {
      key,
      ...r2ComponentConfig(),
    });
    return null;
  },
});

export const getFileUrl = query({
  args: {
    key: v.string(),
    cardId: v.id("cards"),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthenticated call to getFileUrl");
    }

    const card = await ctx.db.get(args.cardId);
    if (!card) {
      throw new Error("Card not found");
    }
    if (card.userId !== user.subject) {
      throw new Error("Unauthorized access to file");
    }

    const linkPreview = card.metadata?.linkPreview;
    const matchesKey =
      card.fileKey === args.key ||
      card.thumbnailKey === args.key ||
      linkPreview?.screenshotStorageKey === args.key ||
      linkPreview?.imageStorageKey === args.key ||
      linkPreview?.media?.some(
        (item) =>
          item.storageKey === args.key || item.posterStorageKey === args.key
      );

    if (!matchesKey) {
      throw new Error("File does not belong to the specified card");
    }

    return resolveObjectUrl(
      args.key,
      args.key === card.fileKey
        ? (card.fileMetadata?.fileName ?? null)
        : undefined
    );
  },
});
