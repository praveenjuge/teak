import { R2 } from "@convex-dev/r2";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation, mutation, query } from "../_generated/server";

const SIGNED_URL_EXPIRES_IN_SECONDS = 15 * 60;

export const r2 = new R2(components.r2);

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

export const getR2Url = async (key: string) =>
  r2.getUrl(key, { expiresIn: SIGNED_URL_EXPIRES_IN_SECONDS });

const r2ComponentConfig = () => {
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
  ctx: QueryCtx | any,
  {
    key,
    legacyStorageId,
    cardId,
    field,
  }: {
    key?: string;
    legacyStorageId?: Id<"_storage"> | string;
    cardId?: Id<"cards">;
    field: string;
  }
) => {
  if (key) {
    try {
      return await getR2Url(key);
    } catch (error) {
      if (!legacyStorageId) {
        throw error;
      }
      console.warn("[storage/r2] Falling back to Convex storage URL", {
        cardId,
        field,
        key,
        error,
      });
    }
  }

  if (!legacyStorageId) {
    return null;
  }

  console.info("[storage/r2] Legacy Convex storage read", {
    cardId,
    field,
    legacyStorageId,
  });
  if (typeof ctx.scheduler?.runAfter === "function") {
    await ctx.scheduler.runAfter(0, internal.storage.r2.recordFallbackRead, {
      cardId,
      field,
      legacyStorageId,
    });
  }
  return ctx.storage.getUrl(legacyStorageId as Id<"_storage">);
};

export const deleteObject = async (
  ctx: MutationCtx,
  key?: string,
  legacyStorageId?: Id<"_storage"> | string
) => {
  if (key?.startsWith("users/")) {
    await r2.deleteObject(ctx, key);
    return;
  }
  const legacyId = legacyStorageId ?? key;
  if (legacyId) {
    await ctx.storage.delete(legacyId as Id<"_storage">);
  }
};

export const storeObject = async (
  ctx: any,
  blob: Blob,
  opts: {
    key: string;
    type?: string;
  }
) => {
  if (typeof ctx.runAction === "function") {
    return r2.store(ctx, blob, opts);
  }
  if (ctx.storage?.store) {
    return ctx.storage.store(blob);
  }
  return r2.store(ctx, blob, opts);
};

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
    key: v.optional(v.string()),
    legacyStorageId: v.optional(v.id("_storage")),
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
      (args.key &&
        (card.fileKey === args.key ||
          card.thumbnailKey === args.key ||
          linkPreview?.screenshotStorageKey === args.key ||
          linkPreview?.imageStorageKey === args.key ||
          linkPreview?.media?.some(
            (item) =>
              item.storageKey === args.key || item.posterStorageKey === args.key
          ))) ||
      (args.legacyStorageId &&
        (card.fileId === args.legacyStorageId ||
          card.thumbnailId === args.legacyStorageId ||
          linkPreview?.screenshotStorageId === args.legacyStorageId ||
          linkPreview?.imageStorageId === args.legacyStorageId ||
          linkPreview?.media?.some(
            (item) =>
              item.storageId === args.legacyStorageId ||
              item.posterStorageId === args.legacyStorageId
          )));

    if (!matchesKey) {
      throw new Error("File does not belong to the specified card");
    }

    return resolveObjectUrl(ctx, {
      key: args.key,
      legacyStorageId: args.legacyStorageId,
      cardId: args.cardId,
      field: "card.getFileUrl",
    });
  },
});

export const recordFallbackRead = internalMutation({
  args: {
    cardId: v.optional(v.id("cards")),
    field: v.string(),
    legacyStorageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("storageFallbackReads", {
      ...args,
      createdAt: Date.now(),
    });
    return null;
  },
});
