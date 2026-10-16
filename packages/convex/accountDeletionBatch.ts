import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  deleteAccountDataHandler,
  type OwnedCardIds,
  takeOwnedCards,
} from "./accountDeletion";
import { cardStorageObjectKeys } from "./storage/r2";

export type DeletionBatchKind =
  | "cards"
  | "imports"
  | "exports"
  | "uploads"
  | "objects";
export async function captureDeletionBatch(
  ctx: QueryCtx,
  userId: string,
  kind: DeletionBatchKind
) {
  let rows: unknown[];
  let cardIds: OwnedCardIds | undefined;
  let keys: string[] = [];
  let aborts: { key: string; uploadId: string }[] = [];
  if (kind === "cards") {
    const owned = await takeOwnedCards(ctx, userId, 1);
    rows = owned.cards;
    cardIds = owned.cardIds;
    for (const card of owned.cards) {
      const tags = await ctx.db
        .query("cardSearchTags")
        .withIndex("by_cardId", (q) => q.eq("cardId", card._id))
        .take(21);
      if (tags.length <= 20) {
        keys.push(...cardStorageObjectKeys(card));
      }
    }
  } else if (kind === "imports") {
    const jobs = await ctx.db
      .query("importJobs")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .take(1);
    const items = await ctx.db
      .query("importJobItems")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(1);
    rows = [...jobs, ...items];
    keys = [
      ...jobs.flatMap((row) => [
        row.sourceKey,
        ...(row.reportKey ? [row.reportKey] : []),
      ]),
      ...items.flatMap((row) =>
        row.extractedFileKey ? [row.extractedFileKey] : []
      ),
    ];
    aborts = jobs.flatMap((row) =>
      row.uploadId ? [{ key: row.sourceKey, uploadId: row.uploadId }] : []
    );
  } else if (kind === "exports") {
    const jobs = await ctx.db
      .query("exportJobs")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .take(1);
    const items = await ctx.db
      .query("exportJobItems")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);
    rows = [...jobs, ...items];
    keys = jobs.flatMap((row) =>
      row.artifactKey
        ? [
            row.artifactKey,
            `${row.artifactKey}.checkpoint.json`,
            `${row.artifactKey}.result.json`,
          ]
        : []
    );
  } else if (kind === "uploads") {
    const uploads = await ctx.db
      .query("fileUploadSessions")
      .withIndex("by_teak_user_file", (q) => q.eq("teakUserId", userId))
      .take(1);
    rows = uploads;
    keys = uploads.map((row) => row.sourceKey);
    aborts = uploads.map((row) => ({
      key: row.sourceKey,
      uploadId: row.uploadId,
    }));
  } else {
    const objects = await ctx.db
      .query("accountStorageObjects")
      .withIndex("by_userId_and_key", (q) => q.eq("userId", userId))
      .take(3);
    rows = objects;
    keys = objects.map((row) => row.key);
  }
  keys = [...new Set(keys)];
  const bytes = new TextEncoder().encode(
    JSON.stringify({ kind, rows, keys, aborts })
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return { rows, keys, aborts, fingerprint, cardIds };
}

export async function commitDeletionBatch(
  ctx: MutationCtx,
  { rows, cardIds }: { rows: unknown[]; cardIds?: OwnedCardIds }
) {
  if (cardIds) {
    await deleteAccountDataHandler(ctx, cardIds);
    return;
  }
  // Rows originate exclusively from owner-bound indexes and are re-captured in
  // the same transaction immediately before this call. No caller supplies IDs.
  for (const row of rows as {
    _id:
      | Id<"importJobs">
      | Id<"importJobItems">
      | Id<"exportJobs">
      | Id<"exportJobItems">
      | Id<"fileUploadSessions">
      | Id<"accountStorageObjects">;
  }[]) {
    await ctx.db.delete(row._id);
  }
}
