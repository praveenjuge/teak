import type { MutationCtx, QueryCtx } from "../_generated/server";
import { PAGE_SNAPSHOT_ROLE } from "../shared/pageArchive";
import { buildR2UserPrefix, PENDING_UPLOAD_CARD_ID } from "../storage/r2";

const MAX_KEY_LENGTH = 1024;

/**
 * The extension's page snapshot for a save, when `key` is one of the
 * caller's own pending snapshot uploads. Anything else (another account's
 * key, a key outside the pending snapshots, one never minted) is ignored
 * rather than refused, so a bad snapshot never loses a save.
 */
export const acceptPendingPageSnapshot = async (
  ctx: QueryCtx | MutationCtx,
  userId: string,
  key: string | undefined
): Promise<string | undefined> => {
  if (!key || key.length > MAX_KEY_LENGTH) {
    return;
  }
  const prefix = `${buildR2UserPrefix(userId)}/${PENDING_UPLOAD_CARD_ID}/${PAGE_SNAPSHOT_ROLE}/`;
  if (!(key.startsWith(prefix) && key.length > prefix.length)) {
    return;
  }
  const owners = await ctx.db
    .query("accountStorageObjects")
    .withIndex("by_key", (q) => q.eq("key", key))
    .take(2);
  return owners.length === 1 && owners[0]?.userId === userId ? key : undefined;
};
