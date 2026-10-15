/**
 * Replacing a link card's image with one the person chooses.
 *
 * The chosen image lives in `cards.thumbnailOverride`, outside
 * `metadata.linkPreview`, so Refresh details, screenshots and new link media
 * never touch it. Queries resolve `linkPreviewImageUrl` from it
 * (card/queryUtils.ts), so every client that shows that URL shows it.
 *
 * Flow: `createThumbnailUploadUrl` signs a PUT into the swept pending
 * namespace (no card quota: the card already exists), `setLinkThumbnail`
 * decode-verifies the bytes in the Files Worker and moves them under the card,
 * and `resetLinkThumbnail` goes back to the scraped image. A replace or reset
 * keeps the image it changed from for THUMBNAIL_UNDO_WINDOW_MS, so
 * `undoThumbnailChange` can put it back; then a guarded job deletes it.
 */
import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  type MutationCtx,
  mutation,
} from "../_generated/server";
import type { thumbnailOverrideValidator } from "../schema";
import {
  getSessionUser,
  requireTeakUserId,
  type TeakUserId,
} from "../securitySessions";
import { RATE_LIMIT_CONFIG, rateLimiter } from "../shared/rateLimits";
import {
  THUMBNAIL_ERROR_MESSAGES,
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_UNDO_WINDOW_MS,
  toThumbnailMimeType,
} from "../shared/thumbnails";
import {
  buildSignedWorkerUploadUrl,
  callFilesWorkerJson,
  type FilesWorkerFinalizeImageResult,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import {
  ensureObjectOwnership,
  registerOwnedObject,
} from "../storage/ownership";
import {
  buildR2ObjectKey,
  buildR2UserPrefix,
  deleteObject,
  PENDING_UPLOAD_CARD_ID,
} from "../storage/r2";
import { patchCardWithSearchSync } from "./searchDocumentHelpers";

export const THUMBNAIL_ROLE = "thumbnail-override";
export const THUMBNAIL_PENDING_ROLE = "thumbnail-override-pending";
const UPLOAD_URL_EXPIRES_IN_SECONDS = 10 * 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

type ThumbnailOverride = Infer<typeof thumbnailOverrideValidator>;

const fail = (code: string, message: string, extra = {}): never => {
  throw new ConvexError({ code, message, ...extra });
};

/**
 * The pending key a thumbnail upload for this card is signed for. It sits in
 * the pending namespace the stale-upload sweep empties after 24 hours, so a
 * replacement abandoned after its upload is cleaned up.
 */
export const buildPendingThumbnailKey = (userId: string, cardId: string) =>
  buildR2ObjectKey({
    userId,
    cardId: PENDING_UPLOAD_CARD_ID,
    role: THUMBNAIL_PENDING_ROLE,
    fileName: `card-${cardId}`,
  });

/**
 * Whether `fileKey` is a pending thumbnail upload this user made for this
 * card: in their namespace, under the pending thumbnail role, and named for
 * the card, so another card's or another role's upload is refused.
 */
export const isPendingThumbnailKeyFor = (
  userId: string,
  cardId: string,
  fileKey: string
): boolean => {
  const prefix = `${buildR2UserPrefix(userId)}/${PENDING_UPLOAD_CARD_ID}/${THUMBNAIL_PENDING_ROLE}/`;
  if (!fileKey.startsWith(prefix)) {
    return false;
  }
  const name = fileKey.slice(prefix.length);
  const suffix = `-card-${cardId}`;
  return (
    name.endsWith(suffix) &&
    UUID_PATTERN.test(name.slice(0, name.length - suffix.length))
  );
};

/** Whether a key is one of this card's chosen images. */
const isCardThumbnailKey = (cardId: string, key: string) =>
  key.includes(`/cards/${cardId}/${THUMBNAIL_ROLE}/`);

/** Throws unless the user owns this card, a link that is not in Trash. */
const assertReplaceable: (
  card: Doc<"cards"> | null,
  userId: string
) => asserts card is Doc<"cards"> = (card, userId) => {
  if (!card || card.userId !== userId) {
    fail("NOT_FOUND", "Card not found");
  }
  const owned = card as Doc<"cards">;
  if (owned.isDeleted) {
    fail("CONFLICT", "Restore this card from Trash before changing its image");
  }
  if (owned.type !== "link") {
    fail("TYPE_MISMATCH", "Only link cards have an image to replace");
  }
};

const checkUploadRequest = (mimeType: string, fileSize: number) => {
  const mime = toThumbnailMimeType(mimeType);
  if (!mime) {
    fail("UNSUPPORTED_TYPE", THUMBNAIL_ERROR_MESSAGES.unsupported);
  }
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    fail("INVALID_INPUT", "fileSize must be a positive whole number of bytes");
  }
  if (fileSize > THUMBNAIL_MAX_BYTES) {
    fail("FILE_TOO_LARGE", THUMBNAIL_ERROR_MESSAGES.tooLarge);
  }
  return mime as string;
};

const rateLimited = (retryAfter?: number): never =>
  fail("RATE_LIMITED", THUMBNAIL_ERROR_MESSAGES.rateLimited, {
    limit: RATE_LIMIT_CONFIG.thumbnailReplace.capacity,
    retryAt:
      typeof retryAfter === "number" ? Date.now() + retryAfter : undefined,
  });

/** Spends one of the user's image changes for this minute. */
const consumeThumbnailChange = async (ctx: MutationCtx, userId: string) => {
  const result = await rateLimiter.limit(ctx, "thumbnailReplace", {
    key: userId,
    throws: false,
  });
  if (!result.ok) {
    rateLimited(result.retryAfter);
  }
};

const uploadUrlResult = v.object({
  expiresIn: v.number(),
  fileKey: v.string(),
  maxFileSize: v.number(),
  method: v.literal("PUT"),
  uploadUrl: v.string(),
});

const changeResult = v.object({
  /** Pass to undoThumbnailChange; null when nothing changed. */
  changeId: v.union(v.string(), v.null()),
  undoUntil: v.union(v.number(), v.null()),
});

type ChangeResult = Infer<typeof changeResult>;

export const createThumbnailUploadUrlHandler = async (
  ctx: MutationCtx,
  userId: TeakUserId,
  args: { cardId: Id<"cards">; fileSize: number; mimeType: string }
) => {
  assertReplaceable(await ctx.db.get("cards", args.cardId), userId);
  const contentType = checkUploadRequest(args.mimeType, args.fileSize);
  // Checked, not spent: the token is spent when the image is applied.
  const allowed = await rateLimiter.check(ctx, "thumbnailReplace", {
    key: userId,
  });
  if (!allowed.ok) {
    rateLimited(allowed.retryAfter);
  }
  const key = buildPendingThumbnailKey(userId, args.cardId);
  if (!(await registerOwnedObject(ctx, userId, key))) {
    throw new Error("account_storage_write_denied");
  }
  const signed = await buildSignedWorkerUploadUrl({
    contentType,
    key,
    size: args.fileSize,
    ttlSeconds: UPLOAD_URL_EXPIRES_IN_SECONDS,
  });
  return {
    expiresIn: UPLOAD_URL_EXPIRES_IN_SECONDS,
    fileKey: key,
    maxFileSize: THUMBNAIL_MAX_BYTES,
    method: "PUT" as const,
    uploadUrl: signed.url,
  };
};

const uploadArgs = {
  cardId: v.id("cards"),
  fileSize: v.number(),
  mimeType: v.string(),
};

export const createThumbnailUploadUrl = mutation({
  args: uploadArgs,
  returns: uploadUrlResult,
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      throw new Error("User must be authenticated");
    }
    return createThumbnailUploadUrlHandler(ctx, user.teakUserId, args);
  },
});

export const createThumbnailUploadUrlForUser = internalMutation({
  args: { ...uploadArgs, userId: v.string() },
  returns: uploadUrlResult,
  handler: async (ctx, { userId, ...args }) =>
    createThumbnailUploadUrlHandler(
      ctx,
      await requireTeakUserId(ctx, userId),
      args
    ),
});

/** Before the worker runs: the card can take an image, and a token is spent. */
export const reserveThumbnailChange = internalMutation({
  args: { cardId: v.id("cards"), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { cardId, userId }) => {
    assertReplaceable(await ctx.db.get("cards", cardId), userId);
    await consumeThumbnailChange(ctx, userId);
    return null;
  },
});

/**
 * Makes `next` the card's image (or none) and keeps what it replaces for the
 * undo window, after which a guarded job deletes it. Returns null when the
 * patch stood down (account deletion), so the caller can clean up.
 */
const changeThumbnail = async (
  ctx: MutationCtx,
  card: Doc<"cards">,
  next: ThumbnailOverride | undefined
): Promise<ChangeResult | null> => {
  const now = Date.now();
  const changeId = crypto.randomUUID();
  const deleteAfter = now + THUMBNAIL_UNDO_WINDOW_MS;
  const previous = card.thumbnailOverride ?? null;
  const patched = await patchCardWithSearchSync(ctx, card._id, {
    thumbnailOverride: next,
    previousThumbnailOverride: { override: previous, changeId, deleteAfter },
    thumbnailChangeId: changeId,
    updatedAt: now,
  });
  if (!patched) {
    return null;
  }
  if (previous) {
    const deletionJobId = await ctx.scheduler.runAfter(
      THUMBNAIL_UNDO_WINDOW_MS,
      internal.card.thumbnailOverride.deleteReplacedThumbnail,
      { cardId: card._id, storageKey: previous.storageKey }
    );
    await ctx.db.patch("cards", card._id, {
      previousThumbnailOverride: {
        override: previous,
        changeId,
        deleteAfter,
        deletionJobId,
      },
    });
  }
  return { changeId, undoUntil: deleteAfter };
};

export const applyThumbnailOverride = internalMutation({
  args: {
    cardId: v.id("cards"),
    height: v.number(),
    sourceKey: v.string(),
    storageKey: v.string(),
    userId: v.string(),
    width: v.number(),
  },
  returns: v.union(changeResult, v.null()),
  handler: async (ctx, args) => {
    const card = await ctx.db.get("cards", args.cardId);
    assertReplaceable(card, args.userId);
    const result = await changeThumbnail(ctx, card, {
      storageKey: args.storageKey,
      width: args.width,
      height: args.height,
      updatedAt: Date.now(),
    });
    if (result) {
      // The verified copy now lives under the card; drop the pending upload.
      await deleteObject(ctx, args.sourceKey);
    }
    return result;
  },
});

/** Why a decoded image can't be a link's image, as [code, message], or null. */
const refuseDecodedImage = (
  facts: FilesWorkerFinalizeImageResult
): readonly [string, string] | null => {
  if (!toThumbnailMimeType(facts.decodedFormat)) {
    return ["UNSUPPORTED_TYPE", THUMBNAIL_ERROR_MESSAGES.unsupported];
  }
  if (facts.storedFileSize > THUMBNAIL_MAX_BYTES) {
    return ["FILE_TOO_LARGE", THUMBNAIL_ERROR_MESSAGES.tooLarge];
  }
  if (!(facts.width && facts.height)) {
    return ["INVALID_INPUT", THUMBNAIL_ERROR_MESSAGES.unreadable];
  }
  return null;
};

const deleteFinalizedObject = (key: string) =>
  callFilesWorkerJson({ op: "delete-object", params: { key } }).catch(
    () => undefined
  );

export const setThumbnailForUser = async (
  ctx: ActionCtx,
  userId: TeakUserId,
  { cardId, fileKey }: { cardId: Id<"cards">; fileKey: string }
): Promise<{ changeId: string; undoUntil: number }> => {
  if (!isPendingThumbnailKeyFor(userId, cardId, fileKey)) {
    fail("NOT_FOUND", "Upload not found");
  }
  if (!isFilesWorkerConfigured()) {
    throw new Error("files_worker_not_configured");
  }
  await ctx.runMutation(
    internal.card.thumbnailOverride.reserveThumbnailChange,
    {
      cardId,
      userId,
    }
  );
  const destinationKey = buildR2ObjectKey({
    userId,
    cardId,
    role: THUMBNAIL_ROLE,
  });
  await ensureObjectOwnership(ctx, userId, destinationKey);
  // Decode-verify the bytes so the card gets trusted format and dimensions.
  const outcome = await callFilesWorkerJson<FilesWorkerFinalizeImageResult>({
    op: "finalize-image-upload",
    params: { destinationKey, sourceKey: fileKey },
    fallbackCodes: ["CONFLICT"],
  });
  if (outcome.kind !== "ok") {
    if (outcome.code === "NOT_FOUND") {
      return fail("NOT_FOUND", "Upload not found");
    }
    return outcome.code === "PAYLOAD_TOO_LARGE"
      ? fail("FILE_TOO_LARGE", THUMBNAIL_ERROR_MESSAGES.tooLarge)
      : fail("INVALID_INPUT", THUMBNAIL_ERROR_MESSAGES.unreadable);
  }
  const facts = outcome.data;
  const refusal = refuseDecodedImage(facts);
  if (refusal) {
    await deleteFinalizedObject(destinationKey);
    return fail(refusal[0], refusal[1]);
  }
  try {
    const result = await ctx.runMutation(
      internal.card.thumbnailOverride.applyThumbnailOverride,
      {
        cardId,
        height: facts.height as number,
        sourceKey: fileKey,
        storageKey: destinationKey,
        userId,
        width: facts.width as number,
      }
    );
    if (!result?.changeId) {
      throw new Error("thumbnail_override_not_applied");
    }
    return { changeId: result.changeId, undoUntil: result.undoUntil ?? 0 };
  } catch (error) {
    // Outside the pending namespace, nothing else would ever remove it.
    await deleteFinalizedObject(destinationKey);
    throw error;
  }
};

const setArgs = { cardId: v.id("cards"), fileKey: v.string() };
const setResult = v.object({ changeId: v.string(), undoUntil: v.number() });

export const setLinkThumbnail = action({
  args: setArgs,
  returns: setResult,
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      throw new Error("User must be authenticated");
    }
    return setThumbnailForUser(ctx, user.teakUserId, args);
  },
});

export const setLinkThumbnailForUser = internalAction({
  args: { ...setArgs, userId: v.string() },
  returns: setResult,
  handler: async (ctx, { userId, ...args }) =>
    setThumbnailForUser(ctx, await requireTeakUserId(ctx, userId), args),
});

export const resetThumbnailHandler = async (
  ctx: MutationCtx,
  userId: TeakUserId,
  cardId: Id<"cards">
): Promise<ChangeResult> => {
  const card = await ctx.db.get("cards", cardId);
  assertReplaceable(card, userId);
  if (!card.thumbnailOverride) {
    // Already the original image: nothing to change or undo.
    return { changeId: null, undoUntil: null };
  }
  await consumeThumbnailChange(ctx, userId);
  return (
    (await changeThumbnail(ctx, card, undefined)) ?? {
      changeId: null,
      undoUntil: null,
    }
  );
};

export const resetLinkThumbnail = mutation({
  args: { cardId: v.id("cards") },
  returns: changeResult,
  handler: async (ctx, { cardId }) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      throw new Error("User must be authenticated");
    }
    return resetThumbnailHandler(ctx, user.teakUserId, cardId);
  },
});

export const resetLinkThumbnailForUser = internalMutation({
  args: { cardId: v.id("cards"), userId: v.string() },
  returns: changeResult,
  handler: async (ctx, { cardId, userId }) =>
    resetThumbnailHandler(ctx, await requireTeakUserId(ctx, userId), cardId),
});

const undoResult = v.union(
  v.object({ status: v.literal("restored") }),
  v.object({ status: v.literal("expired"), code: v.literal("UNDO_EXPIRED") })
);

/**
 * Puts back the image the change `changeId` replaced. Only the card's latest
 * change can be undone, and only inside its window: an expired window or a
 * stale toast from an earlier change returns UNDO_EXPIRED and changes nothing.
 */
export const undoThumbnailChangeHandler = async (
  ctx: MutationCtx,
  userId: TeakUserId,
  { cardId, changeId }: { cardId: Id<"cards">; changeId: string }
): Promise<Infer<typeof undoResult>> => {
  const card = await ctx.db.get("cards", cardId);
  if (!card || card.userId !== userId) {
    return fail("NOT_FOUND", "Card not found");
  }
  const previous = card.previousThumbnailOverride;
  const expired = { status: "expired" as const, code: "UNDO_EXPIRED" as const };
  if (
    !previous ||
    card.thumbnailChangeId !== changeId ||
    previous.changeId !== changeId ||
    previous.deleteAfter <= Date.now()
  ) {
    return expired;
  }
  const newer = card.thumbnailOverride;
  const patched = await patchCardWithSearchSync(ctx, cardId, {
    thumbnailOverride: previous.override ?? undefined,
    previousThumbnailOverride: undefined,
    thumbnailChangeId: undefined,
    updatedAt: Date.now(),
  });
  if (!patched) {
    return expired;
  }
  if (previous.deletionJobId) {
    // The deletion job checks the card too; cancelling just saves the run.
    await ctx.scheduler.cancel(previous.deletionJobId).catch(() => undefined);
  }
  if (newer) {
    // An undo can't be undone, so the image it replaced goes now.
    await ctx.scheduler.runAfter(
      0,
      internal.card.thumbnailOverride.deleteReplacedThumbnail,
      { cardId, storageKey: newer.storageKey }
    );
  }
  return { status: "restored" };
};

export const undoThumbnailChange = mutation({
  args: { cardId: v.id("cards"), changeId: v.string() },
  returns: undoResult,
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      throw new Error("User must be authenticated");
    }
    return undoThumbnailChangeHandler(ctx, user.teakUserId, args);
  },
});

/**
 * Deletes an image a change replaced once its undo window has passed. It
 * never deletes the card's current image, or one still kept for a later
 * change's undo, so a late undo or a quick second change can't remove an
 * image in use.
 */
export const deleteReplacedThumbnail = internalMutation({
  args: { cardId: v.id("cards"), storageKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { cardId, storageKey }) => {
    if (!isCardThumbnailKey(cardId, storageKey)) {
      return null;
    }
    const card = await ctx.db.get("cards", cardId);
    const kept = card?.previousThumbnailOverride;
    if (
      card?.thumbnailOverride?.storageKey === storageKey ||
      (kept?.override?.storageKey === storageKey &&
        kept.deleteAfter > Date.now())
    ) {
      return null;
    }
    await deleteObject(ctx, storageKey);
    if (card && kept?.override?.storageKey === storageKey) {
      // Its window has closed: nothing is left to undo.
      await patchCardWithSearchSync(ctx, cardId, {
        previousThumbnailOverride: undefined,
      });
    }
    return null;
  },
});
