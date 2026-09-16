import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { mutation, query } from "../_generated/server";
import { getSessionIdentity } from "../securitySessions";
import { tryResolveObjectUrl } from "./fileUrls";
import {
  buildSignedWorkerUploadUrl,
  putObjectViaFilesWorker,
} from "./filesWorkerClient";
import { assertR2KeyInNamespace, getR2KeyPrefix } from "./r2Keys";

// Re-exported for backward compatibility: existing importers keep importing
// these names from `storage/r2`. New code should import them from
// `storage/r2Keys` directly so it never depends on the mocked `storage/r2`
// surface (see r2Keys.ts).
export {
  assertR2KeyInNamespace,
  buildR2ListPrefix,
  getR2KeyPrefix,
  hmacSha256Hex,
  isR2KeyInNamespace,
} from "./r2Keys";

// Re-exported for backward compatibility: the signed-URL stack lives in the
// unmocked `storage/fileUrls` leaf so tests that need real URL resolution can
// import it without tripping over `storage/r2` mocks (see fileUrls.ts).
export {
  bucketedSignatureExpiry,
  buildSignedFilePayload,
  buildSignedWorkerFileUrl,
  buildSignedWorkerImageUrl,
  fileDownloadResponsePolicy,
  getR2ReadBase,
  getR2Url,
  isStorageNamespaceError,
  PRIVATE_FILE_CACHE_CONTROL,
  resolveImageUrl,
  resolveObjectUrl,
  type R2ObjectKey,
  tryResolveImageUrl,
  tryResolveObjectUrl,
} from "./fileUrls";

export const PENDING_UPLOAD_CARD_ID = "upload-pending-v2";

const hashUserId = (userId: string) =>
  Array.from(new TextEncoder().encode(userId))
    .reduce((hash, byte) => (hash * 31 + byte) >>> 0, 0)
    .toString(36);

export const buildR2UserPrefix = (userId: string) =>
  `${getR2KeyPrefix()}users/${hashUserId(userId)}/cards`;

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
  if (!key) {
    return;
  }
  assertR2KeyInNamespace(key);
  // Durable deletion workflow instead of a synchronous component delete:
  // the keys are recorded durably and retried by the workflow step.
  await ctx.scheduler.runAfter(
    0,
    (internal as any)["workflows/objectCleanup"].startObjectDeletion,
    { keys: [key] }
  );
};

export const storeObject = async (
  _ctx: ActionCtx,
  blob: Blob,
  opts: {
    key: string;
    type?: string;
  }
) => {
  assertR2KeyInNamespace(opts.key);
  await putObjectViaFilesWorker({
    body: blob,
    contentType: opts.type ?? blob.type ?? "application/octet-stream",
    key: opts.key,
  });
  // Callers expect the storage key back (r2.store returned the key).
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
    const user = await getSessionIdentity(ctx);
    if (!user) {
      throw new Error("User must be authenticated");
    }
    const key = buildR2ObjectKey({
      userId: user.subject,
      cardId: args.cardId,
      role: args.role ?? "file",
      fileName: args.fileName,
    });
    const contentType = args.fileType ?? "application/octet-stream";
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
    const user = await getSessionIdentity(ctx);
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

    return tryResolveObjectUrl(
      args.key,
      args.key === card.fileKey
        ? (card.fileMetadata?.fileName ?? null)
        : undefined
    );
  },
});
