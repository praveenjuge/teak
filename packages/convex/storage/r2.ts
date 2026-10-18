import { buildCardObjectKey, filesCardKeyPrefix } from "@teak/files-protocol";
import { v } from "convex/values";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { mutation, query } from "../_generated/server";
import { getSessionUser } from "../securitySessions";
import { ensureObjectOwnership } from "../storage/ownership";
import {
  buildSignedWorkerUploadUrl,
  putObjectViaFilesWorker,
} from "./filesWorkerClient";
import { tryResolveObjectUrl } from "./fileUrls";

export { cardStorageObjectKeys } from "./cardObjectKeys";

import { enqueueObjectDeletion } from "../workflowDispatch";
import { assertR2KeyInNamespace, getR2KeyPrefix } from "./r2Keys";

export const PENDING_UPLOAD_CARD_ID = "upload-pending-v2";

export const buildR2UserPrefix = (userId: string) =>
  filesCardKeyPrefix(getR2KeyPrefix(), userId);

export const buildR2ObjectKey = (args: {
  userId: string;
  cardId?: string;
  role: string;
  fileName?: string;
  objectId?: string;
}) => buildCardObjectKey({ envPrefix: getR2KeyPrefix(), ...args });

/** Queues an object for deletion in the caller's transaction. */
export const deleteObject = async (ctx: MutationCtx, key?: string) => {
  if (!key) {
    return;
  }
  assertR2KeyInNamespace(key);
  await enqueueObjectDeletion(ctx, [key]);
};

export const storeObject = async (
  ctx: ActionCtx,
  blob: Blob,
  opts: {
    key: string;
    userId: string;
    type?: string;
  }
) => {
  await ensureObjectOwnership(ctx, opts.userId, opts.key);
  assertR2KeyInNamespace(opts.key);
  await putObjectViaFilesWorker({
    body: blob,
    contentType: opts.type ?? blob.type ?? "application/octet-stream",
    key: opts.key,
  });
  return opts.key;
};

export const generateUploadUrl = mutation({
  args: {
    cardId: v.optional(v.id("cards")),
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    role: v.optional(v.string()),
  },
  returns: v.object({
    key: v.string(),
    url: v.string(),
  }),
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      throw new Error("User must be authenticated");
    }
    const key = buildR2ObjectKey({
      userId: user.teakUserId,
      cardId: args.cardId,
      role: args.role ?? "file",
      fileName: args.fileName,
    });
    const contentType = args.fileType ?? "application/octet-stream";
    await ensureObjectOwnership(ctx, user.teakUserId, key);
    const signed = await buildSignedWorkerUploadUrl({
      contentType,
      key,
      size: args.fileSize ?? null,
    });
    return { key, url: signed.url };
  },
});

export const getFileUrl = query({
  args: {
    key: v.string(),
    cardId: v.id("cards"),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      throw new Error("Unauthenticated call to getFileUrl");
    }

    const card = await ctx.db.get(args.cardId);
    if (!card) {
      throw new Error("Card not found");
    }
    if (card.userId !== user.teakUserId) {
      throw new Error("Unauthorized access to file");
    }

    const linkPreview = card.metadata?.linkPreview;
    const matchesKey =
      card.fileKey === args.key ||
      card.thumbnailOverride?.storageKey === args.key ||
      card.thumbnailKey === args.key ||
      card.scrubKey === args.key ||
      linkPreview?.screenshotStorageKey === args.key ||
      linkPreview?.imageStorageKey === args.key ||
      linkPreview?.media?.some(
        (item) =>
          item.storageKey === args.key || item.posterStorageKey === args.key
      );

    if (!matchesKey) {
      throw new Error("File does not belong to the specified card");
    }

    return tryResolveObjectUrl(
      args.key,
      args.key === card.fileKey
        ? (card.fileMetadata?.fileName ?? null)
        : undefined
    );
  },
});
