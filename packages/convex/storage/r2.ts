import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { R2 } from "@convex-dev/r2";
import { v } from "convex/values";
import { components } from "../_generated/api";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { internalMutation, mutation, query } from "../_generated/server";

const SIGNED_URL_EXPIRES_IN_SECONDS = 15 * 60;
const PRIVATE_FILE_CACHE_CONTROL = `private, max-age=${SIGNED_URL_EXPIRES_IN_SECONDS}, immutable`;

export const r2 = new R2(components.r2);
const r2DownloadClient = new S3Client({
  credentials: {
    accessKeyId: r2.config.accessKeyId,
    secretAccessKey: r2.config.secretAccessKey,
  },
  endpoint: r2.config.endpoint,
  region: "auto",
});

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
    ResponseCacheControl: PRIVATE_FILE_CACHE_CONTROL,
  });

export const getR2Url = async (key: string) =>
  getSignedUrl(r2DownloadClient, buildR2DownloadCommand(key), {
    expiresIn: SIGNED_URL_EXPIRES_IN_SECONDS,
  });

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
