import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  deleteAccountDataHandler,
  type OwnedCardIds,
  takeOwnedCards,
} from "../accountDeletion";
import { importStagedPartKeys } from "../import/indexItems";
import { buildR2UserPrefix, cardStorageObjectKeys } from "../storage/r2";
import { sha256Hex } from "../storage/r2Keys";

declare const ownerIndexBrand: unique symbol;

type DeletionBatchRow =
  | Doc<"cards">
  | Doc<"importJobs">
  | Doc<"importJobItems">
  | Doc<"exportJobs">
  | Doc<"exportJobItems">
  | Doc<"fileUploadSessions">
  | Doc<"accountStorageObjects">;

export type OwnedDeletionRows = DeletionBatchRow[] & {
  readonly [ownerIndexBrand]: true;
};

/** Cards one deletion batch removes; each brings up to 20 tag rows and 50 folder rows. */
export const ACCOUNT_DELETION_CARD_BATCH = 25;
// Card documents can be large; a batch stops early past this many bytes so
// its transaction stays well under Convex's read limit.
const ACCOUNT_DELETION_CARD_BYTES = 4 * 1024 * 1024;
/** R2 keys the Files Worker freezes and deletes per checkpoint. */
export const ACCOUNT_DELETION_KEY_PAGE = 50;
const FINGERPRINT_VERSION = "v2:";

export const isCurrentDeletionFingerprint = (fingerprint: string) =>
  fingerprint.startsWith(FINGERPRINT_VERSION);

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
  let rows: DeletionBatchRow[];
  let cardIds: OwnedCardIds | undefined;
  let keys: string[] = [];
  let aborts: { key: string; uploadId: string }[] = [];
  if (kind === "cards") {
    const owned = await takeOwnedCards(
      ctx,
      userId,
      ACCOUNT_DELETION_CARD_BATCH,
      ACCOUNT_DELETION_CARD_BYTES
    );
    rows = owned.cards;
    cardIds = owned.cardIds;
    for (const card of owned.cards) {
      const tags = await ctx.db
        .query("cardSearchTags")
        .withIndex("by_cardId_and_tag", (q) => q.eq("cardId", card._id))
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
        ...importStagedPartKeys(
          buildR2UserPrefix(row.userId),
          row._id,
          row.stagedItems
        ),
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
  // The batch is the same batch while its rows and the objects they own are:
  // a commit deletes exactly the rows whose keys the Worker deleted.
  const fingerprint =
    FINGERPRINT_VERSION +
    (await sha256Hex(
      JSON.stringify({ kind, ids: rows.map((row) => row._id), keys, aborts })
    ));
  return {
    rows: rows as OwnedDeletionRows,
    keys,
    aborts,
    fingerprint,
    cardIds,
  };
}

export async function commitDeletionBatch(
  ctx: MutationCtx,
  { rows, cardIds }: { rows: OwnedDeletionRows; cardIds?: OwnedCardIds }
) {
  if (cardIds) {
    await deleteAccountDataHandler(ctx, cardIds);
    return;
  }
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
}
