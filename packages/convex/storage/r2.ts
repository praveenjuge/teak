import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { R2 } from "@convex-dev/r2";
import { v } from "convex/values";
import { components } from "../_generated/api";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { internalMutation, mutation, query } from "../_generated/server";

// Signed URLs live long enough for browsers and the CDN to cache media for the
// full URL lifetime. Object keys are immutable UUIDs, so reuse is safe.
const SIGNED_URL_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;
// `stale-while-revalidate` lets browsers and the CDN serve stale media while
// refreshing in the background, which is safe because keys are immutable.
const MEDIA_CACHE_CONTROL = `public, max-age=${SIGNED_URL_EXPIRES_IN_SECONDS}, stale-while-revalidate=86400, immutable`;

// Re-sign a URL before it expires so concurrent readers (grid, modal, preview)
// all share one stable URL while it is still valid.
const URL_REFRESH_BEFORE_MS = 5 * 60 * 1000;
const MAX_CACHED_URLS = 2000;

interface CachedUrl {
  url: string;
  expiresAt: number;
}

const resolvedUrlCache = new Map<string, CachedUrl>();

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
  bucket = r2.config.bucket
) =>
  new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseCacheControl: MEDIA_CACHE_CONTROL,
  });

const signR2Url = async (key: string) =>
  getSignedUrl(getDownloadClient(), buildR2DownloadCommand(key), {
    expiresIn: SIGNED_URL_EXPIRES_IN_SECONDS,
  });

/**
 * Resolve a signed URL for an R2 object, reusing an unexpired signature.
 *
 * Signing is expensive (one S3 request per key on busy grids), and stable URLs
 * let browser and CDN caches actually hit across queries and modals. The cache
 * is keyed by object key and bounded to avoid unbounded growth.
 */
export const getR2Url = async (key: string): Promise<string> => {
  const cached = resolvedUrlCache.get(key);
  if (cached && Date.now() < cached.expiresAt - URL_REFRESH_BEFORE_MS) {
    return cached.url;
  }

  const url = await signR2Url(key);
  resolvedUrlCache.set(key, {
    url,
    expiresAt: Date.now() + SIGNED_URL_EXPIRES_IN_SECONDS * 1000,
  });
  if (resolvedUrlCache.size > MAX_CACHED_URLS) {
    const oldestKey = resolvedUrlCache.keys().next().value;
    if (oldestKey !== undefined) {
      resolvedUrlCache.delete(oldestKey);
    }
  }
  return url;
};

/** Test-only reset for the signed URL cache. */
export const clearResolvedUrlCache = () => resolvedUrlCache.clear();

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

export const resolveObjectUrl = async (key?: string) =>
  key ? getR2Url(key) : null;

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

    return resolveObjectUrl(args.key);
  },
});
